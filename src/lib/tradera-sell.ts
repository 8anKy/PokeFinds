/**
 * Tradera-listning (Fas 2) — skapar en "Köp nu"-annons via REST API v4.
 * Flöde: POST items (autoCommit=false) → POST images → POST commit → hämta
 * annonsens URL via seller-items (matchar på vår ownReference).
 * Kräver användarens token (kontokopplingen, se tradera-auth.ts).
 * Schema verifierat mot https://api.tradera.com/v4/swagger/v4/swagger.json
 */
const stripQuotes = (v: string) => v.trim().replace(/^["']|["']$/g, "");
const APP_ID = stripQuotes(process.env.TRADERA_APP_ID ?? "");
const APP_KEY = stripQuotes(process.env.TRADERA_APP_KEY ?? "");
const BASE = "https://api.tradera.com";

// Tradera item-typ 3 = "Endast Köp Nu" (fast pris). 60 dagars löptid = längsta.
const ITEM_TYPE_BUY_NOW = 3;
const DURATION_DAYS = 60;
// "Alternative"-frakt: säljaren anger egen fraktkostnad. Måste anges som
// shippingProviderId (6), INTE shippingOptionId — API:t kräver exakt ett av dem,
// och shippingOptionId:10 ger 500. Bekräftat via dry-run mot API:t 2026-07-02.
const SHIPPING_PROVIDER_ALTERNATIVE = 6;
// Köpare inom Sverige (GET /v4/reference-data/accepted-bidder-types: 1=SE, 3=Int, 4=EU).
// Krävs — utan den svarar API:t "AllowedBuyerRegionInvalid".
const ACCEPTED_BIDDER_SWEDEN = 1;
// Språk-attributet för Pokémon-kategorierna (GET .../attribute-definitions).
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

interface ListingInput {
  userId: string; // Traderas userId
  token: string;
  title: string;
  description: string;
  categoryId: number;
  priceKr: number; // Köp nu-pris i hela kronor
  shippingKr: number; // fraktkostnad i hela kronor
  languageTerm?: string;
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

/** Skapar annonsen och returnerar dess publika Tradera-URL. Kastar vid fel. */
export async function createTraderaListing(input: ListingInput): Promise<{ url: string }> {
  const h = headers(input);

  const created = await call("/v4/listings/items", h, {
    title: input.title.slice(0, 50),
    categoryId: input.categoryId,
    itemType: ITEM_TYPE_BUY_NOW,
    buyItNowPrice: Math.round(input.priceKr),
    duration: DURATION_DAYS,
    restarts: 0,
    description: input.description,
    autoCommit: false,
    acceptedBidderId: ACCEPTED_BIDDER_SWEDEN,
    shippingOptions: [
      { shippingProviderId: SHIPPING_PROVIDER_ALTERNATIVE, cost: Math.round(input.shippingKr) },
    ],
    ...(input.languageTerm
      ? { attributeValues: { terms: [{ id: LANGUAGE_ATTRIBUTE_ID, values: [input.languageTerm] }] } }
      : {}),
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
      ? `https://www.tradera.com/item/0/${itemId}`
      : "https://www.tradera.com/my/items/selling",
  };
}
