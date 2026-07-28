/**
 * LÄS CARDMARKET-DATAN FÖR ETT KORT — vad API:t säger, vad CM:s guide säger och
 * vad vi publicerar, sida vid sida.
 *
 *   node scripts/with-prod-db.mjs npx tsx scripts/cm-inspect.ts charizard base
 *   node scripts/with-prod-db.mjs npx tsx scripts/cm-inspect.ts base1-4        # tcgid
 *   node scripts/with-prod-db.mjs npx tsx scripts/cm-inspect.ts ponyta-base1-60 # slug
 *   node scripts/with-prod-db.mjs npx tsx scripts/cm-inspect.ts base1-4 --raw   # hela JSON-svaret
 *
 * Flaggor:
 *   --raw            skriv ut RapidAPI:s råa svar (alla fält, inkl. eBay-graderat)
 *   --refresh-guide  hämta om CM:s prisguide (14 MB, gratis, ingen API-kvot)
 *
 * KVOT: ett RapidAPI-anrop per kort (kvoten är ~1600–3000/dygn och nollställs
 * 12:59 UTC). CM:s prisguide och produktkatalog är GRATIS nedladdningar utan
 * nyckel — de kostar ingen kvot och cachas på disk här.
 *
 * Skriver ALDRIG till databasen. Skriver ALDRIG ut API-nyckeln.
 */
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { prisma } from "../src/lib/db";

const HOST = process.env.CARDMARKET_RAPIDAPI_HOST ?? "cardmarket-api-tcg.p.rapidapi.com";
const KEY = process.env.CARDMARKET_RAPIDAPI_KEY ?? "";
const CACHE = join(process.cwd(), ".cache", "cardmarket");
const GUIDE_URL = "https://downloads.s3.cardmarket.com/productCatalog/priceGuide/price_guide_6.json";

const args = process.argv.slice(2);
const RAW = args.includes("--raw");
const REFRESH_GUIDE = args.includes("--refresh-guide");
const TERM = args.filter((a) => !a.startsWith("--")).join(" ").trim();

interface ApiRow {
  name?: string | null;
  card_number?: string | number | null;
  version?: string | null;
  tcgid?: string | null;
  cardmarket_id?: number | null;
  rarity?: string | null;
  episode?: { name?: string | null } | null;
  prices?: {
    cardmarket?: {
      lowest_near_mint?: number | null;
      lowest_near_mint_EU_only?: number | null;
      "30d_average"?: number | null;
      "7d_average"?: number | null;
      available_items?: number | null;
    } | null;
  } | null;
}
interface GuideRow {
  idProduct: number;
  low?: number | null; trend?: number | null; avg?: number | null;
  "avg1"?: number | null; "avg7"?: number | null; "avg30"?: number | null;
}

const eur = (v: number | null | undefined) => (typeof v === "number" ? `${v.toFixed(2)} €` : "–");
const kr = (ore: number | null | undefined) => (typeof ore === "number" ? `${(ore / 100).toFixed(2)} kr` : "–");
const idOf = (url: string | null | undefined) => url?.match(/idProduct=(\d+)/)?.[1] ?? null;
const firstEdOf = (url: string | null | undefined) =>
  url?.match(/isFirstEd=([YN])/i)?.[1]?.toUpperCase() ?? "(inget)";

/** CM:s prisguide — gratis nedladdning, cachas på disk (ingen API-kvot). */
function loadGuide(): Map<number, GuideRow> {
  const file = join(CACHE, "price_guide_6.json");
  const fresh = existsSync(file) && !REFRESH_GUIDE;
  if (fresh) {
    const ageH = (Date.now() - statSync(file).mtimeMs) / 3_600_000;
    const stale = ageH > 48;
    console.log(
      `CM:s prisguide: diskcache ${ageH.toFixed(0)} h gammal` +
      (stale ? "  ⚠ GAMMAL — siffrorna nedan är inte dagens. Kör om med --refresh-guide." : " (--refresh-guide för ny)")
    );
  }
  const json = JSON.parse(readFileSync(file, "utf8")) as { priceGuides: GuideRow[] };
  return new Map(json.priceGuides.map((g) => [g.idProduct, g]));
}

async function downloadGuide() {
  console.log("Hämtar CM:s prisguide (gratis, ~14 MB)…");
  const r = await fetch(GUIDE_URL);
  if (!r.ok) throw new Error(`prisguide HTTP ${r.status}`);
  mkdirSync(CACHE, { recursive: true });
  writeFileSync(join(CACHE, "price_guide_6.json"), await r.text());
}

async function main() {
  if (!TERM) {
    console.log('Ange ett kort: kortnamn, slug eller tcgid. Ex: npx tsx scripts/cm-inspect.ts "charizard base"');
    return;
  }
  if (REFRESH_GUIDE || !existsSync(join(CACHE, "price_guide_6.json"))) await downloadGuide();

  // ── Vår katalog ───────────────────────────────────────────────────────────
  const products = await prisma.product.findMany({
    where: {
      category: "SINGLE_CARD",
      OR: [
        { slug: TERM },
        { card: { tcgExternalId: TERM } },
        { title: { contains: TERM, mode: "insensitive" } },
      ],
    },
    select: {
      title: true, slug: true, variantLabel: true, lowestPriceOre: true,
      card: { select: { name: true, number: true, tcgExternalId: true, set: { select: { name: true } } } },
      offers: {
        select: { price: true, url: true, stockStatus: true, updatedAt: true, retailer: { select: { name: true } } },
      },
    },
    orderBy: { title: "asc" },
    take: 12,
  });
  if (products.length === 0) {
    console.log(`Hittade inget kort som matchar "${TERM}".`);
    await prisma.$disconnect();
    return;
  }
  const tcgids = [...new Set(products.map((p) => p.card?.tcgExternalId).filter((x): x is string => !!x))];
  const card0 = products[0].card;
  console.log(`\nKORT: ${card0?.name} · ${card0?.set.name} ${card0?.number}   tcgid=${tcgids.join(", ") || "–"}\n`);

  console.log(`VÅR KATALOG — ${products.length} produkt(er)`);
  console.log(`  ${"tryckning".padEnd(14)}${"publicerat pris".padStart(16)}  ${"lager".padEnd(13)}${"CM-produkt".padEnd(12)}1stEd-filter`);
  for (const p of products) {
    const cm = p.offers.find((o) => o.retailer.name === "Cardmarket");
    console.log(
      `  ${(p.variantLabel ?? "(ordinarie)").padEnd(14)}${kr(p.lowestPriceOre).padStart(16)}  ` +
      `${(cm?.stockStatus ?? "–").padEnd(13)}${(idOf(cm?.url) ?? "–").padEnd(12)}${firstEdOf(cm?.url)}`
    );
    const others = p.offers.filter((o) => o.retailer.name !== "Cardmarket" && o.price != null);
    for (const o of others.slice(0, 3))
      console.log(`      ${o.retailer.name.padEnd(14)}${kr(o.price).padStart(16)}  ${o.stockStatus}`);
  }

  // ── RapidAPI ──────────────────────────────────────────────────────────────
  const apiCmIds = new Set<number>();
  console.log("");
  if (!KEY) {
    console.log("RAPIDAPI: nyckel saknas i miljön (CARDMARKET_RAPIDAPI_KEY) — hoppar över API-delen.");
  } else {
    for (const tcgid of tcgids) {
      const r = await fetch(`https://${HOST}/pokemon/cards?tcgid=${encodeURIComponent(tcgid)}`, {
        headers: { "x-rapidapi-host": HOST, "x-rapidapi-key": KEY },
      });
      const remaining = r.headers.get("x-ratelimit-requests-remaining");
      if (!r.ok) { console.log(`RAPIDAPI ${tcgid}: HTTP ${r.status}`); continue; }
      const body = (await r.json()) as { data?: ApiRow[] };
      const rows = body.data ?? [];
      for (const row of rows) if (row.cardmarket_id != null) apiCmIds.add(row.cardmarket_id);
      console.log(`RAPIDAPI ?tcgid=${tcgid} — ${rows.length} rad(er)${remaining ? `, kvot kvar ${remaining}` : ""}`);
      if (RAW) { console.log(JSON.stringify(body, null, 1)); continue; }
      console.log(`  ${"version".padEnd(24)}${"CM-produkt".padEnd(12)}${"From".padStart(11)}${"EU-From".padStart(11)}${"7d".padStart(11)}${"30d".padStart(11)}${"annonser".padStart(10)}`);
      for (const row of rows) {
        const c = row.prices?.cardmarket ?? {};
        console.log(
          `  ${String(row.version ?? "(omärkt)").padEnd(24)}${String(row.cardmarket_id ?? "–").padEnd(12)}` +
          `${eur(c.lowest_near_mint).padStart(11)}${eur(c.lowest_near_mint_EU_only).padStart(11)}` +
          `${eur(c["7d_average"]).padStart(11)}${eur(c["30d_average"]).padStart(11)}${String(c.available_items ?? "–").padStart(10)}`
        );
      }

      // ── Flaggor: precis det som brukar vara fel ──────────────────────────
      const notes: string[] = [];
      const withFrom = rows.filter((x) => typeof x.prices?.cardmarket?.lowest_near_mint === "number");
      const froms = withFrom.map((x) => x.prices!.cardmarket!.lowest_near_mint);
      if (rows.length > 0 && withFrom.length === 0)
        notes.push("INGET From på någon rad → vi kan bara publicera en UPPSKATTNING (rubriken blir 'Uppskattat värde', lagerstatus OUT_OF_STOCK).");
      if (rows.length > 1 && new Set(froms).size === 1 && withFrom.length > 1)
        notes.push(`Alla ${withFrom.length} tryckningar har IDENTISKT From (${eur(froms[0])}) → feeden skiljer INTE på tryckning här (CM har en produkt per kort i det här setet).`);
      const ids = new Set(rows.map((x) => x.cardmarket_id).filter((x): x is number => x != null));
      const ourIds = new Set(products.map((p) => idOf(p.offers.find((o) => o.retailer.name === "Cardmarket")?.url)).filter(Boolean));
      for (const id of ourIds) if (ids.size > 0 && !ids.has(Number(id)))
        notes.push(`Vår länk pekar på CM-produkt ${id}, men feeden nämner bara ${[...ids].join(", ")} → feedens cardmarket_id är opålitlig (känt), länken är satt ur CM:s egen katalog.`);
      for (const row of rows) {
        const c = row.prices?.cardmarket ?? {};
        if (typeof c.available_items === "number" && c.available_items > 0 && c.lowest_near_mint == null)
          notes.push(`"${row.version ?? "(omärkt)"}": ${c.available_items} annonser finns men INGET From — annonserna är inte NM+engelska (eller så saknar API:t värdet).`);
      }
      if (notes.length) {
        console.log("\n  ⚠ ATT NOTERA");
        for (const n of notes) console.log(`   - ${n}`);
      }
      console.log("");
    }
  }

  // ── CM:s egen prisguide (gratis) ─────────────────────────────────────────
  const guide = loadGuide();
  // Id:n från BÅDA hållen: vår länk (när den bär idProduct) och feedens rader.
  // En löst slug-länk (".../Singles/Neo-Destiny/Dark-Typhlosion-N4-10") har inget
  // idProduct — då är feedens id enda ingången till guiden.
  const ids = new Map<number, string>();
  for (const p of products) {
    // OBS: Number(null) === 0 — kolla strängen först, annars dyker en fejkad
    // "CM-produkt 0" upp för varje länk som är en löst slug-URL.
    const raw = idOf(p.offers.find((o) => o.retailer.name === "Cardmarket")?.url);
    if (raw) ids.set(Number(raw), `vår länk · ${p.variantLabel ?? "(ordinarie)"}`);
  }
  for (const id of apiCmIds) if (!ids.has(id)) ids.set(id, "feedens cardmarket_id");
  console.log("CM:s PRISGUIDE per CM-produkt (gratis nedladdning, ingen API-kvot)");
  if (ids.size === 0) console.log("  (ingen CM-produkt känd för kortet)");
  console.log(`  ${"CM-produkt".padEnd(12)}${"low".padStart(11)}${"trend".padStart(11)}${"avg".padStart(11)}${"avg7".padStart(11)}${"avg30".padStart(11)}   källa`);
  for (const [id, source] of ids) {
    const g = guide.get(id);
    console.log(
      `  ${String(id).padEnd(12)}${eur(g?.low).padStart(11)}${eur(g?.trend).padStart(11)}` +
      `${eur(g?.avg).padStart(11)}${eur(g?.["avg7"]).padStart(11)}${eur(g?.["avg30"]).padStart(11)}   ${source}`
    );
  }

  console.log("\nÖPPNA PÅ CARDMARKET och jämför själv:");
  for (const p of products) {
    const cm = p.offers.find((o) => o.retailer.name === "Cardmarket");
    if (cm?.url) console.log(`  ${(p.variantLabel ?? "(ordinarie)").padEnd(14)}${cm.url}`);
  }
  for (const id of apiCmIds)
    console.log(`  ${"feedens id".padEnd(14)}https://www.cardmarket.com/en/Pokemon/Products?idProduct=${id}&language=1&minCondition=2`);
  console.log(
    "\nLÄSANVISNING: `From` (lowest_near_mint) = billigaste NM-annonsen på engelska och\n" +
    "är det vi publicerar RAKT AV. Saknas From publiceras medianen av guidens trend/avg/\n" +
    "avg30 + API:ts 30d som UPPSKATTNING, märkt OUT_OF_STOCK. Guidens siffror är CM:s\n" +
    "egna medelvärden för HELA produkten — de är inte From och ska inte ersätta den."
  );
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
