/**
 * SKANNER-TELEMETRI — läser admin-diagnostiken ur `ScannerJob.result`.
 *
 * Finns för att alla träffsäkerhetssiffror vi räknat fram offline är TAK: frågorna
 * härleds ur samma filer som referenserna, så de kan inte visa vad en riktig
 * fångst gör. Det här är den enda källan till verkliga tal.
 *
 * Skrivs bara för admin (dataminimering) — se `recordScanUsage`. Lagrar
 * konstavtrycket (264 byte), aldrig bilden.
 *
 *   node scripts/with-prod-db.mjs npx tsx scripts/scanner-telemetry.ts
 *   TAKE=40 …    # fler skanningar
 */
import { Prisma, PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const TAKE = Number(process.env.TAKE ?? "30");

interface Diag {
  v?: number;
  provider?: string;
  usage?: { inputTokens: number; outputTokens: number } | null;
  guessedName?: string | null;
  guessedNumber?: string | null;
  guessedEra?: string | null;
  guessedHp?: number | null;
  confidence?: number;
  artTop?: number | null;
  artTopLabel?: string | null;
  chosen?: { name: string; number: string; setName: string; score: number } | null;
}

/** Haiku 4.5-prislista ($/MTok) — byt vid modellbyte. */
const USD_PER_MTOK_IN = 1;
const USD_PER_MTOK_OUT = 5;

function usdForCall(u: { inputTokens: number; outputTokens: number }): number {
  return (u.inputTokens * USD_PER_MTOK_IN + u.outputTokens * USD_PER_MTOK_OUT) / 1e6;
}

/** Poängen ur "Namn Nr 0.857 | Namn Nr 0.478 | …". */
function artScores(label: string | null | undefined): number[] {
  return (label ?? "")
    .split("|")
    .map((p) => Number(p.trim().split(/\s+/).pop()))
    .filter((n) => Number.isFinite(n));
}

function stats(xs: number[]): string {
  if (xs.length === 0) return "–";
  const s = [...xs].sort((a, b) => a - b);
  const q = (p: number) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return `min ${s[0].toFixed(3)} · median ${q(0.5).toFixed(3)} · max ${s[s.length - 1].toFixed(3)}`;
}

async function main() {
  const jobs = await prisma.scannerJob.findMany({
    // Prisma vill ha JsonNull-sentinelen, inte `null`, för Json-kolumner.
    where: { NOT: { result: { equals: Prisma.DbNull } } },
    orderBy: { createdAt: "desc" },
    take: TAKE,
    select: { createdAt: true, result: true },
  });
  const rows = jobs
    .map((j) => ({ at: j.createdAt, d: j.result as Diag }))
    .filter((r) => r.d?.v === 1);

  if (rows.length === 0) {
    console.log("Ingen diagnostik hittad — skanna som admin först.");
    return;
  }
  console.log(`${rows.length} skanningar med diagnostik\n`);

  const artMargins: number[] = [];
  const artTops: number[] = [];
  let numberUsable = 0;
  let nameEmpty = 0;
  let artTrusted = 0;

  for (const { at, d } of rows) {
    const sc = artScores(d.artTopLabel);
    const margin = sc.length >= 2 ? sc[0] - sc[1] : null;
    if (margin != null) artMargins.push(margin);
    if (sc.length) artTops.push(sc[0]);
    const trusted = sc[0] >= 0.7 && (margin ?? 0) >= 0.1;
    if (trusted) artTrusted++;
    // Ett användbart nummer är det som faktiskt kan särskilja namntvillingar.
    const num = (d.guessedNumber ?? "").trim();
    const usable = num.length > 0 && /\d/.test(num) && !/[<>{}"=]/.test(num);
    if (usable) numberUsable++;
    if (!(d.guessedName ?? "").trim()) nameEmpty++;

    console.log(
      `${at.toISOString().slice(11, 19)}  "${d.guessedName ?? ""}" / "${num}"` +
        `${d.guessedEra ? ` era:${d.guessedEra}` : ""}${d.guessedHp ? ` hp:${d.guessedHp}` : ""}` +
        `  → ${d.chosen ? `${d.chosen.name} ${d.chosen.number} (${d.chosen.setName})` : "—"}` +
        `  bild ${sc[0]?.toFixed(3) ?? "–"} marg ${margin?.toFixed(3) ?? "–"}` +
        `${trusted ? " SÄKER" : ""}${usable ? "" : " · nr oläst"}`
    );
    // Bildens EGNA toppträffar på egen rad: skiljer "bilden valde fel kort"
    // från "bilden valde rätt men texten överröstade den" — olika åtgärder.
    if (d.artTopLabel) console.log(`          bild-topp: ${d.artTopLabel}`);
  }

  console.log(`\n--- ${rows.length} skanningar ---`);
  console.log(`nummer användbart:        ${numberUsable}/${rows.length}`);
  console.log(`namn tomt:                ${nameEmpty}/${rows.length}`);
  console.log(`bildträff SÄKER:          ${artTrusted}/${rows.length}`);
  console.log(`bildens topp-poäng:  ${stats(artTops)}`);
  console.log(`bildens marginal:    ${stats(artMargins)}`);

  // VERKLIG vision-kostnad ur API:ts egna tokental (nya rader bär usage).
  // PER LEVERANTÖR: hela poängen med ett modellbyte är om NUMRET läses bättre
  // och vad det kostar. En blandad totalsiffra svarar på ingetdera.
  const byProvider = new Map<string, { n: number; num: number; cost: number; inTok: number }>();
  for (const r of rows) {
    const prov = r.d.provider ?? "okand";
    if (prov === "bild") continue;
    const a = byProvider.get(prov) ?? { n: 0, num: 0, cost: 0, inTok: 0 };
    a.n++;
    if (r.d.guessedNumber) a.num++;
    a.inTok += r.d.usage?.inputTokens ?? 0;
    byProvider.set(prov, a);
  }
  if (byProvider.size > 1) {
    console.log("\n--- per leverantör ---");
    for (const [prov, a] of [...byProvider.entries()].sort()) {
      console.log(
        `${prov.padEnd(8)} ${a.n} anrop · nummer läst ${a.num}/${a.n}` +
          ` · medel ${Math.round(a.inTok / Math.max(1, a.n))} in-tokens`
      );
    }
  }

  const withUsage = rows.filter((r) => r.d.usage && r.d.provider !== "bild");
  const skipped = rows.filter((r) => r.d.provider === "bild").length;
  if (withUsage.length > 0) {
    const costs = withUsage.map((r) => usdForCall(r.d.usage!));
    const total = costs.reduce((a, b) => a + b, 0);
    const tokIn = withUsage.reduce((a, r) => a + r.d.usage!.inputTokens, 0);
    const tokOut = withUsage.reduce((a, r) => a + r.d.usage!.outputTokens, 0);
    console.log(
      `vision-kostnad (MÄTT): ${withUsage.length} anrop à $${(total / withUsage.length).toFixed(4)} ` +
        `(medel ${Math.round(tokIn / withUsage.length)} in / ${Math.round(tokOut / withUsage.length)} ut tok) · ` +
        `summa $${total.toFixed(3)} · ${skipped} hoppade ($0)`
    );
  } else {
    console.log(`vision-kostnad: inga rader med usage ännu (skanna efter deployen)`);
  }
}

main().finally(() => prisma.$disconnect());
