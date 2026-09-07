/**
 * Traderas EGNA fraktalternativ (PostNord, DHL, Instabox, Schenker …) per vikt.
 *
 * Priserna är Traderas, inte våra: `GET /v4/reference-data/shipping-options`
 * svarar med en lista per viktspann, och köparen betalar frakten. Vi visade
 * tidigare bara "Alternative" (säljaren skriver ett eget belopp), vilket är
 * varför arket saknade fraktbolag helt.
 *
 * ⛔ APPENS NYCKLAR RÄCKER — ingen användartoken behövs för referensdata, så
 * hämtningen kan ske utan att någon är inloggad hos Tradera.
 * ⛔ SVARET ÄR ~77 kB. Det cachas i minnet per kategori (TTL 12 h) och rör
 * ALDRIG databasen: en fraktlista som väcker Neon vid varje ark-öppning är
 * precis den sortens kostnad kostnadsdoktrinen förbjuder.
 */

const stripQuotes = (v: string) => v.trim().replace(/^["']|["']$/g, "");
const APP_ID = stripQuotes(process.env.TRADERA_APP_ID ?? "");
const APP_KEY = stripQuotes(process.env.TRADERA_APP_KEY ?? "");
const BASE = "https://api.tradera.com";

/** Traderas "Alternative" = säljaren anger eget belopp. Vår gamla enda väg. */
export const SHIPPING_PROVIDER_ALTERNATIVE = 6;

const CACHE_TTL_MS = 12 * 60 * 60 * 1000;

export interface ShippingOption {
  /** Traderas `shippingProductId` — id:t är UNIKT BARA ihop med leverantören. */
  productId: number;
  providerId: number;
  /** Maskinnamnet ur API:t ("PostNordStamp", "DHL", …) — översätts i klienten. */
  provider: string;
  priceKr: number;
  /** Spårbar försändelse? Skillnaden mellan ett frimärke och ett paket. */
  tracked: boolean;
  /** Hämtas hos ombud (i stället för att komma hem i brevlådan). */
  servicePoint: boolean;
  minDays: number | null;
  maxDays: number | null;
}

export interface ShippingWeightSpan {
  /** Vikt i KILO (0.05 = 50 g), precis som Tradera skickar den. */
  weightKg: number;
  options: ShippingOption[];
}

interface RawProduct {
  id?: number;
  shippingProvider?: string | null;
  shippingProviderId?: number;
  weight?: number;
  price?: number;
  packageRequirements?: {
    maxWeight?: number;
    maxLength?: number;
    maxWidth?: number;
    maxHeight?: number;
    maxVolume?: number;
  } | null;
  deliveryInformation?: {
    servicePoint?: boolean;
    isTraceable?: boolean;
    estimatedDeliveryTime?: { minWeekdays?: number; maxWeekdays?: number } | null;
  } | null;
}

/**
 * Hur STOR försändelse produkten tar. Används bara som skiljedomare när två
 * produkter från samma leverantör kostar lika mycket: Instabox ligger med två
 * rader à 49 kr där den ena bara tar en skokartong (34×24×7) och den andra en
 * riktig låda (60×40×20). Att välja den mindre "för att den kom först" hade
 * gjort att en ETB inte får plats i frakten köparen betalat för.
 */
function capacity(p: RawProduct): number {
  const r = p.packageRequirements ?? {};
  if (typeof r.maxVolume === "number") return r.maxVolume;
  const l = r.maxLength ?? 0;
  const w = r.maxWidth ?? 0;
  const h = r.maxHeight ?? 0;
  return l * w * h;
}

interface RawSpan {
  weight?: number;
  products?: RawProduct[] | null;
}

/**
 * Rå JSON → viktspann med bara det klienten behöver, "Alternative" bortsorterad
 * (den har pris 0 och är vår egen "Egen frakt"-rad, inte ett fraktbolag).
 * Ren funktion — testad i tests/unit/tradera-shipping.test.ts.
 */
export function normalizeShippingOptions(raw: unknown): ShippingWeightSpan[] {
  const spans = (raw as { productsPerWeightSpan?: RawSpan[] } | null)?.productsPerWeightSpan;
  if (!Array.isArray(spans)) return [];
  const out: ShippingWeightSpan[] = [];
  for (const span of spans) {
    const weightKg = typeof span?.weight === "number" ? span.weight : null;
    if (weightKg == null || weightKg <= 0) continue;
    // Samma leverantör kan ligga flera gånger i ett spann (olika produkter till
    // samma pris) — behåll den BILLIGASTE per leverantör, annars blir listan en
    // vägg av dubbletter där raderna inte går att skilja åt.
    const cheapest = new Map<string, ShippingOption & { capacity: number }>();
    for (const p of span.products ?? []) {
      if (
        typeof p?.id !== "number" ||
        typeof p?.shippingProviderId !== "number" ||
        typeof p?.price !== "number"
      ) {
        continue;
      }
      if (p.shippingProviderId === SHIPPING_PROVIDER_ALTERNATIVE) continue;
      if (p.price <= 0) continue;
      const provider = p.shippingProvider ?? String(p.shippingProviderId);
      const prev = cheapest.get(provider);
      const better =
        !prev ||
        p.price < prev.priceKr ||
        // Lika pris ⇒ den som tar det STÖRSTA paketet vinner (se capacity ovan).
        (p.price === prev.priceKr && capacity(p) > prev.capacity);
      if (better) {
        const eta = p.deliveryInformation?.estimatedDeliveryTime ?? null;
        cheapest.set(provider, {
          productId: p.id,
          providerId: p.shippingProviderId,
          provider,
          priceKr: p.price,
          tracked: p.deliveryInformation?.isTraceable === true,
          servicePoint: p.deliveryInformation?.servicePoint === true,
          minDays: typeof eta?.minWeekdays === "number" && eta.minWeekdays > 0 ? eta.minWeekdays : null,
          maxDays: typeof eta?.maxWeekdays === "number" && eta.maxWeekdays > 0 ? eta.maxWeekdays : null,
          capacity: capacity(p),
        });
      }
    }
    const options = [...cheapest.values()]
      .sort((a, b) => a.priceKr - b.priceKr)
      .map(({ capacity: _capacity, ...o }) => o);
    if (options.length > 0) out.push({ weightKg, options });
  }
  return out.sort((a, b) => a.weightKg - b.weightKg);
}

const cache = new Map<number, { at: number; spans: ShippingWeightSpan[] }>();

/**
 * Fraktalternativ för en Tradera-kategori. Kastar aldrig: utan svar får arket
 * en tom lista och faller tillbaka på "Egen frakt", som är vad vi alltid haft.
 */
export async function getShippingOptions(categoryId: number): Promise<ShippingWeightSpan[]> {
  const hit = cache.get(categoryId);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.spans;
  if (!APP_ID || !APP_KEY) return [];

  try {
    const res = await fetch(
      `${BASE}/v4/reference-data/shipping-options?fromCountryCodes=SE&categoryIds=${categoryId}`,
      {
        headers: { "X-App-Id": APP_ID, "X-App-Key": APP_KEY },
        signal: AbortSignal.timeout(8000),
      }
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const spans = normalizeShippingOptions(await res.json());
    if (spans.length > 0) cache.set(categoryId, { at: Date.now(), spans });
    return spans;
  } catch (e) {
    console.error("[tradera-shipping] kunde inte hämta fraktalternativ:", e);
    // Behåll det vi visste — en tom lista är inte ett bevis på att frakten är borta.
    return hit?.spans ?? [];
  }
}
