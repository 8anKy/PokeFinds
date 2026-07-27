/**
 * Verifierar lagerstatus för EN butiks-URL genom att fråga butikens EGEN produktsida.
 *
 * VARFÖR: butikernas kategorifeedar är inte kompletta. En URL kan försvinna ur feeden
 * utan att varan gjort något — Speltrollet listar inte sina slutsålda varor i de
 * Pokémon-kollektioner vi hämtar, Swepoke roterar sortimentet, och vår egen parser
 * kunde tappa produkter (se productHrefInBlock). Frånvaro ur feeden är alltså inget
 * bevis: därför nollades sådana offers till UNKNOWN, vilket i pristabellen blev
 * "Okänd" bredvid ett dagsgammalt pris (Pitch Black ETB, 2026-07-25).
 *
 * Frånvaro behöver inte tolkas — den kan KOLLAS. Den här modulen frågar produktsidan
 * rakt av och ger ett riktigt svar. Kostnaden är hårt avgränsad: BARA offers som
 * försvunnit ur feeden längre än karenstiden slås upp (~35 st totalt vid införandet,
 * en handfull per dygn därefter), aldrig katalogen. Samma skäl som GTIN-uppslaget
 * ligger utanför restock-lanen — se gtin-source.ts.
 *
 * Butikerna svarar på olika sätt (mätt mot riktiga produktsidor 2026-07-28):
 *   Shopify (DL, Speltrollet, Goblinen, Manatörsk, Samlarhobby)
 *       → GET /products/{handle}.js → variants[].available (definitivt, per variant)
 *   JSON-LD (Alphaspel, MaxGaming, Spelexperten, Shinycards)
 *       → <script type="application/ld+json"> → offers.availability
 *   Webhallen
 *       → GET /api/product/{id} → stock.web + release (samma dom som adaptern)
 *   Swepoke
 *       → INGET. Produktsidan renderas av Alpine.js i webbläsaren ("outOfStock === false"
 *         är en template-gren, inte ett tillstånd) — knapptexten finns i markupen oavsett
 *         lagerläge. Swepokes KATEGORISIDA bär däremot äkta markörer, så feeden är
 *         källan där.
 *
 * Kan vi inte avgöra det → null. Då står UNKNOWN kvar, precis som förut. Att gissa
 * "slutsåld" på en tyst butik vore samma sorts påstående vi byggde UNKNOWN för att slippa.
 */
import { StockStatus } from "@prisma/client";
import { politeFetch } from "./http";
import {
  collectProductNodes,
  parseJsonLdBlocks,
  shopifyHandleFromUrl,
  variantIdFromUrl,
  webhallenIdFromUrl,
} from "./gtin-source";
import { webhallenStockStatus } from "./adapters/webhallen-adapter";

type StockStrategy = "shopify-js" | "json-ld" | "webhallen-api" | "none";

/** Butik → väg till lagerstatus. Namnen MÅSTE matcha SCRAPER_ADAPTERS i runner.ts. */
export const STORE_STOCK_STRATEGY: Record<string, StockStrategy> = {
  "Dragon's Lair": "shopify-js",
  Speltrollet: "shopify-js",
  Goblinen: "shopify-js",
  Manatörsk: "shopify-js",
  Samlarhobby: "shopify-js",
  Alphaspel: "json-ld",
  MaxGaming: "json-ld",
  // Spelexperten är avstängd för GTIN (påhittade koder) — availability är en ANNAN
  // uppgift och den stämmer (mätt mot två slutsålda sidor 2026-07-28).
  Spelexperten: "json-ld",
  Shinycards: "json-ld",
  Webhallen: "webhallen-api",
  // Se modulens huvudkommentar: Swepokes produktsida är klient-renderad.
  Swepoke: "none",
  // Marknadsplatser: annonser tar slut, de "restockar" inte. Tradera-svepet nollar
  // utgångna annonser själv, och Cardmarket har ingen lagerstatus att fråga om.
  Tradera: "none",
  Cardmarket: "none",
};

/** schema.org-availability → vår status. Nyckeln är gemener utan URL-prefix. */
const AVAILABILITY: Record<string, StockStatus> = {
  instock: StockStatus.IN_STOCK,
  instoreonly: StockStatus.IN_STOCK,
  onlineonly: StockStatus.IN_STOCK,
  limitedavailability: StockStatus.LIMITED,
  presale: StockStatus.PREORDER,
  preorder: StockStatus.PREORDER,
  backorder: StockStatus.PREORDER,
  outofstock: StockStatus.OUT_OF_STOCK,
  soldout: StockStatus.OUT_OF_STOCK,
  discontinued: StockStatus.OUT_OF_STOCK,
};

function availabilityToStatus(raw: unknown): StockStatus | null {
  if (typeof raw !== "string") return null;
  const key = raw.replace(/^https?:\/\/schema\.org\//i, "").replace(/[^a-z]/gi, "").toLowerCase();
  return AVAILABILITY[key] ?? null;
}

/**
 * Lagerstatus ur sidans JSON-LD.
 *
 * Sidor bär ofta FLERA Product-noder (relaterade varor, "andra köpte också"). Vi kan
 * inte veta vilken som är vår, så samma regel som för streckkoden gäller: säger noderna
 * OLIKA saker är svaret tvetydigt → null. Ett tvetydigt svar lämnar UNKNOWN kvar, vilket
 * är sant; ett gissat svar hade blivit en påhittad lagerstatus.
 */
export function stockFromJsonLd(html: string): StockStatus | null {
  const found = new Set<StockStatus>();
  for (const block of parseJsonLdBlocks(html)) {
    for (const product of collectProductNodes(block)) {
      const offers = product.offers;
      for (const offer of Array.isArray(offers) ? offers : [offers]) {
        if (!offer || typeof offer !== "object") continue;
        const status = availabilityToStatus((offer as Record<string, unknown>).availability);
        if (status) found.add(status);
      }
    }
  }
  return found.size === 1 ? [...found][0] : null;
}

interface ShopifyJsProduct {
  available?: boolean;
  variants?: { id?: number; available?: boolean }[];
}

/**
 * Lagerstatus ur Shopifys /products/{handle}.js.
 *
 * Pekar URL:en ut EN variant (?variant=…, sortimentssidor) gäller DEN variantens lager —
 * aldrig sidans. En sida som säljer tre boxar är i lager så fort EN av dem finns, och att
 * läsa det som "vår box finns" är exakt felet vi undviker på streckkodssidan också.
 */
export function stockFromShopifyJs(data: ShopifyJsProduct, wantedVariantId: number | null): StockStatus | null {
  const variants = data.variants ?? [];
  if (wantedVariantId !== null) {
    const hit = variants.find((v) => v.id === wantedVariantId);
    // Varianten borta ur butiken = vi vet inget om DEN varan längre.
    if (!hit || typeof hit.available !== "boolean") return null;
    return hit.available ? StockStatus.IN_STOCK : StockStatus.OUT_OF_STOCK;
  }
  if (variants.length) {
    return variants.some((v) => v.available) ? StockStatus.IN_STOCK : StockStatus.OUT_OF_STOCK;
  }
  if (typeof data.available === "boolean") {
    return data.available ? StockStatus.IN_STOCK : StockStatus.OUT_OF_STOCK;
  }
  return null;
}

/**
 * Vad ska offern stå på när uppslaget INTE gav svar (429, timeout, butik utan
 * strukturerad data)?
 *
 * Inte alltid UNKNOWN. Ett uteblivet svar är ingen ny upplysning, och att skriva över
 * ett KÄNT "slutsåld" med "okänd" bara för att butiken råkade strypa oss vore att kasta
 * bort information vi redan har — torrkörningen 2026-07-28 gjorde precis det med 5 av 18
 * kandidater (Goblinen och Samlarhobby 429:ade). Regeln: ett påstående vi inte längre
 * kan backa upp (IN_STOCK/PREORDER/LIMITED, satt av en feed som slutat nämna varan)
 * faller till UNKNOWN som förut; ett redan avgjort läge står kvar.
 */
export function statusAfterVerify(current: StockStatus, verified: StockStatus | null): StockStatus {
  if (verified) return verified;
  return current === StockStatus.OUT_OF_STOCK || current === StockStatus.UNKNOWN
    ? current
    : StockStatus.UNKNOWN;
}

/**
 * Slår upp lagerstatus för en butiks-URL. Kastar ALDRIG: nätfel, 404, 429 och butiker
 * utan strukturerad data ger alla null = "vet inte" (anroparen behåller UNKNOWN).
 *
 * 404 nollas MED FLIT inte till slutsåld: en borttagen sida betyder att länken är död,
 * inte att varan sålt slut. Döda länkar är länkrevisionens jobb (scripts/audit-links.ts).
 */
export async function verifyStockForUrl(sourceName: string, url: string): Promise<StockStatus | null> {
  const strategy = STORE_STOCK_STRATEGY[sourceName] ?? "none";
  if (strategy === "none") return null;

  try {
    if (strategy === "shopify-js") {
      const handle = shopifyHandleFromUrl(url);
      if (!handle) return null;
      const origin = new URL(url).origin;
      // Svenska marknaden pinnad — håll requesten identisk med ShopifyAdapterns.
      const res = await politeFetch(`${origin}/products/${handle}.js`, {
        delayMs: 800,
        headers: { cookie: "localization=SE", "accept-language": "sv-SE" },
      });
      if (!res.ok) return null;
      return stockFromShopifyJs((await res.json()) as ShopifyJsProduct, variantIdFromUrl(url));
    }

    if (strategy === "webhallen-api") {
      const id = webhallenIdFromUrl(url);
      if (!id) return null;
      const res = await politeFetch(`https://www.webhallen.com/api/product/${id}`, { delayMs: 800 });
      if (!res.ok) return null;
      const data = (await res.json()) as { product?: Parameters<typeof webhallenStockStatus>[0] };
      return data.product ? webhallenStockStatus(data.product) : null;
    }

    const res = await politeFetch(url, { delayMs: 800 });
    if (!res.ok) return null;
    return stockFromJsonLd(await res.text());
  } catch {
    // Butiken svarade inte (429 efter backoff, timeout, trasig JSON) → vet inte.
    return null;
  }
}
