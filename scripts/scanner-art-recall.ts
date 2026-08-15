/**
 * KONST-RECALL — skulle bilden ENSAM hitta kortet, utan ett enda vision-anrop?
 *
 *   node scripts/with-prod-db.mjs npx tsx scripts/scanner-art-recall.ts
 *   TOPN=15 node scripts/with-prod-db.mjs npx tsx scripts/scanner-art-recall.ts
 *
 * VARFÖR: designfrågan 2026-08-15 är om skannern kan bli HELT gratis genom att
 * bilden identifierar KONSTEN och användaren väljer tryckning ur en lista.
 * Då byter kravet skepnad: det är inte längre "väljer vi rätt kort automatiskt"
 * (topp-1-precision) utan "ligger rätt kort i listan vi visar" (topp-N-recall).
 * Det är TVÅ HELT OLIKA MÅTT, och alla siffror vi har mäter det första.
 *
 * ⛔ **DET HÄR ÄR INTE `scanner-choice-replay.ts`.** Den replayar HELA vägen
 *    (bild + lagrat modellsvar → matchCards) och mäter slutvalet. Här kopplas
 *    texten BORT helt: bara `searchByFramesDetailed`, dvs exakt vad vi skulle ha
 *    kvar om vision-anropet togs bort. Ett högt tal i den ena säger ingenting om
 *    den andra.
 *
 * ⛔ **RANGEN ÄR LIKA VIKTIG SOM RECALLEN.** Recall@15 på 97 % är värdelöst om
 *    rätt kort typiskt ligger på plats 12 — då blir "valet" en lista användaren
 *    måste botanisera i. Fördelningen skrivs därför ut per rang, och det är den
 *    som avgör hur många kort menyn kan visa.
 *
 * ⚠️ **URVALET ÄR ÄGARENS EGNA SKANNINGAR.** Diagnostiken (som bär avtrycken)
 *    sparas bara för admin, så facitsetet är omsorgsfullt tagna fångster av en
 *    person som vet hur skannern vill hållas. Riktiga användare är sämre. Talet
 *    här är alltså ett TAK — samma sorts tak som art-audit-harnesset, och
 *    projektet har redan bränt sig två gånger på att läsa ett tak som ett facit
 *    (79 % hoppfrekvens i doc mot 30,5 % i produktion). Läs det som "om inte ens
 *    DET HÄR talet håller, är designen död", aldrig som den förväntade utfallet.
 *
 * Läser bara. Inga API-anrop (modellsvaren är lagrade och används inte alls).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { Prisma, PrismaClient } from "@prisma/client";
import { FINGERPRINT_BYTES, STRUCT_BYTES } from "../src/lib/art-fingerprint";
import { type ArtQuery, searchByFramesDetailed } from "../src/services/scanner/art-index";
import { artConfidentFrom } from "../src/services/scanner/index";

const prisma = new PrismaClient();
const LABELS_PATH = path.join(__dirname, "scanner-labels.json");
const TOPN = Number(process.env.TOPN ?? "15");

interface Diag {
  v?: number;
  provider?: string;
  frames?: string[][];
  structFrames?: string[][];
  fingerprints?: string[];
  chosen?: { cardId?: string } | null;
}

interface Label {
  truth?: string | null;
  population?: string;
}

function decode(b64: string | undefined, expected: number): Int8Array | null {
  if (!b64) return null;
  try {
    const buf = Buffer.from(b64, "base64");
    if (buf.length !== expected) return null;
    return new Int8Array(buf.buffer, buf.byteOffset, buf.length);
  } catch {
    return null;
  }
}

function decodeFrames(d: Diag): ArtQuery[][] {
  const frames = d.frames ?? (d.fingerprints?.length ? [d.fingerprints] : []);
  return frames
    .map((f, fi) =>
      f.flatMap((b64, i) => {
        const color = decode(b64, FINGERPRINT_BYTES);
        if (!color) return [];
        return [{ color, struct: decode(d.structFrames?.[fi]?.[i], STRUCT_BYTES) }];
      })
    )
    .filter((f) => f.length > 0);
}

async function main() {
  const labels: Record<string, Label> = JSON.parse(readFileSync(LABELS_PATH, "utf8"));
  const ids = Object.entries(labels)
    .filter(([, v]) => v.truth && typeof v.truth === "string" && /^c[a-z0-9]{20,}$/i.test(v.truth))
    .map(([id]) => id);

  const jobs = await prisma.scannerJob.findMany({
    where: { id: { in: ids }, NOT: { result: { equals: Prisma.DbNull } } },
    select: { id: true, result: true },
  });

  let n = 0;
  const rankHist = new Map<number, number>(); // rang (1-baserad), -1 = utanför topp-N
  const missed: string[] = [];
  // Nollklicks-vägen: trust-regeln fyrar OCH har rätt. Samma delade dom som
  // produktionen (artConfidentFrom) — inte en egen tolkning av tröskeln.
  let trustFired = 0;
  let trustRight = 0;
  const perPopulation = new Map<string, { n: number; inTop: number; top1: number }>();

  for (const job of jobs) {
    const d = job.result as Diag;
    if (d?.v !== 1) continue;
    const truth = labels[job.id].truth as string;
    const frames = decodeFrames(d);
    if (frames.length === 0) continue;
    n++;

    const { best, frameTops } = await searchByFramesDetailed(frames, TOPN);
    const rank = best.findIndex((m) => m.cardId === truth) + 1; // 0 => saknas
    const found = rank > 0;
    rankHist.set(found ? rank : -1, (rankHist.get(found ? rank : -1) ?? 0) + 1);

    const confident = artConfidentFrom(best, frameTops);
    if (confident !== null) {
      trustFired++;
      if (confident === truth) trustRight++;
    }

    const pop = labels[job.id].population ?? "okand";
    const agg = perPopulation.get(pop) ?? { n: 0, inTop: 0, top1: 0 };
    agg.n++;
    if (found) agg.inTop++;
    if (rank === 1) agg.top1++;
    perPopulation.set(pop, agg);

    if (!found) {
      // ⛔ `ArtMatch` bär BARA cardId + score — namnet måste slås upp. En rad
      // som skriver "undefined undefined" gör missen omöjlig att felsöka, och
      // det är just missarna verktyget finns för.
      const [t, b] = await Promise.all([
        prisma.card.findUnique({
          where: { id: truth },
          select: { name: true, number: true, artFingerprint: true, set: { select: { name: true } } },
        }),
        best[0]
          ? prisma.card.findUnique({
              where: { id: best[0].cardId },
              select: { name: true, number: true, set: { select: { name: true } } },
            })
          : Promise.resolve(null),
      ]);
      missed.push(
        `${job.id.slice(-6)}  ${t?.name} ${t?.number} (${t?.set.name})` +
          `${t?.artFingerprint ? "" : "  ⚠️ KORTET SAKNAR AVTRYCK"}` +
          `  bäst: ${b ? `${b.name} ${b.number} (${b.set.name})` : "—"}` +
          `${best[0] ? ` @ ${best[0].score.toFixed(3)}` : ""}`
      );
    }
  }

  const atOrBetter = (k: number): number => {
    let c = 0;
    for (const [rank, count] of rankHist) if (rank > 0 && rank <= k) c += count;
    return c;
  };

  const pct = (v: number): string => `${((v / n) * 100).toFixed(1)} %`;

  console.log(`\n=== KONST-RECALL (bild ensam, inget vision-anrop) — n=${n} ===\n`);
  console.log(`  topp-1   : ${String(atOrBetter(1)).padStart(3)}/${n}  ${pct(atOrBetter(1))}`);
  console.log(`  topp-3   : ${String(atOrBetter(3)).padStart(3)}/${n}  ${pct(atOrBetter(3))}`);
  console.log(`  topp-5   : ${String(atOrBetter(5)).padStart(3)}/${n}  ${pct(atOrBetter(5))}`);
  console.log(`  topp-10  : ${String(atOrBetter(10)).padStart(3)}/${n}  ${pct(atOrBetter(10))}`);
  console.log(`  topp-${TOPN}  : ${String(atOrBetter(TOPN)).padStart(3)}/${n}  ${pct(atOrBetter(TOPN))}   <-- GRINDEN`);
  console.log(`  utanför  : ${String(rankHist.get(-1) ?? 0).padStart(3)}/${n}  ${pct(rankHist.get(-1) ?? 0)}`);

  console.log(`\n--- Rangfördelning (var i listan låg rätt kort?) ---`);
  for (const k of [...rankHist.keys()].filter((k) => k > 0).sort((a, b) => a - b)) {
    console.log(`  plats ${String(k).padStart(2)} : ${String(rankHist.get(k)).padStart(3)}  ${pct(rankHist.get(k)!)}`);
  }

  console.log(`\n--- Nollklicks-vägen (trust-regeln fyrar = inget val behövs) ---`);
  console.log(`  fyrade   : ${trustFired}/${n}  ${pct(trustFired)}`);
  console.log(
    `  och rätt : ${trustRight}/${trustFired}  ${trustFired ? `${((trustRight / trustFired) * 100).toFixed(1)} % precision` : "—"}`
  );

  if (perPopulation.size > 1) {
    console.log(`\n--- Per population ---`);
    for (const [pop, a] of [...perPopulation.entries()].sort()) {
      console.log(
        `  ${pop.padEnd(18)} n=${String(a.n).padStart(3)}  topp-${TOPN} ${((a.inTop / a.n) * 100).toFixed(1)} %  topp-1 ${((a.top1 / a.n) * 100).toFixed(1)} %`
      );
    }
  }

  if (missed.length) {
    console.log(`\n--- ${missed.length} UTANFÖR topp-${TOPN} (dessa kräver manuell sökning) ---`);
    for (const line of missed) console.log(line);
  }
}

main().finally(() => prisma.$disconnect());
