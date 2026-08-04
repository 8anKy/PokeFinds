/**
 * FOLIESONDENS FACIT — läser ADMIN-diagnostiken och visar om molnen separerar.
 *
 * Steg 2 i planen (project_foil_detection_plan): det här skriptet svarar på om
 * måtten faktiskt skiljer folierade kort från oflorierade. Det SKRIVER INGENTING
 * och räknar ingenting om — sonderna sparas råa i `ScannerJob.result.foil`, så
 * samma skanningar kan användas om måtten ändras.
 *
 * ⛔ PARADE KORT BEHÖVS INTE (rättat 2026-08-04, ägaren äger bara reverse-sidan
 * av sina kort). Signal 1 jämför varje skanning mot KORTETS EGEN katalogreferens,
 * och referensen ÄR den platta standardrenderingen — en reverse holo mäts alltså
 * redan mot sin egen standardversion. Det mätningen behöver är NEGATIVA EXEMPEL,
 * inte par: några skanningar av kort som bevisligen INTE är folierade. Vilka kort
 * som helst duger (bulk-commons, energier).
 *
 * ANVÄNDNING
 *   node scripts/with-prod-db.mjs npx tsx scripts/foil-probe-audit.ts
 *   SINCE=2026-08-04 node scripts/with-prod-db.mjs npx tsx scripts/foil-probe-audit.ts
 *   # EN brytpunkt: oflorierade först, sedan foliekorten.
 *   SPLIT=2026-08-04T18:30:00Z node … scripts/foil-probe-audit.ts
 *   # A/B/A: oflorierade → folie → oflorierade igen (rekommenderat, se nedan).
 *   SPLITS=2026-08-04T18:10:00Z,2026-08-04T18:20:00Z node … scripts/foil-probe-audit.ts
 *
 * ⚠️ LJUSET ÄR DEN FARLIGA FÖRVÄXLINGEN med oparade klasser: skannas alla
 * oflorierade vid fönstret på eftermiddagen och alla foliekort under lampan på
 * kvällen, korrelerar brytpunkten perfekt med BELYSNINGEN och måtten kan
 * "separera" utan att ha sett en enda folie. Därför A/B/A: håller de två
 * A-omgångarna ihop med varandra och skiljer sig från B, är det folien som mäts
 * och inte ljuset. Skriptet rapporterar A-omgångarna både var för sig och ihop.
 *
 * ⛔ UTAN facit (`SPLIT`/`SPLITS`) listas bara mätvärdena. Gissa ALDRIG vilken
 * skanning som var folierad utifrån talen själva; det är cirkulärt och ger exakt
 * den falska säkerhet planen varnar för.
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
  // Brytpunkterna delar tidslinjen i omgångar som VÄXLAR klass, med start på
  // "oflorierad". En brytpunkt = A/B, två = A/B/A, och så vidare.
  const splits = (process.env.SPLITS ?? process.env.SPLIT ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => new Date(s))
    .sort((a, b) => a.getTime() - b.getTime());

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

  if (splits.length === 0) {
    console.log(
      "\nInget facit angivet (SPLIT/SPLITS saknas) — bara mätvärden ovan.\n" +
        "⛔ Läs INTE ut vilken skanning som var folierad ur talen själva. Kör om med\n" +
        "   SPLIT=<ISO-tid>, eller SPLITS=<t1>,<t2> för A/B/A (rekommenderat: det\n" +
        "   skiljer folien från belysningen)."
    );
    return;
  }

  // Omgång = tidsintervall mellan brytpunkterna; klassen växlar per omgång.
  const roundOf = (at: Date) => splits.filter((s) => at >= s).length;
  const rounds = new Map<number, Row[]>();
  for (const row of rows) {
    const r = roundOf(row.at);
    (rounds.get(r) ?? rounds.set(r, []).get(r)!).push(row);
  }
  const plain = rows.filter((r) => roundOf(r.at) % 2 === 0);
  const foiled = rows.filter((r) => roundOf(r.at) % 2 === 1);
  console.log(
    `\nFACIT: ${rounds.size} omgång(ar) — ${plain.length} oflorierade, ${foiled.length} folierade.`
  );
  for (const [r, list] of [...rounds.entries()].sort((a, b) => a[0] - b[0])) {
    console.log(
      `  omgång ${r + 1}: ${r % 2 === 0 ? "OFLORIERAD" : "FOLIE     "} ${String(list.length).padStart(3)} skanningar` +
        ` (${list[0].at.toISOString().slice(11, 19)}–${list[list.length - 1].at.toISOString().slice(11, 19)})`
    );
  }
  if (rounds.size < 3) {
    console.log(
      "⚠️ Bara två omgångar: en skillnad kan lika gärna vara BELYSNING som folie.\n" +
        "   Kör en tredje omgång oflorierade och ange två brytpunkter (SPLITS=t1,t2)."
    );
  }
  console.log("");
  if (plain.length < 3 || foiled.length < 3) {
    console.log("För få skanningar per klass för att säga något. Skanna fler.");
    return;
  }

  // A-omgångarna var för sig: håller de ihop är det folien som mäts, inte ljuset.
  const plainRounds = [...rounds.entries()].filter(([r]) => r % 2 === 0);
  if (plainRounds.length >= 2) {
    console.log("DRIFTKONTROLL — de oflorierade omgångarnas medianer var för sig:");
    for (const m of METRICS) {
      const medians = plainRounds.map(([r, list]) => {
        const vals = list.map((x) => m.of(x.foil)).filter((v): v is number => v !== null);
        return vals.length ? `${r + 1}: ${median(vals).toFixed(3)}` : `${r + 1}: –`;
      });
      console.log(`  ${m.key.padEnd(15)} ${medians.join("   ")}`);
    }
    console.log(
      "  ⚠️ Skiljer sig A-omgångarna lika mycket från VARANDRA som från folien,\n" +
        "     mäter måttet förhållandena i rummet — inte kortet.\n"
    );
  }

  console.log("mått            oflorierad (min/median/max)     folie (min/median/max)       dom");
  for (const m of METRICS) {
    const s = plain.map((r) => m.of(r.foil)).filter((v): v is number => v !== null);
    const v = foiled.map((r) => m.of(r.foil)).filter((v): v is number => v !== null);
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
    const gapUp = vMin - sMax; // folien ligger över de oflorierade
    const gapDown = sMin - vMax; // folien ligger under
    const gap = Math.max(gapUp, gapDown);
    const verdict =
      gap > 0
        ? `SEPARERAR (gap ${gap.toFixed(3)}, ${gapUp > 0 ? "folie högre" : "folie lägre"})`
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
