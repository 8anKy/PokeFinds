/**
 * Hämtar tillverkarens streckkod (GTIN) för EN butiksannons.
 *
 * VARFÖR DEN INTE LIGGER I fetchProducts(): restock-skanningen kör var 2:a minut och
 * anropar fetchProducts() på varje bevakad butik. La vi GTIN-hämtningen där skulle vi
 * skicka hundratals extra requests VARANNAN MINUT mot butikerna — oartigt och onödigt.
 * Ingen butik exponerar streckkoden på kategorisidan; den kostar alltid en extra
 * request per PRODUKT. Därför hämtas den bara:
 *   1. vid auto-import (ensureListingProduct) — dvs bara för NYA SKU:er, några per dygn
 *   2. i backfill-/enrichment-jobbet (scripts/backfill-gtin.ts) — engångs + dagligen
 * Katalogens storlek påverkar alltså aldrig restock-lanens kostnad.
 *
 * Varje butik har sin egen väg (mätt 2026-07-13):
 *   Shopify (DL, Speltrollet, Goblinen, Manatörsk, Samlarhobby)
 *       → GET /products/{handle}.js → variants[0].barcode
 *         OBS: /products.json innehåller INTE barcode (Shopify utelämnar det med flit).
 *         Ett negativt svar därifrån bevisar ingenting.
 *   JSON-LD (Alphaspel, MaxGaming, Spelexperten)
 *       → <script type="application/ld+json"> i RÅ HTML → gtin / gtin8 / gtin12 / gtin13
 *         OBS: MaxGamings nyckel heter gtin8 men värdena är 12–13 siffror.
 *   Webhallen
 *       → GET /api/product/{id} → eans[] (array, ingen auth)
 *   Quickbutik (Swepoke, Shinycards)
 *       → INGEN kod finns. Permanent titelmatchning.
 */
import { politeFetch } from "./http";
import { normalizeGtin } from "@/lib/gtin";

type GtinStrategy = "shopify-js" | "json-ld" | "webhallen-api" | "none";

/**
 * Butik → hämtningsväg. Namnen MÅSTE matcha SCRAPER_ADAPTERS i runner.ts.
 * "none" = butiken publicerar bevisligen ingen kod (mätt) → hämta aldrig, spara requests.
 */
export const STORE_GTIN_STRATEGY: Record<string, GtinStrategy> = {
  "Dragon's Lair": "shopify-js",
  Speltrollet: "shopify-js",
  Goblinen: "shopify-js",
  Manatörsk: "shopify-js",
  // Samlarhobby: Shopify HAR fältet men det är NULL på hela sortimentet (backfill 2026-07-13:
  // 0 av 141 offers, och butiken 429:ade oss för besväret). Fråga inte igen.
  Samlarhobby: "none",
  Alphaspel: "json-ld",
  MaxGaming: "json-ld",
  // SPELEXPERTEN ÄR AVSTÄNGD — de HITTAR PÅ STRECKKODER.
  // Mätt 2026-07-13: bara 61% (106/175) av deras koder bär ett känt Pokémon-GS1-prefix.
  // De övriga 69 är påhittade internnummer MED GILTIG CHECKSIFFRA, så de tar sig förbi
  // checksummevalideringen. Bevis: "Ascended Heroes Tech Sticker" — Dragon's Lair,
  // Speltrollet och MaxGaming är alla eniga om 196214132290, Spelexperten säger
  // 7824204152470. Alla andra butiker ligger på 96–100% äkta prefix.
  //
  // En butik som hittar på koder är VÄRRE än en butik utan koder: en falsk kod skapar en
  // falsk KONFLIKT, som blockerar en korrekt merge → dubbletter. Utan kod faller
  // Spelexperten tillbaka på titelmatchning precis som förut = ingen regression.
  //
  // Frestas inte att "rädda" de 61% med en prefix-allowlist: den skulle samtidigt kasta
  // äkta koder för icke-TPCi-varor (Ultra Pro-pärmar m.m., 0074427…) och vi kan ändå inte
  // skilja en påhittad kod från en äkta okänd. Hellre ingen kod än en påhittad.
  Spelexperten: "none",
  Webhallen: "webhallen-api",
  // Quickbutik: uttömmande sökning i rå HTML hittade ingen gtin/ean/streckkod alls.
  Swepoke: "none",
  Shinycards: "none",
  // Marknadsplatser/API-källor har aldrig butiksstreckkoder.
  Tradera: "none",
  Cardmarket: "none",
};

/** Alla ld+json-block i rå HTML. WebFetch/markdown-konvertering STRIPPAR <script> — använd rå text. */
function parseJsonLdBlocks(html: string): unknown[] {
  const blocks: unknown[] = [];
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    try {
      blocks.push(JSON.parse(m[1].trim()));
    } catch {
      // Trasig JSON-LD i en butik ska inte döda hämtningen.
    }
  }
  return blocks;
}

/** Plattar ut @graph/arrayer och plockar Product-noderna. */
function collectProductNodes(node: unknown, out: Record<string, unknown>[] = []): Record<string, unknown>[] {
  if (!node) return out;
  if (Array.isArray(node)) {
    for (const n of node) collectProductNodes(n, out);
    return out;
  }
  if (typeof node !== "object") return out;
  const obj = node as Record<string, unknown>;
  const type = obj["@type"];
  const isProduct = type === "Product" || (Array.isArray(type) && type.includes("Product"));
  if (isProduct) out.push(obj);
  if (obj["@graph"]) collectProductNodes(obj["@graph"], out);
  return out;
}

/**
 * Läser streckkoden ur ett schema.org-Product-block.
 * Provar ALLA gtin-varianter — butikerna namnger fältet olika och namnet ljuger:
 * MaxGaming skriver `gtin8` med 12–13-siffriga värden.
 */
export function gtinFromJsonLd(html: string): string | null {
  const codes = new Set<string>();
  for (const block of parseJsonLdBlocks(html)) {
    for (const product of collectProductNodes(block)) {
      for (const key of ["gtin", "gtin14", "gtin13", "gtin12", "gtin8", "ean", "isbn"]) {
        const hit = normalizeGtin(product[key] as string | undefined);
        if (hit) {
          codes.add(hit);
          break; // en kod per Product-nod — inte flera stavningar av samma fält
        }
      }
    }
  }
  // Flera OLIKA koder på samma sida (varianter, relaterade produkter i markupen) = tvetydigt.
  // Gissa inte: ingen kod → titelmatchningen tar över, precis som förut.
  return codes.size === 1 ? [...codes][0] : null;
}

/** Shopify-handle ur en produkt-URL: …/products/{handle}[?…] (även med /en/-prefix). */
export function shopifyHandleFromUrl(url: string): string | null {
  const m = url.match(/\/products\/([^/?#]+)/);
  return m ? m[1] : null;
}

/** Webhallens produkt-id är den ledande siffergruppen i slugen: /product/389126-Namn. */
export function webhallenIdFromUrl(url: string): string | null {
  const m = url.match(/\/product\/(\d+)/);
  return m ? m[1] : null;
}

/**
 * Memo per körning: samma URL slås upp på flera ställen i en skanning (auto-import,
 * huvudboksraden). Utan cachen hade vi betalat en HTTP-request per uppslag.
 * Rensas när processen dör — jobben är kortlivade, så ingen invalidering behövs.
 */
const memo = new Map<string, string | null>();

/**
 * Hämtar GTIN för en enskild butiks-URL. Returnerar null när butiken inte publicerar
 * någon kod, produkten saknar den, eller hämtningen misslyckas — ALDRIG ett kast.
 * Saknad kod är ett normaltillstånd, inte ett fel: matchningen faller då tillbaka på
 * titelvägen precis som förut.
 */
export async function fetchListingGtin(sourceName: string, url: string): Promise<string | null> {
  const strategy = STORE_GTIN_STRATEGY[sourceName] ?? "none";
  if (strategy === "none") return null;

  const cacheKey = `${sourceName}:${url}`;
  if (memo.has(cacheKey)) return memo.get(cacheKey)!;
  const found = await resolveGtin(strategy, url, sourceName);
  memo.set(cacheKey, found);
  return found;
}

async function resolveGtin(
  strategy: GtinStrategy,
  url: string,
  sourceName: string
): Promise<string | null> {
  try {
    if (strategy === "shopify-js") {
      const handle = shopifyHandleFromUrl(url);
      if (!handle) return null;
      const origin = new URL(url).origin;
      // Svenska marknaden pinnad (samma skäl som ShopifyAdapter: annars ex-moms-pris —
      // spelar ingen roll för barcode, men håll requesten identisk med adapterns).
      const res = await politeFetch(`${origin}/products/${handle}.js`, {
        delayMs: 800,
        headers: { cookie: "localization=SE", "accept-language": "sv-SE" },
      });
      if (!res.ok) return null;
      const data = (await res.json()) as { variants?: { barcode?: string | null }[] };
      // TA ALDRIG variants[0] RAKT AV. En Shopify-sida kan sälja flera varianter (olika
      // Pokémon i samma tin-serie, olika färger) med VAR SIN streckkod — då är "första
      // varianten" ett myntkast, och vi skulle sätta fel kod på produkten. Är varianterna
      // oense: returnera INGEN kod och låt titelmatchningen ta över. Hellre ingen kod än fel.
      const codes = new Set(
        (data.variants ?? []).map((v) => normalizeGtin(v.barcode)).filter((g): g is string => !!g)
      );
      return codes.size === 1 ? [...codes][0] : null;
    }

    if (strategy === "webhallen-api") {
      const id = webhallenIdFromUrl(url);
      if (!id) return null;
      const res = await politeFetch(`https://www.webhallen.com/api/product/${id}`, { delayMs: 800 });
      if (!res.ok) return null;
      const data = (await res.json()) as { product?: { eans?: string[] }; eans?: string[] };
      return normalizeGtin(data.product?.eans ?? data.eans ?? null);
    }

    // json-ld
    const res = await politeFetch(url, { delayMs: 800 });
    if (!res.ok) return null;
    return gtinFromJsonLd(await res.text());
  } catch (err) {
    console.warn(
      `[gtin] Kunde inte hämta streckkod för ${sourceName} ${url}: ${err instanceof Error ? err.message : err}`
    );
    return null;
  }
}
