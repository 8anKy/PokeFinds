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

/**
 * Vilken strategi gäller för en URL vi inte har en handskriven rad för?
 *
 * ⛔ EN HANDHÅLLEN LISTA FALLER EFTER — DET HAR DEN REDAN GJORT. Tabellen ovan skrevs
 * när vi hade elva butiker; sedan dess har wave 4 och 5 lagt till 31 till, och ingen av
 * dem fick en rad. Följden är TYST och tvåsidig: `verifyStockForUrl` returnerar null,
 * så en offer vars URL försvunnit ur feeden faller till UNKNOWN i stället för att
 * kollas — och eftersom UNKNOWN→IN_STOCK inte räknas som en äkta övergång larmar
 * nästa påfyllning ALDRIG. 30 av 42 butiker satt i det läget (mätt 2026-08-15).
 *
 * Formen på URL:en avgör i stället: `…/products/{handle}` är Shopifys egen
 * produktväg, och `/products/{handle}.js` finns på varje Shopify-butik. En
 * uttrycklig rad i tabellen vinner alltid — inklusive `"none"` (Swepokes
 * klient-renderade sida, marknadsplatserna).
 */
export function resolveStockStrategy(sourceName: string, url: string): StockStrategy {
  const explicit = STORE_STOCK_STRATEGY[sourceName];
  if (explicit) return explicit;
  // `/products/{handle}` ⇒ pröva Shopifys `.js` först (definitivt svar, en request).
  // Svarar den inte faller shopify-grenen tillbaka på JSON-LD, så en Quickbutik-butik
  // med samma URL-form (Mystery Shack) hamnar ändå rätt.
  if (shopifyHandleFromUrl(url)) return "shopify-js";
  // Allt annat: läs produktsidans JSON-LD. Den ger null när den saknas eller är
  // tvetydig, dvs exakt samma utfall som "none" gav — men de butiker som FAKTISKT
  // publicerar `offers.availability` (de flesta Woo-/PrestaShop-/Starweb-teman) får
  // ett riktigt svar i stället för ett antagande.
  return "json-ld";
}

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
 * ⛔ SHOPIFYS `available` ÄR INTE SAMMA SAK SOM "GÅR ATT KÖPA" (2026-08-15).
 *
 * Kortarkivets "Mega Evolution: Ascended Heroes Booster Bundle (ME2.5)" svarade
 * `available: true` i BÅDE `/products.json` och `/products/{handle}.js`, och sidans
 * JSON-LD sa `schema.org/InStock` — medan storefronten visade "Slut i lager" och
 * renderade köpknappen med `disabled`. Alla tre "definitiva" källorna kommer ur samma
 * Liquid-fält, så de kan inte motsäga varandra; bara KNAPPEN vet.
 *
 * Kontrollerat innan slutsatsen drogs (metodläxan från Webhallens `discontinued`
 * 2026-08-14 — bevisa att fältet motsvarar KÖPBARHET, hitta fallet där de skiljer sig):
 *   · inte CDN-cache — cache-busting query gav samma svar, `cf-cache-status: DYNAMIC`
 *   · inte marknad/valuta — samma `localization=SE` som adaptern använder
 *   · inte taggen `locked` — 35 produkter bär den, 12 är köpbara
 *   · de två produkternas publika JSON är IDENTISK fält för fält utom taggar
 * Fördelningen: 1 av 35 av butikens Pokémon-varor i lager. Sällsynt, men tyst — och
 * ett falskt "i lager" är precis vad ett restock-larm INTE ska vara.
 *
 * DETEKTORN läser köpformuläret: `<form action=".../cart/add">` innehåller ett dolt
 * `name="id"` (variantens id) och en submit-knapp (`name="add"` /
 * `.product-form__submit`). Är knappen `disabled` eller bär den slutsåld-text kan
 * kunden inte köpa. Rent parsande, inget nätverk → testbart.
 *
 * ⛔ TVETYDIGT ⇒ null, aldrig en gissning. Sidor bär flera cart-formulär (avbetalning,
 *    snabbköp i "andra köpte också"). Vi väljer formuläret med RÄTT variant-id när
 *    URL:en pekar ut en; annars huvudformuläret; kan vi inte peka ut ett — null.
 */
const SOLD_OUT_BUTTON_TEXT =
  /slut\s*i\s*lager|slutsåld|slutsalgt|uts[åa]ld|sold\s*out|udsolgt|ausverkauft|ikke\s*på\s*lager|ej\s*i\s*lager/i;

/** Alla `<form action="…/cart/add…">`-block med sin råa HTML. */
function cartForms(html: string): { open: string; body: string }[] {
  const out: { open: string; body: string }[] = [];
  const re = /<form[^>]*action="[^"]*\/cart\/add[^"]*"[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const start = m.index;
    const end = html.indexOf("</form>", start);
    out.push({ open: m[0], body: html.slice(start, end === -1 ? start + 20000 : end) });
  }
  return out;
}

/** Formulärets dolda `name="id"` = variantens id. */
function hiddenVariantId(formHtml: string): number | null {
  const re = /<input\b[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(formHtml))) {
    const tag = m[0];
    if (!/\bname\s*=\s*"id"/i.test(tag)) continue;
    const v = /\bvalue\s*=\s*"(\d+)"/i.exec(tag);
    if (v) return Number(v[1]);
  }
  return null;
}

function buyButton(formHtml: string): { tag: string; text: string } | null {
  const re = /<button\b[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(formHtml))) {
    const tag = m[0];
    if (/\bname\s*=\s*"add"/i.test(tag) || /product-form__submit/i.test(tag)) {
      const end = formHtml.indexOf("</button>", m.index);
      return { tag, text: formHtml.slice(m.index, end === -1 ? m.index : end).replace(/<[^>]*>/g, " ") };
    }
  }
  return null;
}

/** true = kunden kan lägga i varukorgen, false = kan inte, null = går inte att avgöra. */
export function purchasableFromShopifyPage(html: string, wantedVariantId: number | null): boolean | null {
  const forms = cartForms(html).map((f) => ({ ...f, variantId: hiddenVariantId(f.body) }));
  if (!forms.length) return null;

  let chosen: (typeof forms)[number] | null = null;
  if (wantedVariantId !== null) {
    chosen = forms.find((f) => f.variantId === wantedVariantId) ?? null;
    // URL:en pekade ut en variant som inte finns på sidan → vi vet inget om DEN varan.
    if (!chosen) return null;
  }
  if (!chosen) {
    const main = forms.filter((f) => /product-form|main-product/i.test(f.open));
    const withId = forms.filter((f) => f.variantId !== null);
    if (main.length === 1) chosen = main[0];
    else if (main.length > 1) {
      const withButton = main.filter((f) => buyButton(f.body));
      chosen = withButton.length === 1 ? withButton[0] : null;
    } else if (withId.length === 1) chosen = withId[0];
  }
  if (!chosen) return null;

  const btn = buyButton(chosen.body);
  if (!btn) return null;
  if (/\bdisabled\b/i.test(btn.tag)) return false;
  if (SOLD_OUT_BUTTON_TEXT.test(btn.text)) return false;
  return true;
}

/**
 * Hämtar butikens produktsida och svarar: kan kunden köpa varan NU?
 *
 * `null` = vet inte (nätfel, 404, tvetydig sida) — anroparen ska då LITA PÅ FEEDEN.
 * Ett uteblivet svar är ingen ny upplysning, och att tolka det som "slutsåld" hade
 * gjort varje 429 till ett tyst bortfall av restock-larm. Samma regel som
 * statusAfterVerify nedan bygger på.
 *
 * ⛔ ANROPA BARA VID EN LAGERÖVERGÅNG, aldrig per annons i en feed-loop. En
 *    produktsida är ~500 kB mot feed-JSON:ens några hundra byte per vara; att slå upp
 *    hela sortimentet vore hundratals megabyte per svep ur butikernas servrar. Antalet
 *    övergångar är litet (mätt: 12–27 per dygn över alla butiker), och det är exakt
 *    de tillfällen då svaret spelar roll.
 */
export async function fetchShopifyPurchasable(url: string): Promise<boolean | null> {
  try {
    const res = await politeFetch(url, {
      delayMs: 800,
      // Samma marknad som ShopifyAdapter pinnar — annars kan en annan marknads
      // sortiment/pris rendera en annan knapp.
      headers: { cookie: "localization=SE", "accept-language": "sv-SE" },
    });
    if (!res.ok) return null;
    return purchasableFromShopifyPage(await res.text(), variantIdFromUrl(url));
  } catch {
    return null;
  }
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
  const strategy = resolveStockStrategy(sourceName, url);
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
      // Ingen `.js` ⇒ butiken är inte Shopify trots `/products/`-formen (Mystery Shack
      // kör Quickbutik på samma väg). Fall tillbaka på JSON-LD i stället för att svara
      // "vet inte" — annars hade formgissningen gjort verifieringen SÄMRE för dem.
      if (!res.ok) return await stockFromPageJsonLd(url);
      const fromJs = stockFromShopifyJs((await res.json()) as ShopifyJsProduct, variantIdFromUrl(url));
      // `available: false` är definitivt — Shopify ljuger aldrig ÅT DET HÅLLET.
      if (fromJs !== StockStatus.IN_STOCK) return fromJs;
      // `available: true` är däremot inte samma sak som köpbar (se
      // purchasableFromShopifyPage). Bekräfta mot storefronten innan vi påstår "i
      // lager" om en vara vars URL försvunnit ur feeden — det är just den sortens
      // påstående UNKNOWN en gång infördes för att slippa.
      const purchasable = await fetchShopifyPurchasable(url);
      return purchasable === false ? StockStatus.OUT_OF_STOCK : StockStatus.IN_STOCK;
    }

    if (strategy === "webhallen-api") {
      const id = webhallenIdFromUrl(url);
      if (!id) return null;
      const res = await politeFetch(`https://www.webhallen.com/api/product/${id}`, { delayMs: 800 });
      if (!res.ok) return null;
      const data = (await res.json()) as { product?: Parameters<typeof webhallenStockStatus>[0] };
      return data.product ? webhallenStockStatus(data.product) : null;
    }

    return await stockFromPageJsonLd(url);
  } catch {
    // Butiken svarade inte (429 efter backoff, timeout, trasig JSON) → vet inte.
    return null;
  }
}

/** Hämtar produktsidan och läser lagerstatus ur dess JSON-LD. Null = vet inte. */
async function stockFromPageJsonLd(url: string): Promise<StockStatus | null> {
  const res = await politeFetch(url, { delayMs: 800 });
  if (!res.ok) return null;
  return stockFromJsonLd(await res.text());
}
