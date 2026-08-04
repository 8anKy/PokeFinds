/**
 * FOLIESONDENS FACIT — läser ADMIN-diagnostiken och visar om molnen separerar.
 *
 * Steg 2 i planen (project_foil_detection_plan): ägaren skannar ~10 kort hen
 * äger i BÅDE standard och reverse holo, och det här skriptet svarar på om
 * måtten faktiskt skiljer dem åt. Det SKRIVER INGENTING och räknar ingenting om
 * — sonderna sparas råa i `ScannerJob.result.foil`, så samma skanningar kan
 * användas om måtten ändras.
 *
 * ANVÄNDNING
 *   node scripts/with-prod-db.mjs npx tsx scripts/foil-probe-audit.ts
 *   SINCE=2026-08-04 node scripts/with-prod-db.mjs npx tsx scripts/foil-probe-audit.ts
 *   # Skanna ALLA kort i standard först, sedan ALLA i reverse. Ange brytpunkten:
 *   SPLIT=2026-08-04T18:30:00Z node scripts/with-prod-db.mjs npx tsx scripts/foil-probe-audit.ts
 *
 * ⛔ UTAN `SPLIT` finns inget facit — då listas bara mätvärdena. Gissa ALDRIG
 * vilken skanning som var reverse utifrån talen själva; det är cirkulärt och ger
 * exakt den falska säkerhet planen varnar för.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

type Pair = { art: number; body: number; ratio: number | null };
type Foil = {
  dev: Pair | null;
  temporal: (Pair & { frames: number }) | null;
  spec: { clip: Pair; texture: Pair; chroma: Pair } | null;
  cardId: string | null;
};
type Row = {
  at: Date;
  card: string;
  foil: Foil;
};

/** Måtten som utvärderas. `higherIsReverse` = hypotesen om riktningen. */
const METRICS: Array<{ key: string; of: (f: Foil) => number | null; note: string }> = [
  { key: "dev.ratio", of: (f) => f.dev?.ratio ?? null, note: "kropp/konst mot referens" },
  { key: "dev.body", of: (f) => f.dev?.body ?? null, note: "kroppens avvikelse" },
  { key: "temporal.ratio", of: (f) => f.temporal?.ratio ?? null, note: "rörelse kropp/konst" },
  { key: "clip.ratio", of: (f) => f.spec?.clip.ratio ?? null, note: "utbränt kropp/konst" },
  { key: "texture.ratio", of: (f) => f.spec?.texture.ratio ?? null, note: "sparkle kropp/konst" },
];

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function fmt(v: number | null | undefined, w = 7): string {
  return (v === null || v === undefined ? "–" : v.toFixed(3)).padStart(w);
}

async function main() {
  const since = new Date(process.env.SINCE ?? Date.now() - 24 * 60 * 60 * 1000);
  const split = process.env.SPLIT ? new Date(process.env.SPLIT) : null;

  const jobs = await prisma.scannerJob.findMany({
    where: { createdAt: { gte: since } },
    orderBy: { createdAt: "asc" },
    select: { createdAt: true, result: true },
  });

  const rows: Row[] = [];
  for (const job of jobs) {
    const r = job.result as (Record<string, unknown> & { foil?: Foil; chosen?: { name?: string; number?: string } }) | null;
    if (!r || typeof r !== "object" || !r.foil) continue;
    rows.push({
      at: job.createdAt,
      card: r.chosen ? `${r.chosen.name ?? "?"} ${r.chosen.number ?? ""}`.trim() : "(ingen träff)",
      foil: r.foil,
    });
  }

  if (rows.length === 0) {
    console.log(`Inga skanningar med foliesond sedan ${since.toISOString()}.`);
    console.log("Sonden lagras BARA för admin — skanna med ägarkontot.");
    return;
  }

  console.log(`FOLIESOND — ${rows.length} skanningar sedan ${since.toISOString()}\n`);
  console.log(
    "tid       kort                            dev.b/a   dev.b  temp.b/a  clip.b/a   tex.b/a  rutor"
  );
  for (const row of rows) {
    const f = row.foil;
    console.log(
      [
        row.at.toISOString().slice(11, 19),
        row.card.slice(0, 30).padEnd(30),
        fmt(f.dev?.ratio),
        fmt(f.dev?.body),
        fmt(f.temporal?.ratio),
        fmt(f.spec?.clip.ratio),
        fmt(f.spec?.texture.ratio),
        String(f.temporal?.frames ?? 0).padStart(4),
      ].join(" ")
    );
  }

  if (!split) {
    console.log(
      "\nInget facit angivet (SPLIT saknas) — bara mätvärden ovan.\n" +
        "⛔ Läs INTE ut vilken skanning som var reverse ur talen själva. Kör om med\n" +
        "   SPLIT=<ISO-tid> där standard-omgången slutade och reverse-omgången började."
    );
    return;
  }

  const standard = rows.filter((r) => r.at < split);
  const reverse = rows.filter((r) => r.at >= split);
  console.log(
    `\nFACIT: ${standard.length} standard före ${split.toISOString()}, ${reverse.length} reverse efter.\n`
  );
  if (standard.length < 3 || reverse.length < 3) {
    console.log("För få skanningar per klass för att säga något. Skanna fler.");
    return;
  }

  console.log("mått            standard (min/median/max)      reverse (min/median/max)     dom");
  for (const m of METRICS) {
    const s = standard.map((r) => m.of(r.foil)).filter((v): v is number => v !== null);
    const v = reverse.map((r) => m.of(r.foil)).filter((v): v is number => v !== null);
    if (s.length < 3 || v.length < 3) {
      console.log(`${m.key.padEnd(15)} för få värden (${s.length}/${v.length})`);
      continue;
    }
    const sMin = Math.min(...s);
    const sMax = Math.max(...s);
    const vMin = Math.min(...v);
    const vMax = Math.max(...v);
    // SEPARATION = molnen överlappar INTE. Det är kravet för en marginalregel;
    // "medianerna skiljer sig" räcker inte — överlappande fördelningar var precis
    // vad som gjorde POÄNGEN oanvändbar i bildmatchningen, medan MARGINALEN dög.
    const gapUp = vMin - sMax; // reverse ligger över standard
    const gapDown = sMin - vMax; // reverse ligger under standard
    const gap = Math.max(gapUp, gapDown);
    const verdict =
      gap > 0
        ? `SEPARERAR (gap ${gap.toFixed(3)}, ${gapUp > 0 ? "reverse högre" : "reverse lägre"})`
        : "överlappar";
    console.log(
      `${m.key.padEnd(15)} ${fmt(sMin)}/${fmt(median(s))}/${fmt(sMax)}   ` +
        `${fmt(vMin)}/${fmt(median(v))}/${fmt(vMax)}   ${verdict}`
    );
  }
  console.log(
    "\nTOLKNING: bara ett mått som SEPARERAR (inget överlapp, med marginal) duger\n" +
      "som grund för ett automatiskt variantval. Överlappar allt är svaret att\n" +
      "väljaren förblir manuell — och då har vi bara kostat den här mätningen."
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
