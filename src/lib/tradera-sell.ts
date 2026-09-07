/**
 * Tradera-listning (Fas 2) — skapar en Köp nu- eller AUKTIONS-annons via REST API v4.
 * Flöde: POST items (autoCommit=false) → POST images → POST commit → hämta
 * annonsens URL via seller-items (matchar på vår ownReference).
 * Kräver användarens token (kontokopplingen, se tradera-auth.ts).
 * Schema verifierat mot https://api.tradera.com/v4/swagger/v4/swagger.json
 */
import { SHIPPING_PROVIDER_ALTERNATIVE } from "./tradera-shipping";
import { GRADE_ID, GRADING_ISSUER_ID, traderaItemUrl } from "./tradera-listing-options";

const stripQuotes = (v: string) => v.trim().replace(/^["']|["']$/g, "");
const APP_ID = stripQuotes(process.env.TRADERA_APP_ID ?? "");
const APP_KEY = stripQuotes(process.env.TRADERA_APP_KEY ?? "");
const BASE = "https://api.tradera.com";

// Item-typ och löptider bor i lib/tradera-listing-options.ts (ren modul som
// klienten också läser) — samma tal i formuläret som i anropet.
// "Alternative"-frakt: säljaren anger egen fraktkostnad. Måste anges som
// shippingProviderId (6), INTE shippingOptionId — API:t kräver exakt ett av dem,
// och shippingOptionId:10 ger 500. Bekräftat via dry-run mot API:t 2026-07-02.
// Ett RIKTIGT fraktbolag anges i stället med shippingProductId + providerId, och
// `cost` är fortfarande obligatoriskt (se ItemShipping i Traderas swagger).
// Köpare inom Sverige (GET /v4/reference-data/accepted-bidder-types: 1=SE, 3=Int, 4=EU).
// Krävs — utan den svarar API:t "AllowedBuyerRegionInvalid".
const ACCEPTED_BIDDER_SWEDEN = 1;
// Språk-attributet för Pokémon-kategorierna (GET /v4/categories/{id}/attribute-definitions).
// Bolag (125) och betyg (126) kommer ur SAMMA svar — se tradera-listing-options.ts.
const LANGUAGE_ATTRIBUTE_ID = 124;

/** ProductCategory → Traderas Pokémon-kategoriträd (samma ids som tradera-adapter.ts). */
export function traderaCategoryId(category: string | null, isSingle: boolean): number {
  if (isSingle || category === "SINGLE_CARD" || category === "GRADED_CARD") return 1001337;
  if (category === "BOOSTER_BOX") return 1001340;
  if (category === "BOOSTER_PACK") return 1001339;
  return 1001341; // ETB/tin/blister/bundle/övrigt sealed
}

/** CardLanguage → Traderas språk-term (endast de Tradera stödjer; annars ingen term). */
export function traderaLanguageTerm(language: string | null): string | undefined {
  return { EN: "Engelska", JP: "Japanska", DE: "Tyska", FR: "Franska", OTHER: "Övriga" }[
    language ?? ""
  ];
}

/** data:-URL eller rått base64 → { data, format } för AddItemImage (ImageFormat: 0=Jpeg,1=Gif,2=Png). */
export function parseImage(dataUrl: string): { data: string; format: number } {
  const m = dataUrl.match(/^data:image\/(jpeg|jpg|png|gif);base64,(.+)$/i);
  const mime = m ? m[1].toLowerCase() : "jpeg";
  const data = m ? m[2] : dataUrl;
  const format = mime === "gif" ? 1 : mime === "png" ? 2 : 0;
  return { data, format };
}

/** Vald frakt: ett riktigt fraktbolag, eller vårt gamla "eget belopp". */
export interface ListingShipping {
  costKr: number;
  /** Traderas produkt-id ur referensdatan. Utelämnas → "Alternative" (eget belopp). */
  productId?: number;
  providerId?: number;
  /** Viktspannet produkten hör till, i kilo. Följer med som shippingWeight. */
  weightKg?: number;
}

interface ListingInput {
  userId: string; // Traderas userId
  token: string;
  title: string;
  description: string;
  categoryId: number;
  /** Köp nu-pris i hela kronor. Utelämnas för en ren auktion. */
  priceKr?: number;
  /** Utgångspris i hela kronor — bara auktioner. */
  startPriceKr?: number;
  itemType: number;
  durationDays: number;
  /** Ett eller FLERA fraktsätt — köparen väljer i kassan. */
  shipping: ListingShipping[];
  /**
   * Momssats i procent (0/6/12/25). Bara för säljare som redovisar moms —
   * privatpersoner ska inte skicka något alls. Traderas fält heter `vat` och är
   * en SATS, inte ett belopp (jfr `vatPercent` på fraktprodukterna).
   */
  vatPercent?: number;
  languageTerm?: string;
  /** Traderas term för graderingsbolaget ("PSA"), aldrig fri text. */
  gradingIssuerTerm?: string;
  /** Traderas term för betyget ("10", "9.5"), aldrig fri text. */
  gradeTerm?: string;
  images: { data: string; format: number }[]; // första bilden = huvudbild
}

function headers(input: ListingInput): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "X-App-Id": APP_ID,
    "X-App-Key": APP_KEY,
    "X-User-Id": input.userId,
    "X-User-Token": input.token,
  };
}

async function call(path: string, h: Record<string, string>, body?: unknown) {
  const res = await fetch(BASE + path, {
    method: "POST",
    headers: h,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`Tradera ${path} → HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  return res;
}

/**
 * Fraktraden i skapa-anropet. Ett riktigt fraktbolag identifieras av sin PRODUKT
 * (id:t är unikt bara ihop med leverantören) och `cost` måste ändå med — API:t
 * räknar fortfarande köparens fraktpris ur det fältet. Utan produkt faller vi
 * tillbaka på "Alternative", exakt som annonserna vi skapat hittills.
 */
function shippingPayload(shipping: ListingShipping): Record<string, unknown> {
  const cost = Math.max(0, Math.round(shipping.costKr));
  if (shipping.productId != null && shipping.providerId != null) {
    return {
      shippingProductId: shipping.productId,
      shippingProviderId: shipping.providerId,
      cost,
      ...(shipping.weightKg != null ? { shippingWeight: shipping.weightKg } : {}),
    };
  }
  return { shippingProviderId: SHIPPING_PROVIDER_ALTERNATIVE, cost };
}

/** Skapar annonsen och returnerar dess publika Tradera-URL + objektnr. Kastar vid fel. */
export async function createTraderaListing(
  input: ListingInput
): Promise<{ url: string; itemId?: string }> {
  const h = headers(input);

  // Strukturerade attribut: språk, graderingsbolag och betyg. ⛔ Bara termer ur
  // Traderas egna `possibleTermValues` — API:t avvisar allt annat.
  const terms = [
    input.languageTerm ? { id: LANGUAGE_ATTRIBUTE_ID, values: [input.languageTerm] } : null,
    input.gradingIssuerTerm ? { id: GRADING_ISSUER_ID, values: [input.gradingIssuerTerm] } : null,
    input.gradeTerm ? { id: GRADE_ID, values: [input.gradeTerm] } : null,
  ].filter((t): t is { id: number; values: string[] } => t !== null);

  const created = await call("/v4/listings/items", h, {
    title: input.title.slice(0, 50),
    categoryId: input.categoryId,
    itemType: input.itemType,
    ...(input.priceKr != null ? { buyItNowPrice: Math.round(input.priceKr) } : {}),
    ...(input.startPriceKr != null ? { startPrice: Math.round(input.startPriceKr) } : {}),
    duration: input.durationDays,
    restarts: 0,
    description: input.description,
    autoCommit: false,
    acceptedBidderId: ACCEPTED_BIDDER_SWEDEN,
    shippingOptions: input.shipping.map(shippingPayload),
    ...(input.vatPercent != null ? { vat: input.vatPercent } : {}),
    ...(terms.length > 0 ? { attributeValues: { terms } } : {}),
  });
  const { requestId, itemId } = (await created.json()) as { requestId: number; itemId?: number };

  // En bild-POST per foto (första = huvudbild). Bilderna läggs på samma request.
  for (const img of input.images) {
    await call(`/v4/listings/items/${requestId}/images`, h, {
      imageData: img.data,
      imageFormat: img.format,
      hasMega: false,
    });
  }
  await call(`/v4/listings/items/${requestId}/commit`, h);

  // itemId från create-svaret = annonsens objektnr → bygg publik URL direkt.
  return {
    url: itemId
      ? traderaItemUrl(itemId)
      : "https://www.tradera.com/my/items/selling",
    itemId: itemId != null ? String(itemId) : undefined,
  };
}
