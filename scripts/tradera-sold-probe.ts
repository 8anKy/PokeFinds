/**
 * TRADERA SÅLT — TÄCKNINGSMÄTNING FÖRE BYGGE. Rapport, aldrig skrivning.
 *
 *   node scripts/with-prod-db.mjs npx tsx scripts/tradera-sold-probe.ts
 *   node scripts/with-prod-db.mjs npx tsx scripts/tradera-sold-probe.ts --dump   (visa ett rått Items-block)
 *
 * Env: PAGES=4        sidor per kategori (50 träffar/sida)
 *      DAYS=30        rapportfönster för åldersfördelningen
 *
 * FRÅGAN VI SVARAR PÅ: räcker Traderas SÅLDA data för att ersätta annonskurvan i
 * prisgrafen, eller blir "Tradera sålt" en tom serie för nästan hela katalogen?
 *
 * ⛔ BARA AUKTIONER GÅR ATT VERIFIERA SOM SÅLDA. En avslutad `PureBuyItNow` har
 *    `HasBids=false` och `BuyItNowPrice == MaxBid` oavsett om någon köpte den eller
 *    om den bara löpte ut — de två tillstånden är IDENTISKA i svaret. En avslutad
 *    auktion med `HasBids=true` bär däremot ett vinnande bud i `MaxBid` (kronor),
 *    och det ÄR en genomförd affär. Allt annat vore fabricerad data.
 *
 * ⛔ SÅLT ÄR EN ANNAN STORHET ÄN "LÄGSTA ANNONS". Hammarpris är vad någon BETALADE;
 *    Cardmarket-serien är det lägsta någon BEGÄR. De får aldrig bo i samma serie,
 *    och underrubriken "dagens lägsta per källa" slutar gälla den dag sålt ritas.
 *
 * Skriptet skriver INGENTING och rör ingen kvot utöver sina egna sökanrop
 * (~PAGES × 4 kategorier mot SearchAdvanced, av 10 000/dygn).
 */
import * as fs from "fs";
import * as path from "path";

const envPath = path.join(process.cwd(), ".env");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.+?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

import { prisma } from "../src/lib/db";
import { normalizeTitle } from "../src/lib/utils";
import { matchProduct } from "../src/scrapers/matching";
import { isBlockedListingLanguage } from "../src/lib/listing-language";

const SEARCH_API = "https://api.tradera.com/v3/searchservice.asmx";

const CATEGORIES = [
  { id: 1001337, label: "Löskort" },
  { id: 1001340, label: "Boosterboxar" },
  { id: 1001339, label: "Boosterpaket" },
  { id: 1001341, label: "Övrigt sealed" },
] as const;

const PAGES = parseInt(process.env.PAGES ?? "4", 10);
const DAYS = parseInt(process.env.DAYS ?? "30", 10);
const DUMP = process.argv.includes("--dump");
/** Tak för katalogmatchningen (en DB-fråga per annons). Rapporteras alltid när det biter. */
const MATCH_LIMIT = parseInt(process.env.MATCH_LIMIT ?? "1000", 10);

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function decodeEntities(t: string): string {
  return t
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

/** Avslutade annonser i en kategori, en sida i taget. */
async function fetchEnded(catId: number, page: number): Promise<string> {
  const appId = process.env.TRADERA_APP_ID;
  const appKey = process.env.TRADERA_APP_KEY;
  if (!appId || !appKey) throw new Error("TRADERA_APP_ID/TRADERA_APP_KEY saknas i .env");
  const body = `<?xml version="1.0"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><SearchAdvanced xmlns="http://api.tradera.com"><request><SearchWords>${esc(
    "pokemon"
  )}</SearchWords><CategoryId>${catId}</CategoryId><SearchInDescription>false</SearchInDescription><PageNumber>${page}</PageNumber><OrderBy>EndDateDescending</OrderBy><ItemStatus>Ended</ItemStatus><ItemType>All</ItemType><ItemsPerPage>50</ItemsPerPage><CountyId>0</CountyId><OnlyAuctionsWithBuyNow>false</OnlyAuctionsWithBuyNow><OnlyItemsWithThumbnail>false</OnlyItemsWithThumbnail></request></SearchAdvanced></soap:Body></soap:Envelope>`;
  const res = await fetch(`${SEARCH_API}?appId=${appId}&appKey=${appKey}`, {
    method: "POST",
    headers: {
      "Content-Type": "text/xml; charset=utf-8",
      SOAPAction: `"http://api.tradera.com/SearchAdvanced"`,
    },
    body,
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  return res.text();
}

interface Ended {
  itemId: string;
  title: string;
  itemType: string;
  hasBids: boolean;
  bidCount: number | null;
  maxBidOre: number | null;
  binOre: number | null;
  endDate: string | null;
  categoryId: number | null;
}

function parseEnded(xml: string): { items: Ended[]; totalPages: number; totalItems: number } {
  const pages = xml.match(/<TotalNumberOfPages>(\d+)<\/TotalNumberOfPages>/);
  const total = xml.match(/<TotalNumberOfItems>(\d+)<\/TotalNumberOfItems>/);
  const blocks = [...xml.matchAll(/<Items>([\s\S]*?)<\/Items>/g)].map((m) => m[1]);
  const items: Ended[] = [];
  for (const b of blocks) {
    const itemId = tagText(b, "Id");
    const title = tagText(b, "ShortDescription");
    if (!itemId || !title) continue;
    const num = (name: string): number | null => {
      const v = tagText(b, name);
      if (!v) return null;
      const n = parseFloat(v.replace(",", "."));
      return Number.isFinite(n) ? n : null;
    };
    const maxBid = num("MaxBid");
    const bin = num("BuyItNowPrice");
    items.push({
      itemId,
      title,
      itemType: tagText(b, "ItemType") ?? "",
      hasBids: tagText(b, "HasBids") === "true",
      bidCount: num("BidCount") ?? num("TotalBids"),
      maxBidOre: maxBid != null ? Math.round(maxBid * 100) : null,
      binOre: bin != null ? Math.round(bin * 100) : null,
      endDate: tagText(b, "EndDate") ?? null,
      categoryId: num("CategoryId"),
    });
  }
  return {
    items,
    totalPages: pages ? parseInt(pages[1], 10) : 1,
    totalItems: total ? parseInt(total[1], 10) : 0,
  };
}

const kr = (ore: number) => `${(ore / 100).toFixed(0)} kr`;

async function main() {
  console.log("🔍 TRADERA SÅLT — täckningsmätning (läser bara)\n");

  const all: Ended[] = [];
  let calls = 0;
  let dumped = false;
  const totalsByCat: { label: string; totalItems: number }[] = [];

  for (const cat of CATEGORIES) {
    let totalItems = 0;
    for (let page = 1; page <= PAGES; page++) {
      let xml: string;
      try {
        xml = await fetchEnded(cat.id, page);
        calls++;
      } catch (e) {
        console.error(`   ⚠️ ${cat.label} sida ${page}: ${e instanceof Error ? e.message : e}`);
        break;
      }
      if (DUMP && !dumped) {
        const first = xml.match(/<Items>([\s\S]*?)<\/Items>/);
        if (first) {
          console.log("── RÅTT Items-block (fältnamn är facit, inte min gissning) ──");
          console.log(first[1].slice(0, 2500));
          console.log("──────────────────────────────────────────────────────────\n");
          dumped = true;
        }
      }
      const parsed = parseEnded(xml);
      totalItems = parsed.totalItems || totalItems;
      all.push(...parsed.items);
      if (parsed.items.length === 0 || page >= parsed.totalPages) break;
    }
    totalsByCat.push({ label: cat.label, totalItems });
  }

  console.log(`📡 ${calls} API-anrop → ${all.length} avslutade annonser hämtade`);
  for (const t of totalsByCat) {
    console.log(`   ${t.label.padEnd(16)} ${t.totalItems.toLocaleString("sv-SE")} avslutade totalt hos Tradera`);
  }

  // ── Vad KAN vi verifiera som sålt? ────────────────────────────────────────
  const byType = new Map<string, number>();
  for (const i of all) byType.set(i.itemType, (byType.get(i.itemType) ?? 0) + 1);
  console.log("\n📦 Annonstyp bland de avslutade:");
  for (const [type, n] of [...byType.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`   ${(type || "(tomt)").padEnd(18)} ${n}`);
  }

  const soldAuctions = all.filter((i) => i.hasBids && i.maxBidOre != null && i.maxBidOre > 0);
  const binEnded = all.filter((i) => !i.hasBids);
  console.log(
    `\n✅ Verifierbart SÅLDA (auktion med bud): ${soldAuctions.length} av ${all.length} (${((soldAuctions.length / Math.max(1, all.length)) * 100).toFixed(1)} %)`
  );
  console.log(
    `⛔ Omöjliga att bedöma (utan bud — såld ELLER utgången): ${binEnded.length}`
  );

  // Kontroll av premissen: bär avslutade utan bud verkligen BIN == MaxBid?
  const binEqualsMax = binEnded.filter(
    (i) => i.binOre != null && i.maxBidOre != null && i.binOre === i.maxBidOre
  ).length;
  console.log(
    `   (premisskoll: ${binEqualsMax} av ${binEnded.length} har BuyItNowPrice == MaxBid — därav omöjligheten)`
  );

  // ── Ålder: hur långt bak når ended-sökningen? ─────────────────────────────
  const dated = soldAuctions
    .map((i) => (i.endDate ? new Date(i.endDate) : null))
    .filter((d): d is Date => !!d && !Number.isNaN(d.getTime()))
    .sort((a, b) => a.getTime() - b.getTime());
  if (dated.length > 0) {
    const days = (d: Date) => Math.round((Date.now() - d.getTime()) / 86_400_000);
    console.log(
      `\n📅 Slutdatum på sålda: ${dated[0].toISOString().slice(0, 10)} … ${dated[dated.length - 1]
        .toISOString()
        .slice(0, 10)} (äldsta ${days(dated[0])} dygn bak)`
    );
    const within = dated.filter((d) => days(d) <= DAYS).length;
    console.log(`   ${within} av ${dated.length} inom ${DAYS} dygn`);
  } else {
    console.log("\n📅 Inget EndDate-fält kunde läsas — kör med --dump och läs fältnamnen.");
  }

  // ── Matchar de VÅR katalog? Det är hela frågan. ───────────────────────────
  console.log("\n🔗 Matchar de sålda annonserna mot katalogen…");
  const toMatch = soldAuctions.slice(0, MATCH_LIMIT);
  if (toMatch.length < soldAuctions.length) {
    console.log(
      `   ⚠️ TAK: bara ${toMatch.length} av ${soldAuctions.length} sålda matchas (MATCH_LIMIT) — täckningen nedan är alltså ett GOLV, inte facit.`
    );
  }
  const productHits = new Map<string, { title: string; sales: number[] }>();
  let blocked = 0;
  let noMatch = 0;
  for (const i of toMatch) {
    if (isBlockedListingLanguage(i.title, "")) {
      blocked++;
      continue;
    }
    const match = await matchProduct(normalizeTitle(i.title));
    if (!match) {
      noMatch++;
      continue;
    }
    const row = productHits.get(match.productId) ?? { title: i.title, sales: [] };
    row.sales.push(i.maxBidOre!);
    productHits.set(match.productId, row);
  }
  console.log(
    `   ${productHits.size} unika produkter träffade · ${noMatch} utan katalogmatch · ${blocked} blockerat språk`
  );

  const catalogSize = await prisma.product.count({ where: { category: { not: "ACCESSORY" } } });
  console.log(
    `   Katalogen har ${catalogSize.toLocaleString("sv-SE")} produkter → detta urval täcker ${((productHits.size / catalogSize) * 100).toFixed(2)} %`
  );

  const multi = [...productHits.values()].filter((p) => p.sales.length > 1).length;
  console.log(`   ${multi} produkter har MER ÄN EN såld annons i urvalet (= kan bli en kurva, inte en punkt)`);

  console.log("\n🏅 Mest sålda i urvalet:");
  for (const [, row] of [...productHits.entries()]
    .sort((a, b) => b[1].sales.length - a[1].sales.length)
    .slice(0, 12)) {
    const sorted = [...row.sales].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    console.log(
      `   ${String(row.sales.length).padStart(3)} st · median ${kr(median).padStart(9)} · spann ${kr(sorted[0])}–${kr(sorted[sorted.length - 1])} · ${row.title.slice(0, 60)}`
    );
  }

  // ── Jämförelsen som avgör: vad täcker ANNONS-kurvan i dag? ────────────────
  // Utan den här raden är "1 % av katalogen" ett tal utan referens. Frågan är inte
  // om sålt täcker allt — det är om det täcker MINDRE än den kurva det ersätter.
  const traderaSource = await prisma.scrapeSource.findFirst({
    where: { name: "Tradera" },
    select: { id: true },
  });
  if (traderaSource) {
    const since = new Date(Date.now() - DAYS * 86_400_000);
    const listed = await prisma.priceObservation.groupBy({
      by: ["productId"],
      where: { sourceId: traderaSource.id, observedAt: { gte: since } },
      _count: { _all: true },
    });
    const listedMulti = listed.filter((r) => r._count._all > 1).length;
    console.log(
      `\n📉 Referens — NUVARANDE Tradera-ANNONSkurva senaste ${DAYS} dygn: ${listed.length} produkter med punkter, varav ${listedMulti} med fler än en (= faktisk kurva).`
    );
  }

  console.log(
    "\n💡 Läs det så här: 'unika produkter träffade' är hur många produkter som skulle FÅ en såld-punkt av ett svep i den här storleken. Ligger den långt under katalogen betyder en ersatt Tradera-kurva att de flesta produkter tappar sin Tradera-serie helt."
  );
}

main()
  .catch((e) => {
    console.error("Misslyckades:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
