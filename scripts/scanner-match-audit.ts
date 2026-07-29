/**
 * SKANNER-REVISION — hur ofta hittar matchCards RÄTT kort när OCR:en läst PERFEKT?
 *
 * VARFÖR DEN HÄR MÄTNINGEN FINNS (2026-07-29): "skannern gissar fel kort" lästes
 * som ett modellproblem, men vision-modellen är bara halva kedjan. Andra halvan
 * är katalogslagningen — och den kan kasta rätt kort INNAN modellen ens haft fel.
 * Mätt mot prod: 18 938 av 20 563 kort (92 %) delar namn med minst ett annat kort,
 * och "charizard" ger 111 kandidatrader medan matchCards hämtade `take: 50` UTAN
 * `orderBy`. Ett slumpurval, alltså — rätt kort låg utanför urvalet ungefär varannan
 * gång, och VILKA 50 man fick varierade mellan körningar.
 *
 * Skriptet matar matchCards med ett FACIT: kortets eget namn och dess tryckta
 * nummer, dvs exakt vad en felfri OCR skulle returnera. Missar matchningen då är
 * felet bevisat i slagningen, inte i modellen — och den delen kostar inga
 * vision-tokens att laga.
 *
 * Två profiler, för de mäter olika saker:
 *   perfekt   namn + "nummer/total"  → slagningens tak
 *   utan-nr   bara namn              → vad som händer när numret är oläsligt
 *              (suddig bild, kortet i plastficka, fingret över hörnet)
 *
 * Två urval, för snittet döljer det som gör ont:
 *   uniform   var N:te kort i katalogen
 *   svår      bara kort vars namn delas av ≥5 andra kort (Charizard, Pikachu …)
 *
 * Urvalet är DETERMINISTISKT (sorterat på id, fast steglängd) så att en körning
 * före och efter en ändring jämför samma kort. Läser bara — skriver ingenting.
 *
 *   node scripts/with-prod-db.mjs npx tsx scripts/scanner-match-audit.ts
 *   SAMPLE=300 npx tsx scripts/scanner-match-audit.ts            # större urval
 */
import { PrismaClient } from "@prisma/client";
import { matchCards } from "../src/services/scanner";

const prisma = new PrismaClient();

const SAMPLE = Math.max(10, Number(process.env.SAMPLE ?? "200"));

interface Facit {
  cardId: string;
  name: string;
  number: string;
  total: number;
  setName: string;
}

/** Var N:te kort ur hela katalogen — deterministiskt, sorterat på id. */
async function uniformSample(n: number): Promise<Facit[]> {
  const total = await prisma.card.count();
  const stride = Math.max(1, Math.floor(total / n));
  const rows = await prisma.card.findMany({
    orderBy: { id: "asc" },
    select: { id: true, name: true, number: true, set: { select: { name: true, totalCards: true } } },
  });
  const out: Facit[] = [];
  for (let i = 0; i < rows.length && out.length < n; i += stride) {
    const r = rows[i];
    out.push({
      cardId: r.id,
      name: r.name,
      number: r.number,
      total: r.set.totalCards,
      setName: r.set.name,
    });
  }
  return out;
}

/** Kort vars namn delas av minst 5 andra kort — där numret ÄR identiteten. */
async function hardSample(n: number): Promise<Facit[]> {
  const dupes = await prisma.$queryRaw<{ name: string }[]>`
    SELECT name FROM "Card" GROUP BY name HAVING COUNT(*) >= 5 ORDER BY name ASC
  `;
  const names = dupes.map((d) => d.name);
  const rows = await prisma.card.findMany({
    where: { name: { in: names } },
    orderBy: { id: "asc" },
    select: { id: true, name: true, number: true, set: { select: { name: true, totalCards: true } } },
  });
  const stride = Math.max(1, Math.floor(rows.length / n));
  const out: Facit[] = [];
  for (let i = 0; i < rows.length && out.length < n; i += stride) {
    const r = rows[i];
    out.push({
      cardId: r.id,
      name: r.name,
      number: r.number,
      total: r.set.totalCards,
      setName: r.set.name,
    });
  }
  return out;
}

interface Tally {
  n: number;
  top1: number;
  top5: number;
  empty: number;
  misses: { name: string; number: string; setName: string; got: string }[];
}

async function run(facit: Facit[], withNumber: boolean): Promise<Tally> {
  const t: Tally = { n: 0, top1: 0, top5: 0, empty: 0, misses: [] };
  for (const f of facit) {
    // Simulerad OCR: exakt vad en felfri läsning skulle ge.
    const guessedNumber = withNumber
      ? f.total > 0
        ? `${f.number}/${f.total}`
        : f.number
      : undefined;
    const candidates = await matchCards({
      rawText: [f.name, guessedNumber].filter(Boolean).join(" "),
      guessedName: f.name,
      guessedNumber,
      confidence: 0.9,
    });
    t.n++;
    if (candidates.length === 0) t.empty++;
    if (candidates[0]?.cardId === f.cardId) t.top1++;
    else if (t.misses.length < 12) {
      const got = candidates[0]
        ? `${candidates[0].name} ${candidates[0].number} (${candidates[0].setName})`
        : "INGEN TRÄFF";
      t.misses.push({ name: f.name, number: f.number, setName: f.setName, got });
    }
    if (candidates.slice(0, 5).some((c) => c.cardId === f.cardId)) t.top5++;
  }
  return t;
}

function report(label: string, t: Tally) {
  const pct = (x: number) => `${((x / t.n) * 100).toFixed(1)}%`.padStart(6);
  console.log(
    `${label.padEnd(22)} topp-1 ${pct(t.top1)}   topp-5 ${pct(t.top5)}   noll träffar ${pct(t.empty)}   (n=${t.n})`
  );
}

async function main() {
  console.log(`Urval: ${SAMPLE} kort per profil (deterministiskt).\n`);

  const uniform = await uniformSample(SAMPLE);
  const hard = await hardSample(SAMPLE);
  console.log(`uniform: ${uniform.length} kort · svår (namn delat av ≥5): ${hard.length} kort\n`);

  const results: [string, Tally][] = [
    ["uniform · perfekt", await run(uniform, true)],
    ["uniform · utan nummer", await run(uniform, false)],
    ["svår · perfekt", await run(hard, true)],
    ["svår · utan nummer", await run(hard, false)],
  ];

  for (const [label, t] of results) report(label, t);

  console.log("\nExempel på missar (facit → vad matchningen valde):");
  for (const [label, t] of results) {
    if (!t.misses.length) continue;
    console.log(`\n  [${label}]`);
    for (const m of t.misses.slice(0, 6)) {
      console.log(`    ${m.name} ${m.number} (${m.setName})`);
      console.log(`      → ${m.got}`);
    }
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
