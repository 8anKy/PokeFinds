/**
 * SKIP-REVISION — kan fler fångster hoppa över Haiku UTAN att precisionen
 * faller? Mäts mot facit, aldrig mot känsla.
 *
 * Dagens regel (100 % uppmätt precision, 24/42 hoppade): bästa rutans topp-1
 * med poäng ≥ ART_TRUST_SCORE och marginal ≥ ART_TRUST_MARGIN. Kandidatregeln
 * här lägger till TEMPORAL SAMSTÄMMIGHET: fångsten bär flera videorutor, och
 * om ALLA rutors topp-1 pekar på SAMMA kort är det oberoende bevis av samma
 * slag som live-låsets "tre pollar i rad" — då kan marginalkravet på den bästa
 * rutan eventuellt sänkas.
 *
 * Skriptet listar, för varje facitmärkt skanning: rutantal, ruta-agreement,
 * bästa marginal, om dagens regel hoppar, och om kandidatregler (agreement +
 * lägre marginal M) hade hoppat — och framför allt om något hopp hade varit
 * FEL (precision < 100 % = regeln är död).
 *
 *   node scripts/with-prod-db.mjs npx tsx scripts/scanner-skip-audit.ts
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { Prisma, PrismaClient } from "@prisma/client";
import { FINGERPRINT_BYTES, STRUCT_BYTES } from "../src/lib/art-fingerprint";
import { type ArtQuery, searchByFramesDetailed } from "../src/services/scanner/art-index";
import { ART_TRUST_MARGIN, ART_TRUST_SCORE } from "../src/services/scanner/index";

const prisma = new PrismaClient();
const LABELS_PATH = path.join(__dirname, "scanner-labels.json");
/** Kandidat-marginaler att pröva ihop med full ruta-samstämmighet. */
const CANDIDATE_MARGINS = [0.08, 0.06, 0.05, 0.04, 0.02];

interface Diag {
  v?: number;
  frames?: string[][];
  structFrames?: string[][];
  fingerprints?: string[];
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
  const labels: Record<string, { truth?: string | null }> = JSON.parse(
    readFileSync(LABELS_PATH, "utf8")
  );
  const ids = Object.entries(labels)
    .filter(([, v]) => v.truth && /^c[a-z0-9]{20,}$/i.test(v.truth as string))
    .map(([id]) => id);
  const jobs = await prisma.scannerJob.findMany({
    where: { id: { in: ids }, NOT: { result: { equals: Prisma.DbNull } } },
    select: { id: true, result: true },
  });

  let n = 0;
  let todaySkip = 0;
  let todaySkipRight = 0;
  const cand = CANDIDATE_MARGINS.map((m) => ({
    margin: m,
    skips: 0,
    right: 0,
    wrongIds: [] as string[],
  }));

  for (const job of jobs) {
    const d = job.result as Diag;
    if (d?.v !== 1) continue;
    const truth = labels[job.id].truth as string;
    const frames = decodeFrames(d);
    if (frames.length === 0) continue;
    n++;

    // Basregeln räknas separat; kandidatraderna nedan visar utvidgningarna.
    // (Produktionen kör numera basregel + samstämmighet vid ≥ 0,05 — raden
    // "marginal ≥ 0.05" ÄR produktionens beteende.)
    const { best, frameTops } = await searchByFramesDetailed(frames, 15);
    const bestMargin = best.length >= 2 ? best[0].score - best[1].score : 0;
    const todayConfident =
      best.length >= 2 && best[0].score >= ART_TRUST_SCORE && bestMargin >= ART_TRUST_MARGIN;
    if (todayConfident) {
      todaySkip++;
      if (best[0].cardId === truth) todaySkipRight++;
    }

    const tops = frameTops;
    const allAgree =
      tops.length >= 2 && tops.every((t) => t.cardId === tops[0].cardId);

    for (const c of cand) {
      const wouldSkip =
        todayConfident ||
        (allAgree &&
          best.length >= 2 &&
          best[0].score >= ART_TRUST_SCORE &&
          bestMargin >= c.margin &&
          tops[0].cardId === best[0].cardId);
      if (!wouldSkip) continue;
      c.skips++;
      if (best[0].cardId === truth) c.right++;
      else c.wrongIds.push(job.id.slice(-6));
    }
  }

  console.log(`${n} facitmärkta skanningar\n`);
  console.log(
    `DAGENS regel (marginal ≥ ${ART_TRUST_MARGIN}): hoppar ${todaySkip}/${n}, rätt ${todaySkipRight}/${todaySkip}`
  );
  for (const c of cand) {
    console.log(
      `+ alla rutor ense, marginal ≥ ${c.margin}: hoppar ${c.skips}/${n}, rätt ${c.right}/${c.skips}` +
        (c.wrongIds.length ? `  ⛔ FEL SKIP: ${c.wrongIds.join(", ")}` : "  (100 % precision)")
    );
  }
  console.log(
    `\nEtt enda fel skip = regeln är död: hoppet visar svaret som säkert (konf 0,95) och` +
      ` ingen modell får chansen att rätta. Kravet är 100 % på facit + säkerhetsmarginal.`
  );
}

main().finally(() => prisma.$disconnect());
