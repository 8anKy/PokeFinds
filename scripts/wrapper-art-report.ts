/**
 * OMSLAGSKONST-RAPPORT (läser bara, skriver aldrig).
 *
 *   npx tsx scripts/wrapper-art-report.ts                 (använder revisionens cache)
 *   npx tsx scripts/wrapper-art-report.ts --out <fil>
 *
 * Frågan skriptet finns för: Rogerz (rogerz.dk) säljer vintage booster packs PER
 * OMSLAGSBILD ("Jungle Booster Pack - Unlimited - Scyther"), vilket ger 137 produkter
 * på 41 set. Katalogens dom 2026-08-11 säger att omslagskonst inte modelleras — CM har
 * EN produkt per set — men den domen gällde moderna varianter.
 *
 * ⛔ DET SOM AVGÖR ÄR OM OMSLAGEN FAKTISKT PRISSÄTTS OLIKA. Gör de inte det förlorar en
 *    kollaps ingenting; gör de det är uppdelningen bärare av riktig information. Därför
 *    redovisar rapporten prisSPRIDNINGEN inom varje set, inte bara antalet varianter.
 *
 * Kräver `.audit-cache/new-products-<datum>.json` från scripts/audit-new-products.ts —
 * så att en omkörning aldrig väcker Neon i onödan.
 */
import * as fs from "node:fs";
import * as path from "node:path";

const flag = (n: string) => {
  const i = process.argv.indexOf(n);
  return i >= 0 ? process.argv[i + 1] ?? null : null;
};
const SINCE = flag("--since") ?? "2026-08-13";
const OUT = flag("--out");
const CACHE = flag("--cache") ?? path.join(process.cwd(), ".audit-cache", `new-products-${SINCE}.json`);

type Row = {
  id: string;
  title: string;
  slug: string;
  category: string;
  offers: { retailer: string; url: string | null; price: number | null }[];
};

/** Momstaggen är butiksadministration — se LISTING_TITLE_JUNK. */
const VAT = /\s*[-–—/|]\s*(?:brugtmoms|alm\.?\s*moms)\b/gi;
const kr = (ore: number) => (ore / 100).toLocaleString("sv-SE", { maximumFractionDigits: 0 }) + " kr";

function main() {
  if (!fs.existsSync(CACHE)) {
    console.error(`Saknar cache: ${CACHE}\nKör först: node scripts/with-prod-db.mjs npx tsx scripts/audit-new-products.ts --since ${SINCE}`);
    process.exit(1);
  }
  const cache = JSON.parse(fs.readFileSync(CACHE, "utf8")) as { cohort: Row[] };
  const rogerz = cache.cohort.filter((p) => p.offers.some((o) => o.retailer === "Rogerz"));

  // Omslagsvariant = "<set/produktnamn> - <Karaktär>" sist i titeln, efter momstvätt.
  type V = { base: string; art: string; title: string; slug: string; price: number | null };
  const variants: V[] = [];
  for (const p of rogerz) {
    const t = p.title.replace(VAT, "").replace(/\s{2,}/g, " ").trim();
    if (!/booster pack/i.test(t)) continue;
    const m = t.match(/^(.*?)\s-\s([A-ZÅÄÖ][\wÅÄÖåäö'.\- ]{2,22})$/);
    if (!m) continue;
    const price = p.offers.find((o) => o.retailer === "Rogerz")?.price ?? null;
    variants.push({ base: m[1].trim(), art: m[2].trim(), title: t, slug: p.slug, price });
  }

  // Momstvillingarna är samma vara — deduplicera på städad titel innan vi räknar.
  const seen = new Map<string, V>();
  for (const v of variants) {
    const prev = seen.get(v.title);
    // Behåll den med pris (den ena momsraden kan sakna pris).
    if (!prev || (prev.price === null && v.price !== null)) seen.set(v.title, v);
  }
  const uniq = [...seen.values()];

  const bySet = new Map<string, V[]>();
  for (const v of uniq) bySet.set(v.base, [...(bySet.get(v.base) ?? []), v]);

  const L: string[] = [];
  L.push("OMSLAGSKONST HOS ROGERZ — beslutsunderlag");
  L.push(`${rogerz.length} nya Rogerz-produkter · ${uniq.length} omslagsvarianter på ${bySet.size} set`);
  L.push("");
  L.push("Frågan är om omslaget prissätts olika. Kolumnen 'spridning' är högsta minus lägsta");
  L.push("pris inom setet; 0 kr betyder att butiken själv behandlar omslagen som samma vara.");
  L.push("");

  let sameCount = 0;
  let spreadCount = 0;
  let noPrice = 0;
  const rows = [...bySet].sort((a, b) => b[1].length - a[1].length);
  for (const [base, vs] of rows) {
    const prices = vs.map((v) => v.price).filter((p): p is number => p !== null && p > 0);
    const spread = prices.length > 1 ? Math.max(...prices) - Math.min(...prices) : null;
    if (prices.length === 0) noPrice++;
    else if (spread === 0) sameCount++;
    else if (spread !== null && spread > 0) spreadCount++;
    const tag =
      prices.length === 0 ? "inga priser" : spread === null ? "ett pris" : spread === 0 ? "SAMMA PRIS" : `spridning ${kr(spread)}`;
    L.push(`── ${base}   [${vs.length} omslag · ${tag}]`);
    for (const v of vs.sort((a, b) => (b.price ?? 0) - (a.price ?? 0))) {
      L.push(`     ${(v.price ? kr(v.price) : "–").padStart(10)}   ${v.art.padEnd(22)} https://www.foilio.se/produkter/${v.slug}`);
    }
    L.push("");
  }

  L.push("═".repeat(70));
  L.push("SAMMANFATTNING");
  L.push("═".repeat(70));
  L.push(`  Set där alla omslag har SAMMA pris:  ${sameCount}`);
  L.push(`  Set med prisspridning mellan omslag: ${spreadCount}`);
  L.push(`  Set utan priser att jämföra:         ${noPrice}`);
  L.push("");
  L.push("  Har de flesta samma pris förlorar en kollaps till en rad per set ingenting.");

  const report = L.join("\n") + "\n";
  if (OUT) {
    fs.mkdirSync(path.dirname(path.resolve(OUT)), { recursive: true });
    fs.writeFileSync(OUT, report, "utf8");
    console.log(`Rapport: ${OUT}`);
  } else {
    console.log(report);
  }
}

main();
