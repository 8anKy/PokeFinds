/**
 * VAL-REPLAY — kör de facitmärkta skanningarna genom HELA matchningsvägen
 * (bildsökning + lagrat modellsvar → matchCards) med DAGENS kod, och jämför
 * mot det val produktionen faktiskt gjorde OCH mot facit.
 *
 * Det är verifieringen för varje ändring i matchningslogiken (t.ex.
 * omtryckssyskon-tie-breaken): en ändring ska FIXA kända missar utan att
 * bryta kända träffar — och det syns här, per skanning, innan ship.
 *
 * Skillnad mot scanner-replay.ts: den replayar bara BILDsökningen; det här
 * skriptet replayar även poängsättningen och slutvalet (matchCards), med det
 * lagrade modellsvaret som text-signal — precis som produktionen gjorde.
 * Vision-anropet görs ALDRIG om (svaret är lagrat), så replayen är gratis.
 *
 *   node scripts/with-prod-db.mjs npx tsx scripts/scanner-choice-replay.ts
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { Prisma, PrismaClient } from "@prisma/client";
import { FINGERPRINT_BYTES, STRUCT_BYTES } from "../src/lib/art-fingerprint";
import { type ArtQuery, searchByFramesDetailed } from "../src/services/scanner/art-index";
import { artConfidentFrom, matchCards } from "../src/services/scanner/index";

const prisma = new PrismaClient();
const LABELS_PATH = path.join(__dirname, "scanner-labels.json");

interface Diag {
  v?: number;
  provider?: string;
  guessedName?: string | null;
  guessedNumber?: string | null;
  guessedEra?: string | null;
  guessedHp?: number | null;
  confidence?: number;
  chosen?: { cardId?: string; name: string; number: string; setName: string } | null;
  frames?: string[][];
  structFrames?: string[][];
  fingerprints?: string[];
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

  // PER LEVERANTÖR. Facitsetet lagrar modellens SVAR, inte bilden — så när
  // OCR_PROVIDER byts blandas två modellers svar i samma set och en enda
  // totalsiffra döljer vilken som presterade vad. `provider` finns på varje
  // rad; filtrera med PROVIDER=claude|gemini för att jämföra rent.
  const only = process.env.PROVIDER;
  const perProvider = new Map<string, { n: number; prod: number; now: number }>();
  let n = 0;
  let prodRight = 0;
  let nowRight = 0;
  const fixed: string[] = [];
  const broken: string[] = [];
  const stillWrong: string[] = [];

  for (const job of jobs) {
    const d = job.result as Diag;
    if (d?.v !== 1) continue;
    const truth = labels[job.id].truth as string;
    const provider = d.provider ?? "okand";
    if (only && provider !== only) continue;
    const frames = decodeFrames(d);
    if (frames.length === 0) continue;
    n++;

    // Samma väg som identifyCard: bildsökning → trust-regel (DELAD dom,
    // artConfidentFrom) → matchCards med (vid hoppad vision) TOM text, annars
    // det lagrade modellsvaret.
    const { best: artMatches, frameTops } = await searchByFramesDetailed(frames, 15);
    const artScores = new Map(artMatches.map((m) => [m.cardId, m.score]));
    const artConfidentCardId = artConfidentFrom(artMatches, frameTops);
    const skipVision = artConfidentCardId !== null;
    const ocr = skipVision
      ? { rawText: "", confidence: 0.95 }
      : {
          rawText: d.guessedName ?? "",
          guessedName: d.guessedName ?? undefined,
          guessedNumber: d.guessedNumber ?? undefined,
          guessedEra: d.guessedEra ?? undefined,
          guessedHp: d.guessedHp ?? undefined,
          confidence: d.confidence ?? 0,
        };
    const candidates = await matchCards(ocr, artScores, artConfidentCardId);
    const top = candidates[0];

    const wasRight = d.chosen?.cardId === truth;
    const isRight = top?.cardId === truth;
    if (wasRight) prodRight++;
    if (isRight) nowRight++;
    const agg = perProvider.get(provider) ?? { n: 0, prod: 0, now: 0 };
    agg.n++;
    if (wasRight) agg.prod++;
    if (isRight) agg.now++;
    perProvider.set(provider, agg);
    if (!wasRight && isRight) fixed.push(job.id.slice(-6));
    if (wasRight && !isRight) broken.push(job.id.slice(-6));
    // KVARSTÅENDE missar listas alltid: "vad är fortfarande fel" är hela frågan
    // verktyget finns för, och utan listan syns bara de fall som RÖRDE SIG av
    // den senaste ändringen.
    if (!isRight) {
      const t = await prisma.card.findUnique({
        where: { id: truth },
        select: { name: true, number: true, set: { select: { name: true } } },
      });
      stillWrong.push(
        `${job.id.slice(-6)}  ${provider.padEnd(7)} facit: ${t?.name} ${t?.number} (${t?.set.name})` +
          `  →  ${top ? `${top.name} ${top.number} (${top.setName})` : "—"}` +
          `  modell läste: "${d.guessedName ?? ""}"/"${d.guessedNumber ?? ""}"`
      );
    }
    if (wasRight !== isRight) {
      const t = await prisma.card.findUnique({
        where: { id: truth },
        select: { name: true, number: true, set: { select: { name: true } } },
      });
      console.log(
        `${job.id.slice(-6)}  ${isRight ? "FIXAD ✔" : "BRUTEN ✘"}  facit: ${t?.name} ${t?.number} (${t?.set.name})` +
          `  prod valde: ${d.chosen?.name} ${d.chosen?.number}  nu: ${top ? `${top.name} ${top.number} (${top.setName})` : "—"}`
      );
    }
  }

  console.log(`\n--- ${n} facitmärkta skanningar replayade genom matchCards ---`);
  console.log(`prod-valet rätt:  ${prodRight}/${n}`);
  console.log(`dagens kod rätt:  ${nowRight}/${n}`);
  for (const [prov, a] of [...perProvider.entries()].sort()) {
    console.log(`  ${prov.padEnd(8)} ${a.now}/${a.n} rätt (produktionen valde ${a.prod}/${a.n})`);
  }
  console.log(`fixade: ${fixed.length ? fixed.join(", ") : "—"}`);
  console.log(`brutna: ${broken.length ? broken.join(", ") : "—"}`);
  if (stillWrong.length) {
    console.log(`
--- ${stillWrong.length} KVARSTÅENDE missar ---`);
    for (const line of stillWrong) console.log(line);
  }
}

main().finally(() => prisma.$disconnect());
