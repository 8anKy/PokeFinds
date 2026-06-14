/**
 * Söker Tradera via officiellt SOAP-API efter specifika produkter som
 * saknar riktiga Tradera-annonser (price=null / search-only).
 *
 * Budgeterar TRADERA_MAX_SEARCH_CALLS (default 90) API-anrop per körning.
 * Varje sökning returnerar upp till 50 resultat → en sökning per produkt.
 *
 * Strategi:
 *  1. Hämtar produkter som har Tradera-offer med price=null (sök-URLs).
 *  2. Prioriterar dyrare/populärare produkter (sealed först, sedan singlar).
 *  3. Söker Tradera med produkttitel → matchar billigaste fastpris-annons.
 *  4. Uppdaterar offer med pris + direkt /item/ URL.
 *
 * Körs med: npx tsx scripts/search-tradera-targeted.ts
 * Env:      DRY_RUN=1   (enbart rapport)
 *           MAX_CALLS=90 (API-budget)
 *           CATEGORY=SINGLE_CARD|BOOSTER_BOX|... (filtrera kategori)
 */
import { PrismaClient, StockStatus } from "@prisma/client";

const prisma = new PrismaClient();
const DRY_RUN = process.env.DRY_RUN === "1";
const MAX_CALLS = parseInt(process.env.MAX_CALLS ?? "90", 10);
const CATEGORY_FILTER = process.env.CATEGORY ?? "";

const API_URL = "https://api.tradera.com/v3/searchservice.asmx";
const CALL_DELAY_MS = 1100; // Respektera rate limit

/** Tradera-kategorier vi söker i baserat på produktkategori. */
const TRADERA_CATEGORY: Record<string, number> = {
  SINGLE_CARD: 1001337,
  GRADED_CARD: 1001337,
  BOOSTER_BOX: 1001340,
  BOOSTER_PACK: 1001339,
  ETB: 1001341,
  COLLECTION_BOX: 1001341,
  TIN: 1001341,
  BLISTER: 1001339,
  BUNDLE: 1001341,
  OTHER: 293307,
  ACCESSORY: 293307,
};

function decodeEntities(text: string): string {
  return text
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function tagText(block: string, name: string): string | undefined {
  const m = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([^<]*)</${name}>`));
  if (!m) return undefined;
  const v = decodeEntities(m[1].trim());
  return v.length > 0 ? v : undefined;
}

function termAttributeValues(block: string, attrName: string): string[] {
  const m = block.match(
    new RegExp(`<Name>${attrName}</Name>([\\s\\S]*?)</TermAttributeValues>`)
  );
  if (!m) return [];
  return [...m[1].matchAll(/>([^<>]+)</g)]
    .map((x) => decodeEntities(x[1].trim()))
    .filter((v) => v.length > 0);
}

function buildSearchEnvelope(query: string, categoryId: number): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <Search xmlns="http://api.tradera.com">
      <query>${query.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</query>
      <categoryId>${categoryId}</categoryId>
      <pageNumber>1</pageNumber>
      <orderBy>PriceAscending</orderBy>
    </Search>
  </soap:Body>
</soap:Envelope>`;
}

interface TraderaListing {
  itemId: string;
  title: string;
  priceOre: number;
  url: string;
}

async function searchTradera(
  query: string,
  categoryId: number,
  appId: string,
  appKey: string
): Promise<TraderaListing[]> {
  const res = await fetch(`${API_URL}?appId=${appId}&appKey=${appKey}`, {
    method: "POST",
    headers: {
      "Content-Type": "text/xml; charset=utf-8",
      SOAPAction: '"http://api.tradera.com/Search"',
    },
    body: buildSearchEnvelope(query, categoryId),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const xml = await res.text();

  const results: TraderaListing[] = [];
  const blocks = [...xml.matchAll(/<Items>([\s\S]*?)<\/Items>/g)].map((m) => m[1]);

  for (const block of blocks) {
    const itemId = tagText(block, "Id");
    const title = tagText(block, "ShortDescription");
    if (!itemId || !title) continue;

    const binText = tagText(block, "BuyItNowPrice");
    const bin = binText ? parseInt(binText, 10) : NaN;
    if (!Number.isFinite(bin) || bin <= 0) continue;

    // Skip ended, auctions with bids
    if (tagText(block, "IsEnded") === "true") continue;
    const itemType = tagText(block, "ItemType") ?? "";
    if (itemType !== "PureBuyItNow" && tagText(block, "HasBids") === "true") continue;

    // Language check — skip non-English for singles
    const lang = termAttributeValues(block, "pokemon_language")[0];
    if (lang && !/^eng/i.test(lang)) continue;

    const rawUrl = tagText(block, "ItemUrl");
    const url = rawUrl
      ? rawUrl.replace(/^http:\/\//, "https://")
      : `https://www.tradera.com/item/0/${itemId}/`;

    results.push({ itemId, title, priceOre: bin * 100, url });
  }

  // Already sorted by price ascending from API
  return results;
}

/** Build a good search term for a product. */
function buildSearchQuery(product: {
  title: string;
  category: string;
  card?: { name: string; number: string; set: { name: string } } | null;
}): string {
  if (product.card) {
    // For singles: card name + set name gets better results
    const cardName = product.card.name;
    const setName = product.card.set.name;
    return `Pokemon ${cardName} ${setName}`;
  }
  // For sealed: use product title, ensure "Pokemon" prefix
  const t = product.title;
  if (/^pok[eé]mon/i.test(t)) return t;
  return `Pokemon ${t}`;
}

/** Simple title similarity — checks if Tradera listing seems to match our product. */
function titleMatches(
  traderaTitle: string,
  productTitle: string,
  cardName?: string
): boolean {
  const tLow = traderaTitle.toLowerCase();
  const pLow = productTitle.toLowerCase();

  // For cards: check card name appears in listing
  if (cardName) {
    const cLow = cardName.toLowerCase();
    if (!tLow.includes(cLow)) return false;
    // Reject lots/bundles
    if (/\b(lot|bundle|samling|set of|x\d+|\d+\s*st)\b/i.test(tLow)) return false;
    return true;
  }

  // For sealed: check significant words overlap
  const pWords = pLow.split(/\s+/).filter((w) => w.length > 3);
  const matchCount = pWords.filter((w) => tLow.includes(w)).length;
  return matchCount >= Math.ceil(pWords.length * 0.5);
}

async function main() {
  const appId = process.env.TRADERA_APP_ID;
  const appKey = process.env.TRADERA_APP_KEY;
  if (!appId || !appKey) {
    console.error("TRADERA_APP_ID/TRADERA_APP_KEY saknas i .env");
    process.exit(1);
  }

  const tradera = await prisma.retailer.findFirstOrThrow({
    where: { name: "Tradera" },
  });

  // Get products that have Tradera search-only offers (no real price)
  const whereClause: any = {
    retailerId: tradera.id,
    price: null,
  };
  if (CATEGORY_FILTER) {
    whereClause.product = { category: CATEGORY_FILTER };
  }

  const searchOffers = await prisma.offer.findMany({
    where: whereClause,
    select: {
      id: true,
      url: true,
      productId: true,
      product: {
        select: {
          id: true,
          title: true,
          category: true,
          card: {
            select: {
              name: true,
              number: true,
              set: { select: { name: true } },
            },
          },
        },
      },
    },
    // Prioritize sealed (higher value) and popular products
    orderBy: [
      { product: { clickCount: "desc" } },
    ],
    take: MAX_CALLS,
  });

  console.log(`🔍 Söker Tradera för ${searchOffers.length} produkter (budget: ${MAX_CALLS} API-anrop)`);
  if (DRY_RUN) console.log("   ⚠️ DRY_RUN — inga ändringar");

  let callsUsed = 0;
  let found = 0;
  let notFound = 0;
  let errors = 0;

  // Get scrape source for observations
  const source = await prisma.scrapeSource.findFirst({
    where: { name: "Tradera" },
    select: { id: true },
  });

  for (const offer of searchOffers) {
    if (callsUsed >= MAX_CALLS) break;

    const product = offer.product;
    const query = buildSearchQuery(product);
    const categoryId = TRADERA_CATEGORY[product.category] ?? 293307;

    try {
      if (callsUsed > 0) await new Promise((r) => setTimeout(r, CALL_DELAY_MS));
      callsUsed++;

      const listings = await searchTradera(query, categoryId, appId, appKey);

      // Find best matching listing (cheapest that matches title)
      const match = listings.find((l) =>
        titleMatches(l.title, product.title, product.card?.name)
      );

      if (match) {
        found++;
        console.log(
          `  ✅ ${product.title.slice(0, 50)} → ${(match.priceOre / 100).toFixed(0)} kr (${match.url.slice(-20)})`
        );

        if (!DRY_RUN) {
          await prisma.offer.update({
            where: { id: offer.id },
            data: {
              price: match.priceOre,
              url: match.url,
              stockStatus: StockStatus.IN_STOCK,
              lastSeenAt: new Date(),
            },
          });

          // Save observation
          if (source) {
            await prisma.priceObservation.create({
              data: {
                productId: product.id,
                sourceId: source.id,
                price: match.priceOre,
                currency: "SEK",
                condition: product.category === "SINGLE_CARD" ? "NEAR_MINT" : "SEALED",
                rawData: {
                  itemId: match.itemId,
                  title: match.title,
                  priceOre: match.priceOre,
                  url: match.url,
                  source: "tradera-targeted-search",
                },
              },
            });
          }
        }
      } else {
        notFound++;
      }
    } catch (err) {
      errors++;
      console.error(
        `  ❌ ${product.title.slice(0, 40)}: ${err instanceof Error ? err.message : err}`
      );
    }

    if (callsUsed % 10 === 0) {
      console.log(`   [${callsUsed}/${MAX_CALLS}] ✅ ${found} hittade | ❌ ${notFound} ej funna`);
    }
  }

  console.log(`\n🎉 Klart!`);
  console.log(`   API-anrop:  ${callsUsed}`);
  console.log(`   Hittade:    ${found}`);
  console.log(`   Ej funna:   ${notFound}`);
  console.log(`   Fel:        ${errors}`);
  if (DRY_RUN) console.log("   ⚠️ DRY_RUN — inga ändringar gjorda");
}

main()
  .catch((e) => {
    console.error("Misslyckades:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
