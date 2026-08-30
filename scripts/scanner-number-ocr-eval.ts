/**
 * KAN EN GRATIS LOKAL OCR LÄSA SAMLARNUMRET? — mätharness (2026-08-30, ägarbeslut).
 *
 * Målet är en skanner utan vision-anrop. Numret är kortets identitet
 * (.claude/rules/scanner.md), så en tillförlitlig GRATIS läsning av
 * nummerremsan ersätter det mesta Gemini gör i dag: bilden ger konsten,
 * numret skiljer omtryck och samma-konst-tvillingar.
 *
 * ⛔ DIAGNOSTIK FÖRE TUNING (project_bulk_detector_field_round_3): det här
 * skriptet MÄTER, det bygger inget. Först när läsgraden på RIKTIGA fångster
 * är känd finns ett beslut att fatta.
 *
 * TVÅ LÄGEN:
 *   --field     Admin-rader i prod med `result.strip` (nummerremsan, skrivs
 *               bara för admin sedan 2026-08-30). Facit i styrkeordning:
 *               userChosen.cardId → Card.number (dom), annars chosen.number
 *               (skannerns eget svar — svagare, redovisas separat).
 *               Kräver `node scripts/with-prod-db.mjs`.
 *   --catalog N N slumpade kort ur katalogen: bilden hämtas, nederkanten
 *               (STRIP_FRACTION = 0,22, samma som klienten) skärs ut. Det är
 *               ett TAK (ren rendering, inget kameraljus) och validerar
 *               rörledningen — aldrig ett fälttal.
 *
 * Varje remsa körs genom några förbehandlingar (rå · gråskala+2× · gråskala+
 * 2×+tröskel) och två segmenteringslägen; per remsa räknas den bästa varianten
 * OCH varje variant för sig, så valet av förbehandling blir en avläsning.
 *
 *   node scripts/with-prod-db.mjs npx tsx scripts/scanner-number-ocr-eval.ts --field
 *   node scripts/with-prod-db.mjs npx tsx scripts/scanner-number-ocr-eval.ts --catalog 30
 *
 * Språkdata (eng, ~4 MB) laddas ner en gång till .cache/tessdata.
 */
import "dotenv/config";
import path from "node:path";
import { Jimp } from "jimp";
import { PrismaClient } from "@prisma/client";
import { createWorker, OEM, PSM, type Worker } from "tesseract.js";
import { parseCardNumber } from "../src/lib/card-number-order";

const prisma = new PrismaClient();
const STRIP_FRACTION = 0.22;
const CACHE = path.join(__dirname, "..", ".cache", "tessdata");

interface Sample {
  id: string;
  strip: Buffer;
  truth: string; // Card.number
  truthStrength: "dom" | "skanner" | "katalog";
  geminiRead: string | null; // guessedNumber, jämförelsen
}

type Variant = { name: string; prep: (b: Buffer) => Promise<Buffer>; psm: PSM };

const VARIANTS: Variant[] = [
  { name: "rå · block", prep: async (b) => b, psm: PSM.SINGLE_BLOCK },
  {
    name: "grå 2× · block",
    prep: async (b) => {
      const img = await Jimp.read(b);
      img.greyscale().resize({ w: img.width * 2, h: img.height * 2 });
      return img.getBuffer("image/png");
    },
    psm: PSM.SINGLE_BLOCK,
  },
  {
    name: "grå 2× · rad",
    prep: async (b) => {
      const img = await Jimp.read(b);
      img.greyscale().resize({ w: img.width * 2, h: img.height * 2 });
      return img.getBuffer("image/png");
    },
    psm: PSM.SINGLE_LINE,
  },
  {
    name: "grå 2× tröskel · block",
    prep: async (b) => {
      const img = await Jimp.read(b);
      img.greyscale().resize({ w: img.width * 2, h: img.height * 2 }).contrast(0.3).threshold({ max: 150 });
      return img.getBuffer("image/png");
    },
    psm: PSM.SINGLE_BLOCK,
  },
];

/** Alla "nnn/nnn"- och fristående siffergrupper i OCR-texten, i läsordning. */
function extractNumbers(text: string): { num: string; total: string | null }[] {
  const out: { num: string; total: string | null }[] = [];
  const re = /(\d{1,3})\s*\/\s*(\d{1,3})/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) out.push({ num: m[1], total: m[2] });
  if (out.length === 0) {
    for (const g of text.match(/\d{1,3}/g) ?? []) out.push({ num: g, total: null });
  }
  return out;
}

function numKey(raw: string): string {
  const { prefix, num, suffix } = parseCardNumber(raw);
  return `${prefix}${Number.isFinite(num) ? String(num) : ""}${suffix}`.toUpperCase();
}

/** Är läsningen rätt? Jämförs på NUMRET (utan ledande nollor); totalen är bonus. */
function judge(reads: { num: string; total: string | null }[], truth: string) {
  const t = numKey(truth);
  const hit = reads.find((r) => numKey(r.num) === t);
  return { any: reads.length > 0, exact: !!hit, exactFirst: reads[0] ? numKey(reads[0].num) === t : false, withTotal: !!hit?.total };
}

async function loadField(): Promise<Sample[]> {
  const rows = await prisma.$queryRawUnsafe<{ id: string; strip: string; chosen: string | null; userCard: string | null; kind: string | null; guessed: string | null }[]>(
    `select id, result->>'strip' as strip, result->'chosen'->>'number' as chosen,
            result->'userChosen'->>'cardId' as "userCard", result->'userChosen'->>'kind' as kind,
            result->>'guessedNumber' as guessed
       from "ScannerJob" where result ? 'strip' order by "createdAt" desc limit 500`
  );
  const cardIds = [...new Set(rows.map((r) => r.userCard).filter((x): x is string => !!x))];
  const cards = cardIds.length
    ? await prisma.card.findMany({ where: { id: { in: cardIds } }, select: { id: true, number: true } })
    : [];
  const numberOf = new Map(cards.map((c) => [c.id, c.number]));
  const out: Sample[] = [];
  for (const r of rows) {
    const fromDom = r.userCard && r.kind !== "rejected" && r.kind !== "searched" ? numberOf.get(r.userCard) : undefined;
    const truth = fromDom ?? r.chosen;
    if (!truth) continue;
    const b64 = r.strip.replace(/^data:image\/[a-z+.-]+;base64,/i, "");
    out.push({ id: r.id, strip: Buffer.from(b64, "base64"), truth, truthStrength: fromDom ? "dom" : "skanner", geminiRead: r.guessed });
  }
  return out;
}

async function loadCatalog(n: number): Promise<Sample[]> {
  const rows = await prisma.$queryRawUnsafe<{ id: string; number: string; imageUrl: string }[]>(
    `select id, number, "imageUrl" from "Card" where "imageUrl" is not null and language = 'EN' order by random() limit ${Math.max(1, Math.min(200, n))}`
  );
  const out: Sample[] = [];
  for (const r of rows) {
    try {
      const res = await fetch(r.imageUrl);
      if (!res.ok) continue;
      const img = await Jimp.read(Buffer.from(await res.arrayBuffer()));
      const h = Math.max(1, Math.round(img.height * STRIP_FRACTION));
      img.crop({ x: 0, y: img.height - h, w: img.width, h });
      // Klientens remsa är ~1280 px bred; en katalogbild är ofta smalare. Skala
      // upp till samma bredd så OCR:n ser samma teckenhöjd som i fält.
      if (img.width < 1280) img.resize({ w: 1280, h: Math.round((h * 1280) / img.width) });
      out.push({ id: r.id, strip: await img.getBuffer("image/jpeg", { quality: 85 }), truth: r.number, truthStrength: "katalog", geminiRead: null });
    } catch (e) {
      console.warn(`  ${r.id}: ${(e as Error).message.slice(0, 80)}`);
    }
  }
  return out;
}

async function main() {
  const args = process.argv.slice(2);
  const mode = args.includes("--field") ? "field" : args.includes("--catalog") ? "catalog" : null;
  if (!mode) throw new Error("ange --field eller --catalog N");
  const samples = mode === "field" ? await loadField() : await loadCatalog(Number(args[args.indexOf("--catalog") + 1] ?? 20));
  console.log(`${mode}: ${samples.length} remsor` + (mode === "field" ? ` (dom ${samples.filter((s) => s.truthStrength === "dom").length} · skannerns svar ${samples.filter((s) => s.truthStrength === "skanner").length})` : ""));
  if (samples.length === 0) {
    console.log(mode === "field" ? "Inga admin-rader med remsa ännu — skanna några kort som admin först." : "Inga kort.");
    return;
  }

  const worker: Worker = await createWorker("eng", OEM.LSTM_ONLY, { cachePath: CACHE });
  const per = VARIANTS.map(() => ({ any: 0, exact: 0, exactFirst: 0, withTotal: 0, ms: 0 }));
  let best = 0;
  let geminiExact = 0;
  let geminiN = 0;
  const misses: string[] = [];
  for (const s of samples) {
    let hitAny = false;
    const line: string[] = [];
    for (let i = 0; i < VARIANTS.length; i++) {
      const v = VARIANTS[i];
      const t0 = Date.now();
      const buf = await v.prep(s.strip);
      await worker.setParameters({ tessedit_pageseg_mode: v.psm, tessedit_char_whitelist: "0123456789/" });
      const { data } = await worker.recognize(buf);
      const reads = extractNumbers(data.text);
      const j = judge(reads, s.truth);
      per[i].ms += Date.now() - t0;
      if (j.any) per[i].any++;
      if (j.exact) per[i].exact++;
      if (j.exactFirst) per[i].exactFirst++;
      if (j.withTotal) per[i].withTotal++;
      hitAny ||= j.exact;
      line.push(`${v.name}: ${reads.map((r) => (r.total ? `${r.num}/${r.total}` : r.num)).join(",") || "–"}`);
    }
    if (hitAny) best++;
    else misses.push(`  ${s.id} facit ${s.truth} (${s.truthStrength}) → ${line.join(" | ")}`);
    if (s.geminiRead != null) {
      geminiN++;
      if (judge(extractNumbers(s.geminiRead), s.truth).exact) geminiExact++;
    }
  }
  await worker.terminate();

  const pct = (n: number) => `${((100 * n) / samples.length).toFixed(1).padStart(5)} %`;
  console.log("\n" + "=".repeat(78));
  console.log(`${"variant".padEnd(26)} läste något   exakt   exakt först   med total   ms/remsa`);
  VARIANTS.forEach((v, i) => {
    const p = per[i];
    console.log(`${v.name.padEnd(26)} ${pct(p.any)}   ${pct(p.exact)}   ${pct(p.exactFirst)}      ${pct(p.withTotal)}   ${Math.round(p.ms / samples.length).toString().padStart(5)}`);
  });
  console.log("-".repeat(78));
  console.log(`BÄSTA VARIANT PER REMSA (exakt i minst en):  ${best}/${samples.length} = ${pct(best)}`);
  if (geminiN > 0) console.log(`Gemini läste numret exakt (samma remsor):     ${geminiExact}/${geminiN} = ${((100 * geminiExact) / geminiN).toFixed(1)} %`);
  console.log("=".repeat(78));
  if (mode === "catalog") console.log("⚠️ Katalogläge = TAK (ren rendering). Fälttalet kommer ur --field.");
  if (misses.length) {
    console.log(`\nMISSAR (${misses.length}):`);
    for (const m of misses.slice(0, 40)) console.log(m);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
