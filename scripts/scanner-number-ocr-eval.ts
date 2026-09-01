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
 *   --mlkit     SKUGGLÄGET (2026-09-01): rader med `result.local` — appens
 *               on-device-läsning (ML Kit) bokförd bredvid Geminis läsning av
 *               SAMMA fångst, för ALLA användare. Ingen OCR körs här; skriptet
 *               dömer det som redan lästes, per stratum (art-avgjord / vision).
 *               Facit: userChosen (positiv dom) → Card.number, annars
 *               recall.shown[0] (skannerns svar — svagare, redovisas isär).
 *               ⛔ Beslutet "låt numret avgöra" (fas 2) tas på VISION-stratumets
 *               dom-rader — det är där ett gratis nummer sparar ett anrop.
 *               Tröskel enligt planen: ≥ ~90 % exakt där.
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

/** Nedre vänstra hörnet av remsan — där moderna kort (SV, JP) trycker numret.
 *  ⚠️ WotC-erans nummer sitter nere till HÖGER; den här beskärningen missar dem
 *  med flit i den här mätrundan (batchen är JP/SV). */
async function bottomLeft(b: Buffer, scale: number): Promise<Buffer> {
  const img = await Jimp.read(b);
  const w = Math.round(img.width * 0.45);
  const y = Math.round(img.height * 0.3);
  img.crop({ x: 0, y, w, h: img.height - y }).greyscale();
  img.resize({ w: img.width * scale, h: img.height * scale });
  return img.getBuffer("image/png");
}

const VARIANTS: Variant[] = [
  { name: "vä 45 % · 3× · block", prep: (b) => bottomLeft(b, 3), psm: PSM.SINGLE_BLOCK },
  { name: "vä 45 % · 3× · sparse", prep: (b) => bottomLeft(b, 3), psm: PSM.SPARSE_TEXT },
  { name: "vä 45 % · 4× · block", prep: (b) => bottomLeft(b, 4), psm: PSM.SINGLE_BLOCK },
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

/* ------------------------------------------------------------------ *
 * --mlkit: SKUGGLÄGET — döm appens lokala läsning mot facit och Gemini
 * ------------------------------------------------------------------ */

interface LocalRow {
  id: string;
  createdAt: Date;
  local: {
    ms?: number;
    printed?: string | null;
    num?: number | null;
    total?: number | null;
    candidates?: number;
    gemini?: string | null;
    err?: string;
    raw?: string;
  };
  src: string | null;
  shown0: string | null;
  userCard: string | null;
  kind: string | null;
}

function pctOf(n: number, of: number): string {
  return of > 0 ? `${((100 * n) / of).toFixed(1).padStart(5)} %` : "    – ";
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.round((p / 100) * (sorted.length - 1))))];
}

async function runMlkit(): Promise<void> {
  const rows = await prisma.$queryRawUnsafe<LocalRow[]>(
    `select id, "createdAt", result->'local' as local, result->'recall'->>'src' as src,
            result->'recall'->'shown'->>0 as "shown0",
            result->'userChosen'->>'cardId' as "userCard", result->'userChosen'->>'kind' as kind
       from "ScannerJob" where result ? 'local' order by "createdAt" desc limit 5000`
  );
  console.log(`mlkit: ${rows.length} rader med result.local`);
  if (rows.length === 0) {
    console.log("Inga rader ännu — appen måste vara byggd med pluginet (Android: cap sync + nytt bygge; iOS: kräver CocoaPods).");
    return;
  }
  const dagar = new Map<string, number>();
  for (const r of rows) {
    const d = r.createdAt.toISOString().slice(0, 10);
    dagar.set(d, (dagar.get(d) ?? 0) + 1);
  }
  console.log("  per dygn: " + [...dagar.entries()].sort().map(([d, n]) => `${d} ${n}`).join(" · "));

  const ids = new Set<string>();
  for (const r of rows) {
    if (r.userCard) ids.add(r.userCard);
    if (r.shown0) ids.add(r.shown0);
  }
  const cards = ids.size
    ? await prisma.card.findMany({ where: { id: { in: [...ids] } }, select: { id: true, number: true } })
    : [];
  const numberOf = new Map(cards.map((c) => [c.id, c.number]));

  type Strat = "art" | "vision";
  interface Cell {
    n: number;
    dom: number;
    localExact: number;
    localNone: number;
    localErr: number;
    multi: number;
    geminiN: number;
    geminiExact: number;
    both: number;
    onlyLocal: number;
    onlyGemini: number;
    neither: number;
  }
  const cell = (): Cell => ({ n: 0, dom: 0, localExact: 0, localNone: 0, localErr: 0, multi: 0, geminiN: 0, geminiExact: 0, both: 0, onlyLocal: 0, onlyGemini: 0, neither: 0 });
  const per: Record<Strat, Cell> = { art: cell(), vision: cell() };
  const perDom: Record<Strat, Cell> = { art: cell(), vision: cell() };
  const ms: number[] = [];
  const errs = new Map<string, number>();
  let utanFacit = 0;
  const misses: string[] = [];

  for (const r of rows) {
    const strat: Strat = r.src === "art" ? "art" : "vision";
    const positiv = r.kind === "corrected" || r.kind === "confirmed";
    const fromDom = positiv && r.userCard ? numberOf.get(r.userCard) : undefined;
    const truth = fromDom ?? (r.shown0 ? numberOf.get(r.shown0) : undefined);
    if (typeof r.local.ms === "number") ms.push(r.local.ms);
    if (r.local.err) errs.set(r.local.err, (errs.get(r.local.err) ?? 0) + 1);
    if (!truth) {
      utanFacit++;
      continue;
    }
    const targets = fromDom ? [per[strat], perDom[strat]] : [per[strat]];
    const localExact = r.local.printed ? judge([{ num: r.local.printed, total: null }], truth).exact : false;
    const hasGemini = "gemini" in r.local && r.local.gemini !== undefined;
    const geminiExact = hasGemini && r.local.gemini ? judge(extractNumbers(r.local.gemini), truth).exact : false;
    for (const c of targets) {
      c.n++;
      if (fromDom) c.dom++;
      if (localExact) c.localExact++;
      if (!r.local.printed && !r.local.err) c.localNone++;
      if (r.local.err) c.localErr++;
      if ((r.local.candidates ?? 0) > 1) c.multi++;
      if (hasGemini) {
        c.geminiN++;
        if (geminiExact) c.geminiExact++;
        if (localExact && geminiExact) c.both++;
        else if (localExact) c.onlyLocal++;
        else if (geminiExact) c.onlyGemini++;
        else c.neither++;
      }
    }
    if (!localExact && misses.length < 40) {
      misses.push(
        `  ${r.id} [${strat}${fromDom ? ", dom" : ""}] facit ${truth} → lokal ${r.local.printed ?? (r.local.err ? `FEL:${r.local.err}` : "–")}` +
          (hasGemini ? ` · gemini ${r.local.gemini ?? "–"}` : "") +
          (r.local.raw ? ` · raw "${r.local.raw.replace(/\s+/g, " ").slice(0, 80)}"` : "")
      );
    }
  }

  const skriv = (rubrik: string, c: Cell) => {
    console.log(`\n--- ${rubrik} (n=${c.n}, varav med dom ${c.dom}) ---`);
    if (c.n === 0) return;
    console.log(`  LOKAL exakt          : ${String(c.localExact).padStart(4)}  ${pctOf(c.localExact, c.n)}`);
    console.log(`  LOKAL läste inget    : ${String(c.localNone).padStart(4)}  ${pctOf(c.localNone, c.n)}`);
    console.log(`  LOKAL fel/timeout    : ${String(c.localErr).padStart(4)}  ${pctOf(c.localErr, c.n)}`);
    console.log(`  LOKAL >1 kandidat    : ${String(c.multi).padStart(4)}  ${pctOf(c.multi, c.n)}`);
    if (c.geminiN > 0) {
      console.log(`  GEMINI exakt (samma fångster, n=${c.geminiN}): ${String(c.geminiExact).padStart(4)}  ${pctOf(c.geminiExact, c.geminiN)}`);
      console.log(
        `  båda rätt ${c.both} · bara lokal ${c.onlyLocal} · bara Gemini ${c.onlyGemini} · ingen ${c.neither}` +
          `   ⇒ lokal+Gemini tillsammans ${pctOf(c.both + c.onlyLocal + c.onlyGemini, c.geminiN)}`
      );
    }
  };
  console.log("\n" + "=".repeat(78));
  console.log(`FACIT: userChosen (positiv dom) → Card.number, annars shown[0]. ${utanFacit} rader utan facit hoppas över.`);
  skriv("VISION-STRATUMET — det som avgör fas 2 (alla facit)", per.vision);
  skriv("VISION-STRATUMET — bara rader med DOM (starkare facit)", perDom.vision);
  skriv("ART-AVGJORDA — kontroll (facit = bildens etta, Gemini kördes inte)", per.art);
  skriv("ART-AVGJORDA — bara rader med DOM", perDom.art);
  const s = [...ms].sort((a, b) => a - b);
  console.log(
    `\nTID PÅ ENHETEN (ms, n=${s.length}): p10 ${percentile(s, 10)} · median ${percentile(s, 50)} · p90 ${percentile(s, 90)} · max ${s[s.length - 1] ?? "–"}`
  );
  if (errs.size) console.log(`FEL: ${[...errs.entries()].map(([k, v]) => `${k} ${v}`).join(" · ")}`);
  console.log(
    `\n⛔ Fas 2-grinden går på VISION-stratumets rader (helst med dom): där sparar ett\n` +
      `   rätt läst nummer ett Gemini-anrop. Art-stratumets facit är bildens egen etta\n` +
      `   (100 % per konstruktion) — det mäter läsningen, inte skannern.\n` +
      `⚠️ "bara lokal"-raderna är de där numret hade RÄTTAT Gemini; "bara Gemini" är\n` +
      `   priset för att slippa anropet. Läs båda innan fas 2 byggs.`
  );
  console.log("=".repeat(78));
  if (misses.length) {
    console.log(`\nMISSAR (${misses.length} visade):`);
    for (const m of misses) console.log(m);
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--mlkit")) {
    await runMlkit();
    return;
  }
  const mode = args.includes("--field") ? "field" : args.includes("--catalog") ? "catalog" : null;
  if (!mode) throw new Error("ange --field, --catalog N eller --mlkit");
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
