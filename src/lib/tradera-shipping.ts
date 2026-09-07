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

import { PACKAGE_SIZES, type PackageSize } from "./tradera-listing-options";

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
  /** Traderas mått-/viktkrav i METER. Avgör vilka paket produkten tar. */
  limits: PackageLimits;
}

export interface PackageLimits {
  maxWeight?: number;
  maxLength?: number;
  maxWidth?: number;
  maxHeight?: number;
  maxVolume?: number;
  maxSumOfAllSides?: number;
  maxLengthPlusCircumference?: number;
  minLength?: number;
  minWidth?: number;
  minHeight?: number;
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
  packageRequirements?: PackageLimits | null;
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
function capacity(limits: PackageLimits): number {
  if (typeof limits.maxVolume === "number") return limits.maxVolume;
  return (limits.maxLength ?? 0) * (limits.maxWidth ?? 0) * (limits.maxHeight ?? 0);
}

/**
 * Får paketet plats i fraktprodukten?
 *
 * ⛔ SIDORNA JÄMFÖRS SORTERADE. Ett paket kan vändas, så "34 × 24 × 7" ska
 * passa en produkt som anger "0,6 lång × 0,4 bred × 0,2 hög" oavsett i vilken
 * ordning måtten råkar stå. Krav vi inte känner igen ignoreras — hellre ett
 * alternativ för mycket i listan än att tyst gömma ett giltigt fraktsätt.
 */
export function fitsPackage(limits: PackageLimits, size: PackageSize): boolean {
  const d = PACKAGE_SIZES[size];
  const sides = [d.length, d.width, d.height].sort((a, b) => b - a);
  const max = [limits.maxLength, limits.maxWidth, limits.maxHeight]
    .filter((v): v is number => typeof v === "number")
    .sort((a, b) => b - a);
  for (let i = 0; i < max.length; i++) {
    if (sides[i] > max[i] + 1e-9) return false;
  }
  const sum = sides[0] + sides[1] + sides[2];
  if (limits.maxSumOfAllSides != null && sum > limits.maxSumOfAllSides + 1e-9) return false;
  if (
    limits.maxLengthPlusCircumference != null &&
    sides[0] + 2 * (sides[1] + sides[2]) > limits.maxLengthPlusCircumference + 1e-9
  ) {
    return false;
  }
  const volume = sides[0] * sides[1] * sides[2];
  if (limits.maxVolume != null && volume > limits.maxVolume + 1e-9) return false;
  // Minimimåtten: ett för LITET paket duger inte heller (brevformat har en
  // undre gräns). Paketet får vara minst så stort på sin längsta/näst längsta sida.
  if (limits.minLength != null && sides[0] < limits.minLength - 1e-9) return false;
  if (limits.minWidth != null && sides[1] < limits.minWidth - 1e-9) return false;
  if (limits.minHeight != null && sides[2] < limits.minHeight - 1e-9) return false;
  return true;
}

/**
 * Fraktsätten som faktiskt går att välja för ett paket av den här storleken:
 * filtrera på måtten FÖRST, kollapsa sedan till EN rad per leverantör
 * (billigast; vid lika pris den som tar störst paket).
 *
 * ⛔ ORDNINGEN ÄR HELA POÄNGEN. Kollapsades leverantören först kunde en billig
 * brevprodukt slå ut samma leverantörs dyrare lådprodukt — och när användaren
 * sedan valde ett stort paket försvann leverantören ur listan trots att den
 * hade ett giltigt alternativ.
 */
export function optionsForPackage(
  options: readonly ShippingOption[],
  size: PackageSize
): ShippingOption[] {
  const best = new Map<string, ShippingOption>();
  for (const o of options) {
    if (!fitsPackage(o.limits, size)) continue;
    const prev = best.get(o.provider);
    if (
      !prev ||
      o.priceKr < prev.priceKr ||
      (o.priceKr === prev.priceKr && capacity(o.limits) > capacity(prev.limits))
    ) {
      best.set(o.provider, o);
    }
  }
  return [...best.values()].sort((a, b) => a.priceKr - b.priceKr);
}

interface RawSpan {
  weight?: number;
  products?: RawProduct[] | null;
}

/**
 * Rå JSON → viktspann med allt klienten behöver, "Alternative" bortsorterad
 * (den har pris 0 och är vår egen "Egen frakt"-rad, inte ett fraktbolag).
 * Ren funktion — testad i tests/unit/tradera-listing-options.test.ts.
 */
export function normalizeShippingOptions(raw: unknown): ShippingWeightSpan[] {
  const spans = (raw as { productsPerWeightSpan?: RawSpan[] } | null)?.productsPerWeightSpan;
  if (!Array.isArray(spans)) return [];
  const out: ShippingWeightSpan[] = [];
  for (const span of spans) {
    const weightKg = typeof span?.weight === "number" ? span.weight : null;
    if (weightKg == null || weightKg <= 0) continue;
    const options: ShippingOption[] = [];
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
      const eta = p.deliveryInformation?.estimatedDeliveryTime ?? null;
      options.push({
        productId: p.id,
        providerId: p.shippingProviderId,
        provider: p.shippingProvider ?? String(p.shippingProviderId),
        priceKr: p.price,
        tracked: p.deliveryInformation?.isTraceable === true,
        servicePoint: p.deliveryInformation?.servicePoint === true,
        minDays: typeof eta?.minWeekdays === "number" && eta.minWeekdays > 0 ? eta.minWeekdays : null,
        maxDays: typeof eta?.maxWeekdays === "number" && eta.maxWeekdays > 0 ? eta.maxWeekdays : null,
        limits: p.packageRequirements ?? {},
      });
    }
    // ⛔ INGEN KOLLAPS HÄR. Samma leverantör ligger med flera produkter för
    // olika paketformat, och vilken som gäller vet först den som valt storlek —
    // se optionsForPackage.
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
