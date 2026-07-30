/**
 * SKANNER-REPLAY — spelar upp RIKTIGA skanningars konstavtryck mot indexet.
 *
 * VARFÖR: alla offline-mätningar (scripts/art-audit/) härleder frågorna ur samma
 * filer som referenserna, så deras siffror är TAK — de kan inte visa vad en
 * verklig fångst (skärmfoto, moiré, handhållen kamera) gör. Admin-diagnostiken
 * sparar varje skannings avtryck (264 byte/variant, aldrig bilden), och det här
 * skriptet kör dem genom SAMMA sökväg som produktionen (`searchByFrames`).
 *
 * ANVÄNDNING: ändra en vikt/tröskel i art-index/matchningen → kör replayen →
 * se om bildens topplista på de verkliga fångsterna blev bättre eller sämre.
 * Utan detta är varje justering en gissning som kräver nya manuella skanningar.
 *
 * Läser bara — skriver ingenting. Kör mot prod (indexet + diagnostiken bor där):
 *
 *   node scripts/with-prod-db.mjs npx tsx scripts/scanner-replay.ts
 *   TAKE=60 …    # fler skanningar
 */
import { Prisma, PrismaClient } from "@prisma/client";
import { FINGERPRINT_BYTES, STRUCT_BYTES } from "../src/lib/art-fingerprint";
import { type ArtQuery, searchByFrames } from "../src/services/scanner/art-index";

const prisma = new PrismaClient();
const TAKE = Number(process.env.TAKE ?? "40");
const TOP = Number(process.env.TOP ?? "5");

interface Diag {
  v?: number;
  guessedName?: string | null;
  guessedNumber?: string | null;
  chosen?: { name: string; number: string; setName: string } | null;
  /** Nya rader: alla rutors inset-svep (+ ev. strukturrutor, positionsparade). */
  frames?: string[][];
  structFrames?: string[][];
  /** Äldre rader: bara första rutans svep. */
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
  const jobs = await prisma.scannerJob.findMany({
    where: { NOT: { result: { equals: Prisma.DbNull } } },
    orderBy: { createdAt: "desc" },
    take: TAKE,
    select: { createdAt: true, result: true },
  });
  const rows = jobs
    .map((j) => ({ at: j.createdAt, d: j.result as Diag }))
    .filter((r) => r.d?.v === 1);

  let replayed = 0;
  let confident = 0;
  const margins: number[] = [];

  for (const { at, d } of rows) {
    const frames = decodeFrames(d);
    if (frames.length === 0) continue;
    replayed++;

    const matches = await searchByFrames(frames, TOP);
    const cards = await prisma.card.findMany({
      where: { id: { in: matches.map((m) => m.cardId) } },
      select: { id: true, name: true, number: true, set: { select: { name: true } } },
    });
    const byId = new Map(cards.map((c) => [c.id, c]));
    const margin = matches.length >= 2 ? matches[0].score - matches[1].score : null;
    if (margin != null) margins.push(margin);
    const isConfident = (matches[0]?.score ?? 0) >= 0.7 && (margin ?? 0) >= 0.1;
    if (isConfident) confident++;

    console.log(
      `${at.toISOString().slice(0, 19).replace("T", " ")}  ` +
        `modell "${d.guessedName ?? ""}" / "${d.guessedNumber ?? ""}"  ` +
        `valdes: ${d.chosen ? `${d.chosen.name} ${d.chosen.number} (${d.chosen.setName})` : "—"}` +
        `${isConfident ? "  [bild SÄKER]" : ""}`
    );
    for (const m of matches) {
      const c = byId.get(m.cardId);
      console.log(
        `    ${m.score.toFixed(3)}  ${c ? `${c.name} ${c.number} (${c.set.name})` : m.cardId}`
      );
    }
  }

  if (replayed === 0) {
    console.log("Inga avtryck att spela upp — skanna som admin först.");
    return;
  }
  const s = [...margins].sort((a, b) => a - b);
  console.log(`\n--- ${replayed} skanningar replayade ---`);
  console.log(`bild SÄKER (≥0.70 poäng, ≥0.10 marginal): ${confident}/${replayed}`);
  if (s.length > 0) {
    console.log(
      `marginal: min ${s[0].toFixed(3)} · median ${s[Math.floor(s.length / 2)].toFixed(3)} · max ${s[s.length - 1].toFixed(3)}`
    );
  }
}

main().finally(() => prisma.$disconnect());
