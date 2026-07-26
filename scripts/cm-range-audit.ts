/**
 * CM-SPANNREVISION — ligger våra publicerade priser inom Cardmarkets EGNA siffror?
 *
 * Facit är CM:s egen gratis-publicerade prisguide (price_guide_6.json, uppdateras
 * dagligen, ingen RapidAPI-kvot, ingen scraping). För varje produkt jämförs vårt
 * publicerade CM-pris mot HELA spannet CM själv publicerar: low, trend, avg, avg30.
 *
 * Varför spannet och inte ett fält: enskilda guide-fält är ibland trasiga (trend=0,02
 * på kort som handlas för 20 €), så ett enda fält kan inte döma. Ett pris som ligger
 * över ALLA fyra referenserna ×3, eller under alla ÷3, är däremot inte förklarligt som
 * "marknaden rörde sig" — då mäter vi något annat än kortet.
 *
 * Identiteten kommer olika beroende på hur offer-URL:en ser ut:
 *   ?idProduct=N  → exakt (sealed + nyimporterade singlar)
 *   /Singles/…    → sluggen bär expansion + kortnamn; expansionen binds till en
 *                   idExpansion via NAMNÖVERLAPP över hela setet, och storleken
 *                   bryter lika (en reprint-expansion innehåller alla namn men är
 *                   mycket större). Dubblerade namn i samma expansion (CM:s V1/V2/V3-
 *                   tryckvarianter) kan inte särskiljas offline → rapporteras separat.
 *
 *   node scripts/with-prod-db.mjs npx tsx scripts/cm-range-audit.ts
 *   node scripts/with-prod-db.mjs npx tsx scripts/cm-range-audit.ts --strict   # exit 1 om fynd
 *   MULT=5 … (default 3)
 */
import { PrismaClient } from "@prisma/client";
import { cmNameKey } from "../src/jobs/cardmarket-refresh";
import { getRatesOre } from "../src/lib/exchange-rate";

const prisma = new PrismaClient();
const STRICT = process.argv.includes("--strict");
const MULT = Number(process.env.MULT) || 3;
const GUIDE = "https://downloads.s3.cardmarket.com/productCatalog/priceGuide/price_guide_6.json";
const SINGLES = "https://downloads.s3.cardmarket.com/productCatalog/productList/products_singles_6.json";

interface Cat { idProduct: number; name: string; idExpansion: number }
type Guide = Record<string, number | null> & { idProduct: number };
const pos = (v: unknown) => (typeof v === "number" && v > 0 ? v : null);

async function main() {
  const rates = await getRatesOre();
  const [catRes, guideRes] = await Promise.all([fetch(SINGLES), fetch(GUIDE)]);
  if (!catRes.ok || !guideRes.ok) throw new Error(`CM-filer: katalog ${catRes.status}, guide ${guideRes.status}`);
  const cat = ((await catRes.json()) as { products: Cat[] }).products;
  const guide = new Map<number, Guide>(
    ((await guideRes.json()) as { priceGuides: Guide[] }).priceGuides.map((g) => [g.idProduct, g])
  );

  const expNames = new Map<number, Set<string>>();
  const byExpName = new Map<string, Cat[]>();
  for (const p of cat) {
    const k = cmNameKey(p.name);
    if (!k) continue;
    (expNames.get(p.idExpansion) ?? expNames.set(p.idExpansion, new Set()).get(p.idExpansion)!).add(k);
    const bk = `${p.idExpansion}|${k}`;
    (byExpName.get(bk) ?? byExpName.set(bk, []).get(bk)!).push(p);
  }

  const rows = await prisma.$queryRaw<
    { title: string; slug: string; setKey: string; cardName: string | null; price: number; url: string; isSingle: boolean }[]
  >`
    SELECT p.title, p.slug, COALESCE(cs."externalId", cs.name, '?') AS "setKey",
           c.name AS "cardName", o.price, o.url,
           (p.category = 'SINGLE_CARD') AS "isSingle"
    FROM "Offer" o
    JOIN "Retailer" r ON r.id = o."retailerId" AND r.name = 'Cardmarket'
    JOIN "Product" p ON p.id = o."productId"
    LEFT JOIN "Card" c ON c.id = p."cardId"
    LEFT JOIN "CardSet" cs ON cs.id = p."setId"
    WHERE o.price IS NOT NULL AND o.price > 0
      AND p.category NOT IN ('GRADED_CARD', 'ACCESSORY')`;

  // Expansionsbindning för slug-URL:er
  const slugOf = (u: string) => u.match(/\/Singles\/([^/]+)\//)?.[1] ?? null;
  const groups = new Map<string, typeof rows>();
  for (const r of rows) {
    const s = slugOf(r.url);
    if (!s || !r.cardName) continue;
    const key = `${r.setKey}|${s}`;
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(r);
  }
  const expOf = new Map<string, number>();
  for (const [key, list] of groups) {
    const ours = new Set(list.map((c) => cmNameKey(c.cardName!)).filter(Boolean));
    const cands: { exp: number; size: number }[] = [];
    for (const [exp, names] of expNames) {
      let hit = 0;
      for (const n of ours) if (names.has(n)) hit++;
      if (hit >= Math.max(5, ours.size * 0.8)) cands.push({ exp, size: names.size });
    }
    if (cands.length === 0) continue;
    cands.sort((a, b) => Math.abs(a.size - ours.size) - Math.abs(b.size - ours.size));
    expOf.set(key, cands[0].exp);
  }

  let checked = 0, inRange = 0, unmapped = 0, ambiguous = 0, noRefs = 0;
  const findings: { title: string; slug: string; ours: number; refs: string; ratio: number; kind: "hög" | "låg" }[] = [];

  for (const r of rows) {
    let g: Guide | undefined;
    const idInUrl = Number(r.url.match(/idProduct=(\d+)/)?.[1] ?? 0);
    if (idInUrl) {
      g = guide.get(idInUrl);
    } else {
      const s = slugOf(r.url);
      const exp = s ? expOf.get(`${r.setKey}|${s}`) : undefined;
      if (exp == null || !r.cardName) { unmapped++; continue; }
      const cands = byExpName.get(`${exp}|${cmNameKey(r.cardName)}`) ?? [];
      if (cands.length !== 1) { ambiguous++; continue; }
      g = guide.get(cands[0].idProduct);
    }
    if (!g) { unmapped++; continue; }
    const refs = [pos(g.low), pos(g.trend), pos(g.avg), pos(g.avg30)].filter((v): v is number => v != null);
    if (refs.length === 0) { noRefs++; continue; }
    checked++;
    const ours = r.price / rates.eurToOre;
    const hi = Math.max(...refs), lo = Math.min(...refs);
    const desc = `low ${g.low} trend ${g.trend} avg ${g.avg} avg30 ${g.avg30}`;
    if (ours > hi * MULT) findings.push({ title: r.title, slug: r.slug, ours, refs: desc, ratio: ours / hi, kind: "hög" });
    else if (ours < lo / MULT) findings.push({ title: r.title, slug: r.slug, ours, refs: desc, ratio: lo / ours, kind: "låg" });
    else inRange++;
  }

  console.log(`\n=== CM-SPANNREVISION (facit: CM:s egen prisguide, ${guide.size} rader) ===`);
  console.log(`Jämförda: ${checked}  inom spannet: ${inRange} (${((inRange / checked) * 100).toFixed(1)} %)`);
  console.log(`Utanför ×${MULT}: ${findings.length}  (${findings.filter((f) => f.kind === "hög").length} för höga, ${findings.filter((f) => f.kind === "låg").length} för låga)`);
  console.log(`Ej jämförbara: ${ambiguous} tvetydig tryckvariant (CM V1/V2/V3), ${unmapped} utan mappning, ${noRefs} utan CM-referens`);

  for (const kind of ["hög", "låg"] as const) {
    const list = findings.filter((f) => f.kind === kind).sort((a, b) => b.ratio - a.ratio);
    if (!list.length) continue;
    console.log(`\n${kind === "hög" ? "ÖVER" : "UNDER"} hela CM-spannet (${list.length}):`);
    for (const f of list.slice(0, 40))
      console.log(`   ${f.ours.toFixed(2).padStart(10)} € | ${f.refs} | ${f.ratio.toFixed(0)}x  ${f.title}\n        /produkter/${f.slug}`);
    if (list.length > 40) console.log(`   … ${list.length - 40} fler`);
  }

  if (STRICT && findings.length > 0) {
    console.error(`\nSTRICT: ${findings.length} priser utanför CM:s eget spann → exit 1`);
    process.exitCode = 1;
  }
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
