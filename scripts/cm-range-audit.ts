/**
 * CM-SPANNREVISION — vilka publicerade priser ligger långt utanför Cardmarkets EGNA
 * siffror? REN RAPPORT. Skriver aldrig.
 *
 * ⛔ `--apply` FANNS HÄR OCH ÄR BORTTAGET (2026-07-27). Det skrev om "för höga" priser
 * till medianen av CM:s guide-fält, och det gjorde två fel samtidigt:
 *
 *   1. FEL POLICY. Ägarens regel är att singel-headline ÄR RapidAPI:s `lowest_near_mint`
 *      (CM:s lägsta NM-annons på engelska) rakt av. En guide-median är per definition
 *      inte det — den är ett värde ingen annons har.
 *   2. FEL KORT. Identitetsbindningen nedan matchar på NORMALISERAT NAMN, och den
 *      normaliseringen fäller ihop olika CM-produkter: vårt "Rayquaza ★" blir "rayquaza"
 *      och matchade CM:s vanliga "Rayquaza [Dragon Aura | Tumbling Attack]" i EX Deoxys
 *      i stället för "Rayquaza Gold Star". Resultat: Rayquaza ★ · Deoxys 107/107, vars
 *      billigaste NM-engelska annons kostar 37 000 €, skrevs ner till 19,50 € = 215,61 kr.
 *      160 rader skrevs den körningen.
 *
 * Rapporten är fortfarande värd att köra: ett pris som ligger 100x utanför CM:s hela
 * spann betyder oftast att offer-LÄNKEN pekar på fel produkt. Men den är en INGÅNG till
 * en manuell kontroll på Cardmarket, aldrig ett facit att skriva tillbaka.
 *
 * Facit är CM:s egen gratis-publicerade prisguide (price_guide_6.json, uppdateras
 * dagligen, ingen RapidAPI-kvot, ingen scraping) — med reservationen att den filen
 * BEVISLIGEN inte är CM:s From: för Rayquaza Gold Star (idProduct 276510) säger den
 * low = 2 900 € där CM:s produktsida samma dag visar From 37 000 €.
 *
 * Identiteten kommer olika beroende på hur offer-URL:en ser ut:
 *   ?idProduct=N  → exakt (sealed + nyimporterade singlar)
 *   /Singles/…    → sluggen bär expansion + kortnamn; expansionen binds till en
 *                   idExpansion via NAMNÖVERLAPP över hela setet, och storleken
 *                   bryter lika (en reprint-expansion innehåller alla namn men är
 *                   mycket större). Namn som inte är ENTYDIGA i expansionen — flera
 *                   träffar, eller ett längre CM-namn som vårt namn är prefix till
 *                   (Rayquaza ⊂ Rayquaza Gold Star) — rapporteras inte alls.
 *
 *   node scripts/with-prod-db.mjs npx tsx scripts/cm-range-audit.ts
 *   node scripts/with-prod-db.mjs npx tsx scripts/cm-range-audit.ts --strict   # exit 1 om fynd
 *   MULT=5 … (default 3)
 */
import { PrismaClient } from "@prisma/client";
import { cmNameKey, type CmGuideFields } from "../src/jobs/cardmarket-refresh";
import { getRatesOre } from "../src/lib/exchange-rate";

const prisma = new PrismaClient();
const STRICT = process.argv.includes("--strict");
const MULT = Number(process.env.MULT) || 3;
const GUIDE = "https://downloads.s3.cardmarket.com/productCatalog/priceGuide/price_guide_6.json";
const SINGLES = "https://downloads.s3.cardmarket.com/productCatalog/productList/products_singles_6.json";

interface Cat { idProduct: number; name: string; idExpansion: number }
interface Guide extends CmGuideFields { idProduct: number }
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
  // Namn i expansionen som något ANNAT namn är äkta prefix till. "rayquaza" hamnar här
  // därför att expansionen också innehåller "rayquazagoldstar" — och en uppslagning på
  // "rayquaza" kan då inte veta vilket kort som avsågs. Se filhuvudet: det var precis
  // den kollisionen som skrev 215,61 kr på ett 37 000 €-kort.
  const prefixCollisions = new Map<number, Set<string>>();
  for (const p of cat) {
    const k = cmNameKey(p.name);
    if (!k) continue;
    (expNames.get(p.idExpansion) ?? expNames.set(p.idExpansion, new Set()).get(p.idExpansion)!).add(k);
    const bk = `${p.idExpansion}|${k}`;
    (byExpName.get(bk) ?? byExpName.set(bk, []).get(bk)!).push(p);
  }
  for (const [exp, names] of expNames) {
    const sorted = [...names].sort();
    const hit = new Set<string>();
    for (let i = 0; i < sorted.length; i++) {
      // Bara det KORTARE namnet blir tvetydigt: "rayquaza" kan mena båda korten,
      // medan "rayquazagoldstar" bara kan mena ett.
      for (let j = i + 1; j < sorted.length && sorted[j].startsWith(sorted[i]); j++) hit.add(sorted[i]);
    }
    if (hit.size) prefixCollisions.set(exp, hit);
  }

  const rows = await prisma.$queryRaw<
    {
      offerId: string; productId: string; title: string; slug: string; setKey: string;
      cardName: string | null; price: number; url: string; isSingle: boolean; setAgeDays: number | null;
    }[]
  >`
    SELECT o.id AS "offerId", p.id AS "productId", p.title, p.slug,
           COALESCE(cs."externalId", cs.name, '?') AS "setKey",
           c.name AS "cardName", o.price, o.url,
           (p.category = 'SINGLE_CARD') AS "isSingle",
           EXTRACT(DAY FROM NOW() - cs."releaseDate")::int AS "setAgeDays"
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
  const findings: {
    title: string; slug: string; ours: number; refs: string; ratio: number; kind: "hög" | "låg";
    productId: string; isSingle: boolean;
  }[] = [];

  for (const r of rows) {
    let g: Guide | undefined;
    const idInUrl = Number(r.url.match(/idProduct=(\d+)/)?.[1] ?? 0);
    if (idInUrl) {
      g = guide.get(idInUrl);
    } else {
      const s = slugOf(r.url);
      const exp = s ? expOf.get(`${r.setKey}|${s}`) : undefined;
      if (exp == null || !r.cardName) { unmapped++; continue; }
      const key = cmNameKey(r.cardName);
      // TVETYDIGT NAMN ⇒ INGEN DOM. Två sätt att vara tvetydig, och båda måste bort:
      //   • flera CM-produkter med exakt samma namnnyckel (V1/V2/V3-tryckvarianter)
      //   • vårt namn är PREFIX till ett annat namn i expansionen (Rayquaza ⊂ Rayquaza
      //     Gold Star) — då är en "träff" inte ett bevis på att det är samma kort
      if (prefixCollisions.get(exp)?.has(key)) { ambiguous++; continue; }
      const cands = byExpName.get(`${exp}|${key}`) ?? [];
      if (cands.length === 0) { unmapped++; continue; }
      if (cands.length > 1) { ambiguous++; continue; }
      g = guide.get(cands[0].idProduct);
    }
    if (!g) { unmapped++; continue; }
    const refs = [pos(g.low), pos(g.trend), pos(g.avg), pos(g.avg30)].filter((v): v is number => v != null);
    if (refs.length === 0) { noRefs++; continue; }
    checked++;
    const ours = r.price / rates.eurToOre;
    const hi = Math.max(...refs), lo = Math.min(...refs);
    const base = {
      title: r.title, slug: r.slug, ours, refs: `low ${g.low} trend ${g.trend} avg ${g.avg} avg30 ${g.avg30}`,
      productId: r.productId, isSingle: r.isSingle,
    };
    if (ours > hi * MULT) findings.push({ ...base, ratio: ours / hi, kind: "hög" });
    else if (ours < lo / MULT) findings.push({ ...base, ratio: lo / ours, kind: "låg" });
    else inRange++;
  }

  console.log(`\n=== CM-SPANNREVISION (facit: CM:s egen prisguide, ${guide.size} rader) ===`);
  console.log(`Jämförda: ${checked}  inom spannet: ${inRange} (${((inRange / checked) * 100).toFixed(1)} %)`);
  console.log(`Utanför ×${MULT}: ${findings.length}  (${findings.filter((f) => f.kind === "hög").length} för höga, ${findings.filter((f) => f.kind === "låg").length} för låga)`);
  console.log(`Ej jämförbara: ${ambiguous} tvetydigt namn (tryckvariant eller prefix-kollision), ${unmapped} utan mappning, ${noRefs} utan CM-referens`);

  for (const kind of ["hög", "låg"] as const) {
    const list = findings.filter((f) => f.kind === kind).sort((a, b) => b.ratio - a.ratio);
    if (!list.length) continue;
    console.log(`\n${kind === "hög" ? "ÖVER" : "UNDER"} hela CM-spannet (${list.length}):`);
    for (const f of list.slice(0, 40))
      console.log(`   ${f.ours.toFixed(2).padStart(10)} € | ${f.refs} | ${f.ratio.toFixed(0)}x  ${f.title}\n        /produkter/${f.slug}`);
    if (list.length > 40) console.log(`   … ${list.length - 40} fler`);
  }

  console.log(
    `\nRAPPORT ENDAST — inget skrivs. Ett fynd betyder "kontrollera länken på Cardmarket",` +
    ` inte "priset är fel": ägarens regel är att singel-headline ÄR feedens NM-engelska` +
    ` lägsta, och den ligger med flit ibland utanför guidens spann (Rayquaza Gold Star:` +
    ` From 37 000 € mot guidens högsta fält 9 800 €).`
  );

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
