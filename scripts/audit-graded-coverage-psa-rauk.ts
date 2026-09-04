/**
 * MÄTNING (rapport only): hur långt räcker DET VI HAR för PSA och RaukCard?
 *
 * Två helt olika frågor, som aldrig får slås ihop:
 *   1. VILKA kort finns graderade, och i vilka betyg?  (population)
 *   2. VAD är de värda?                                (pris)
 *
 * För RaukCard kan vi svara på (1) GRATIS och nästan komplett: bolagets egen
 * databas ligger öppet som ett Google Sheet (~30 000 cert-rader) som deras
 * webbplats själv läser klient-sida. ⛔ Den bär INGA priser — bara kort, betyg,
 * delbetyg och graderingsdatum. För PSA finns ingen motsvarighet: PSA:s publika
 * API är ren cert-uppslagning, utan pop-rapport och utan priser.
 *
 * För (2) har vi bara Tradera: sålda affärer (`GradedSale`) och — om vi tar med
 * dem — aktiva annonser.
 *
 * Kostar noll Tradera-anrop och EN katalogläsning. Skriver inget.
 */
import "dotenv/config";
import { prisma } from "../src/lib/db";
import { normalizeTitle } from "../src/lib/utils";
import { loadMatchIndex, matchProduct, type MatchIndex } from "../src/scrapers/matching";

const SHEET =
  "https://opensheet.elk.sh/1hZ-NFQ64wi2Z5fdUQJqu2ed5J7ZCpbpPr_L8O3RG6WE/Database";

/** Hur många UNIKA kortidentiteter ur arket vi matchar. 0 = alla (långsamt). */
const SAMPLE = Number(process.env.SAMPLE ?? 1200);

interface SheetRow {
  id?: string;
  Game?: string;
  Set?: string;
  "Card Name"?: string;
  Grade?: string;
  "Date Graded"?: string;
}

/** "2020 Pokémon English" → { game: "Pokémon", lang: "English", year: 2020 } */
function parseGame(g: string | undefined) {
  const s = (g ?? "").trim();
  const year = s.match(/\b(19|20)\d{2}\b/)?.[0];
  const lang = s.match(/\b(English|Japanese|Korean|Chinese|German|French|Italian|Spanish)\b/i)?.[1];
  const game = /pok[eé]mon/i.test(s) ? "Pokémon" : s.replace(/\b(19|20)\d{2}\b/, "").trim();
  return { year, lang, game };
}

function pct(n: number, t: number): string {
  return t ? `${((n / t) * 100).toFixed(1)} %` : "-";
}

async function main() {
  // ── 1. RaukCards egen databas ────────────────────────────────────────────
  const res = await fetch(SHEET, { signal: AbortSignal.timeout(60000) });
  const rows: SheetRow[] = await res.json();
  const withData = rows.filter((r) => r["Card Name"] && r.Grade);
  const pokemon = withData.filter((r) => parseGame(r.Game).game === "Pokémon");

  console.log(`\n=== RAUKCARDS EGEN DATABAS (publikt Google Sheet) ===`);
  console.log(`  cert-rader totalt:        ${rows.length}`);
  console.log(`  med kort + betyg ifyllt:  ${withData.length}  ${pct(withData.length, rows.length)}`);
  console.log(`  varav Pokémon:            ${pokemon.length}  ${pct(pokemon.length, withData.length)}`);

  const byLang = new Map<string, number>();
  for (const r of pokemon) {
    const l = parseGame(r.Game).lang ?? "(okänt)";
    byLang.set(l, (byLang.get(l) ?? 0) + 1);
  }
  console.log(`  språk: ${[...byLang.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join(", ")}`);

  const byGrade = new Map<string, number>();
  for (const r of pokemon) byGrade.set(r.Grade!, (byGrade.get(r.Grade!) ?? 0) + 1);
  console.log(
    `  betyg: ${[...byGrade.entries()]
      .sort((a, b) => (parseFloat(b[0]) || -1) - (parseFloat(a[0]) || -1))
      .map(([k, v]) => `${k}:${v}`)
      .join("  ")}`
  );

  // Unika kortidentiteter — samma kort graderas många gånger.
  const identities = new Map<string, { title: string; grades: Map<string, number>; certs: number }>();
  for (const r of pokemon) {
    const key = `${parseGame(r.Game).lang ?? ""}|${r.Set ?? ""}|${r["Card Name"]}`;
    let e = identities.get(key);
    if (!e) {
      e = { title: `${r["Card Name"]} ${r.Set ?? ""}`.trim(), grades: new Map(), certs: 0 };
      identities.set(key, e);
    }
    e.certs++;
    e.grades.set(r.Grade!, (e.grades.get(r.Grade!) ?? 0) + 1);
  }
  console.log(`  UNIKA kortidentiteter:    ${identities.size}  (≈ ${(pokemon.length / identities.size).toFixed(1)} cert per kort)`);

  // ── 2. Hur många av dem finns i VÅR katalog? ─────────────────────────────
  console.log(`\n=== MATCHNING MOT KATALOGEN ===`);
  const index: MatchIndex = await loadMatchIndex();
  console.log(`  katalogindex: ${index.length} produkter`);

  const all = [...identities.entries()];
  // Deterministiskt urval över hela listan (inte de första N — de är sorterade
  // efter cert-id, dvs kronologiskt, och hade blivit 2021 års set).
  const step = SAMPLE > 0 && SAMPLE < all.length ? Math.floor(all.length / SAMPLE) : 1;
  const sample = step > 1 ? all.filter((_, i) => i % step === 0) : all;

  const matchedProducts = new Set<string>();
  let matchedRows = 0;
  let certsCovered = 0;
  let certsTotal = 0;
  const t0 = Date.now();
  for (const [, e] of sample) {
    certsTotal += e.certs;
    const m = await matchProduct(normalizeTitle(e.title), index, e.title);
    if (!m) continue;
    matchedRows++;
    certsCovered += e.certs;
    matchedProducts.add(m.productId);
  }
  const secs = ((Date.now() - t0) / 1000).toFixed(0);

  console.log(`  urval:                    ${sample.length} unika kort (av ${all.length})  [${secs}s]`);
  console.log(`  matchade en produkt:      ${matchedRows}  ${pct(matchedRows, sample.length)}`);
  console.log(`  distinkta produkter:      ${matchedProducts.size}`);
  console.log(`  cert-täckning i urvalet:  ${certsCovered}/${certsTotal}  ${pct(certsCovered, certsTotal)}`);
  if (sample.length < all.length) {
    console.log(
      `  ≈ UPPSKATTNING över hela arket: ~${Math.round((matchedProducts.size / sample.length) * all.length)} produkter ` +
        `(linjär, färre i praktiken — samma produkt återkommer)`
    );
  }

  // ── 3. Vad vi kan PRISSÄTTA i dag (Tradera) ──────────────────────────────
  console.log(`\n=== PRISDATA VI FAKTISKT HAR (Tradera, sålt) ===`);
  for (const issuer of ["PSA", "RAUKCARD"]) {
    const sales = await prisma.gradedSale.count({ where: { issuer } });
    const prods = await prisma.gradedSale.groupBy({ by: ["productId"], where: { issuer } });
    const rungs = await prisma.gradedSale.groupBy({ by: ["productId", "gradeTenths"], where: { issuer }, _count: true });
    const multi = rungs.filter((r) => r._count >= 2).length;
    console.log(
      `  ${issuer.padEnd(9)} ${String(sales).padStart(4)} affärer · ${String(prods.length).padStart(4)} produkter · ` +
        `${rungs.length} (produkt×betyg)-rutor, varav ${multi} med n>=2`
    );
  }

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
