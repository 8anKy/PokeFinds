/**
 * SKANNER-SCOREBOARD — det ENDA facit-baserade måttet på skannerns verkliga
 * träffsäkerhet (Fas 0 i skannerplanen, 2026-07-31).
 *
 * VARFÖR: varenda siffra vi räknat fram offline (96 % topp-15, 97,1 % triw,
 * 100 % match-audit) är ett TAK — frågorna härleds ur samma filer som
 * referenserna. Litteraturens direkta parallell: perceptuella hashar når
 * MAP 0,9989–1,0000 på bit-identiska kopior och kollapsar så fort verklig
 * variation släpps in. Det här skriptet mäter i stället mot RIKTIGA fångster
 * (admin-diagnostiken i `ScannerJob.result`) med ÄGARSATT facit, och är
 * skiljedomaren för varje kommande fas: en ändring som inte flyttar de här
 * talen har inte bevisats göra nytta.
 *
 * FACIT bor i `scripts/scanner-labels.json` (incheckad: bara jobb-id, kort-id,
 * population och anteckning — aldrig bilder, aldrig hemligheter):
 *
 *   node scripts/with-prod-db.mjs npx tsx scripts/scanner-scoreboard.ts            # rapport
 *   TEMPLATE=1 node scripts/with-prod-db.mjs npx tsx scripts/scanner-scoreboard.ts # fyll på mall
 *
 * Mallen skriver in olabellade skanningar med LEDTRÅDAR (modellens svar, valt
 * kort, bildens topp-5 MED kort-id) så att märkningen är minuter, inte timmar:
 * oftast är facit ett av de listade id:na — kopiera in det i `truth`, sätt
 * `population` ("physical" = fysiskt kort framför kameran, "screen" = foto av
 * en skärm/produktbild) och kör rapporten. `truth: null` = kortet går inte att
 * fastställa ens manuellt (räknas bort, redovisas).
 *
 * SVAGA ETIKETTER: skanningar där SAMMA användare lade ett kort i samlingen
 * inom WEAK_WINDOW_MIN minuter efteråt får det kortet som svagt facit.
 * Redovisas SEPARAT och blandas aldrig in i huvudtalen — användaren kan ha
 * accepterat ett felval, så etiketten bevisar mindre än ägarens facit.
 *
 * TRE HINKAR för varje miss (olika fel → helt olika åtgärd och kostnad):
 *   VIKTNING      — bilden HADE facit i topp-15 men slutvalet föll ändå fel:
 *                   text/vikt-logiken överröstade. Fix: matchningens vikter.
 *   DESKRIPTOR    — bilden missade facit MEN var självsäkert fel (topp-poäng
 *                   ≥ trust-tröskeln): avtrycket kan inte skilja korten åt.
 *                   Fix: starkare särdrag (Fas 2/3), aldrig mer text-vikt.
 *   INFO/RAM      — bilden missade facit och allt var brus (låg topp-poäng):
 *                   antingen fanns kortet inte ordentligt i rutan (ramfel,
 *                   fixas av Fas 1-rätning) eller så FINNS informationen inte
 *                   i källan (samlarnummer ~3 px på ett skärmfoto — inget
 *                   avtryck och ingen modell kan laga det; åtgärden är UX).
 *                   Utan bilden går de två inte att skilja maskinellt — därför
 *                   EN hink, och ägarens `note` får avgöra i tveksamma fall.
 *
 * Dessutom mäts, över ALLA facitmärkta skanningar (inte bara missarna):
 *   - bild topp-1/5/15 (var facit i listan?), per population
 *   - svep-räddade: facit utanför topp-15 med ENBART plain-beskärningen men
 *     inne med hela inset+outset-svepet → populationen Fas 1-rätning ska krympa
 *   - trust-regelns VERKLIGA precision (produktionens exporterade trösklar) —
 *     regeln auto-fångar och hoppar över Haiku, så ett fel här är ett tyst fel
 *   - tröskel-tabellen (rätt vs fel: poäng median/min · marginal median/p90) —
 *     samma tabell som ursprungligen motiverade ART_TRUST_*; ändras deskriptor
 *     eller beskärning härleds trösklarna om HÄRIFRÅN, aldrig ur takmätningar.
 *
 * Läser prod, skriver BARA den lokala labels-filen (TEMPLATE=1). Resumerbart.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Prisma, PrismaClient } from "@prisma/client";
import { FINGERPRINT_BYTES, STRUCT_BYTES } from "../src/lib/art-fingerprint";
import { type ArtQuery, searchByFrames } from "../src/services/scanner/art-index";
import { ART_TRUST_MARGIN, ART_TRUST_SCORE } from "../src/services/scanner/index";

const prisma = new PrismaClient();
const TAKE = Number(process.env.TAKE ?? "200");
const WEAK_WINDOW_MIN = Number(process.env.WEAK_WINDOW_MIN ?? "15");
/** Djup för rang-mätningen. Topp-15-måttet läses ur samma lista (se not nedan). */
const RANK_DEPTH = 50;
const LABELS_PATH = path.join(__dirname, "scanner-labels.json");

interface Diag {
  v?: number;
  provider?: string;
  guessedName?: string | null;
  guessedNumber?: string | null;
  chosen?: { cardId?: string; name: string; number: string; setName: string } | null;
  frames?: string[][];
  structFrames?: string[][];
  fingerprints?: string[];
}

interface Label {
  /** Kort-id (facit), "" = omärkt, null = går inte att fastställa. */
  truth?: string | null;
  population?: "physical" | "screen";
  note?: string;
  /** Ledtrådar från mallen — bara för människan, läses aldrig av rapporten. */
  hint?: Record<string, unknown>;
}

type Labels = Record<string, Label>;

function readLabels(): Labels {
  try {
    return JSON.parse(readFileSync(LABELS_PATH, "utf8")) as Labels;
  } catch {
    return {};
  }
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

/** Samma avkodning som scanner-replay.ts — äldre rader har bara första rutans svep. */
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

function stats(xs: number[]): { median: number; min: number; max: number; p90: number } | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const q = (p: number) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return { median: q(0.5), min: s[0], max: s[s.length - 1], p90: q(0.9) };
}

async function fetchJobs() {
  const jobs = await prisma.scannerJob.findMany({
    where: { NOT: { result: { equals: Prisma.DbNull } } },
    orderBy: { createdAt: "desc" },
    take: TAKE,
    select: { id: true, userId: true, createdAt: true, result: true },
  });
  return jobs
    .map((j) => ({ id: j.id, userId: j.userId, at: j.createdAt, d: j.result as Diag }))
    .filter((r) => r.d?.v === 1);
}

/** Svag etikett: samma användare la ett kort i samlingen strax efter skanningen. */
async function weakLabelFor(userId: string, at: Date): Promise<string | null> {
  const item = await prisma.collectionItem.findFirst({
    where: {
      userId,
      cardId: { not: null },
      createdAt: { gte: at, lte: new Date(at.getTime() + WEAK_WINDOW_MIN * 60_000) },
    },
    orderBy: { createdAt: "asc" },
    select: { cardId: true },
  });
  return item?.cardId ?? null;
}

async function cardLabel(cardId: string): Promise<string> {
  const c = await prisma.card.findUnique({
    where: { id: cardId },
    select: { name: true, number: true, set: { select: { name: true } } },
  });
  return c ? `${c.name} ${c.number} (${c.set.name})` : cardId;
}

async function writeTemplate() {
  const labels = readLabels();
  const rows = await fetchJobs();
  let added = 0;
  for (const { id, at, d } of rows) {
    if (labels[id]) continue;
    const frames = decodeFrames(d);
    // Bildens topp-5 MED kort-id — facit är oftast ett av dem.
    const top = frames.length > 0 ? await searchByFrames(frames, 5) : [];
    const topLabels = await Promise.all(
      top.map(async (m) => `${m.cardId} = ${await cardLabel(m.cardId)} (${m.score.toFixed(3)})`)
    );
    labels[id] = {
      truth: "",
      population: undefined,
      note: "",
      hint: {
        at: at.toISOString(),
        modell: `${d.guessedName ?? ""} / ${d.guessedNumber ?? ""}`,
        valdes: d.chosen
          ? `${d.chosen.cardId ?? "?"} = ${d.chosen.name} ${d.chosen.number} (${d.chosen.setName})`
          : null,
        bildTopp5: topLabels,
      },
    };
    added++;
  }
  writeFileSync(LABELS_PATH, `${JSON.stringify(labels, null, 2)}\n`);
  console.log(
    `${added} nya omärkta skanningar tillagda i ${path.basename(LABELS_PATH)} — fyll i truth (kort-id ur ledtrådarna) + population ("physical"/"screen").`
  );
}

interface Scored {
  id: string;
  population: string;
  weak: boolean;
  /** Facits rang i bildens lista (1-baserad), null = utanför RANK_DEPTH. */
  rank: number | null;
  rank0: number | null;
  top1Score: number;
  margin: number | null;
  trusted: boolean;
  trustedRight: boolean | null;
  chosenRight: boolean;
  bucket: "RÄTT" | "VIKTNING" | "DESKRIPTOR" | "INFO/RAM" | "TOMT";
  note: string;
}

async function score(
  id: string,
  d: Diag,
  truth: string,
  population: string,
  weak: boolean,
  note: string
): Promise<Scored> {
  const frames = decodeFrames(d);
  const empty: Omit<Scored, "id" | "population" | "weak" | "note"> = {
    rank: null,
    rank0: null,
    top1Score: 0,
    margin: null,
    trusted: false,
    trustedRight: null,
    chosenRight: false,
    bucket: "TOMT",
  };
  if (frames.length === 0) return { id, population, weak, note, ...empty };

  // OBS: rang mäts i en RANK_DEPTH-lista. Valet av "bästa ruta" (marginal på
  // topp-2) är identiskt med produktionens k=15-anrop; per-variant-djupet är
  // 2×k, så listans SVANS kan avvika marginellt från produktionens topp-15.
  const matches = await searchByFrames(frames, RANK_DEPTH);
  const plain = await searchByFrames(
    frames.map((f) => [f[0]]),
    RANK_DEPTH
  );
  const idx = matches.findIndex((m) => m.cardId === truth);
  const idx0 = plain.findIndex((m) => m.cardId === truth);
  const rank = idx >= 0 ? idx + 1 : null;
  const rank0 = idx0 >= 0 ? idx0 + 1 : null;
  const top1Score = matches[0]?.score ?? 0;
  const margin = matches.length >= 2 ? matches[0].score - matches[1].score : null;
  const trusted = top1Score >= ART_TRUST_SCORE && (margin ?? 0) >= ART_TRUST_MARGIN;
  const trustedRight = trusted ? matches[0].cardId === truth : null;
  const chosenRight = d.chosen?.cardId ? d.chosen.cardId === truth : false;

  let bucket: Scored["bucket"];
  if (chosenRight) bucket = "RÄTT";
  else if (rank !== null && rank <= 15) bucket = "VIKTNING";
  else if (top1Score >= ART_TRUST_SCORE) bucket = "DESKRIPTOR";
  else bucket = "INFO/RAM";

  return {
    id,
    population,
    weak,
    note,
    rank,
    rank0,
    top1Score,
    margin,
    trusted,
    trustedRight,
    chosenRight,
    bucket,
  };
}

function pct(n: number, of: number): string {
  return of > 0 ? `${((100 * n) / of).toFixed(1)} % (${n}/${of})` : "–";
}

function report(rows: Scored[], title: string) {
  const withArt = rows.filter((r) => r.bucket !== "TOMT");
  if (withArt.length === 0) {
    console.log(`\n=== ${title}: inga facitmärkta skanningar med avtryck ===`);
    return;
  }
  console.log(`\n=== ${title} — ${withArt.length} skanningar ===`);
  const inTop = (k: number) => withArt.filter((r) => r.rank !== null && r.rank <= k).length;
  console.log(`bild topp-1:  ${pct(inTop(1), withArt.length)}`);
  console.log(`bild topp-5:  ${pct(inTop(5), withArt.length)}`);
  console.log(`bild topp-15: ${pct(inTop(15), withArt.length)}`);
  console.log(`slutval rätt: ${pct(withArt.filter((r) => r.chosenRight).length, withArt.length)}`);
  const rescued = withArt.filter(
    (r) => r.rank !== null && r.rank <= 15 && !(r.rank0 !== null && r.rank0 <= 15)
  ).length;
  console.log(`svep-räddade (plain missar, svepet hittar): ${pct(rescued, withArt.length)}`);

  const trusted = withArt.filter((r) => r.trusted);
  const trustedRight = trusted.filter((r) => r.trustedRight === true);
  console.log(
    `trust-regeln (poäng ≥ ${ART_TRUST_SCORE}, marginal ≥ ${ART_TRUST_MARGIN}): utlöst ${trusted.length}/${withArt.length}, precision ${pct(trustedRight.length, trusted.length)}`
  );

  // Tröskel-tabellen: samma form som motiverade ART_TRUST_* från början.
  const right = withArt.filter((r) => r.rank === 1);
  const wrong = withArt.filter((r) => r.rank !== 1);
  for (const [label, set] of [
    ["topp-1 RÄTT", right],
    ["topp-1 FEL ", wrong],
  ] as const) {
    const sc = stats(set.map((r) => r.top1Score));
    const mg = stats(set.map((r) => r.margin).filter((m): m is number => m !== null));
    console.log(
      `${label}: n=${set.length}` +
        (sc ? `  poäng median ${sc.median.toFixed(3)} min ${sc.min.toFixed(3)} max ${sc.max.toFixed(3)}` : "") +
        (mg ? `  marginal median ${mg.median.toFixed(3)} p90 ${mg.p90.toFixed(3)} max ${mg.max.toFixed(3)}` : "")
    );
  }

  const buckets = new Map<string, Scored[]>();
  for (const r of withArt.filter((x) => !x.chosenRight)) {
    buckets.set(r.bucket, [...(buckets.get(r.bucket) ?? []), r]);
  }
  if (buckets.size > 0) {
    console.log(`missar per hink:`);
    for (const [bucket, list] of buckets) {
      console.log(`  ${bucket.padEnd(11)} ${list.length} st  (${list.map((r) => r.id.slice(-6)).join(", ")})`);
    }
  }
}

async function main() {
  if (process.env.TEMPLATE === "1") {
    await writeTemplate();
    return;
  }

  const labels = readLabels();
  const rows = await fetchJobs();
  const scored: Scored[] = [];
  let unlabeled = 0;
  let unresolvable = 0;

  for (const { id, userId, at, d } of rows) {
    const label = labels[id];
    if (label?.truth === null) {
      unresolvable++;
      continue;
    }
    if (label?.truth) {
      scored.push(
        await score(id, d, label.truth, label.population ?? "okänd", false, label.note ?? "")
      );
      continue;
    }
    // Ingen ägaretikett — prova svag etikett ur samlings-tillägget.
    const weak = await weakLabelFor(userId, at);
    if (weak) scored.push(await score(id, d, weak, label?.population ?? "okänd", true, ""));
    else unlabeled++;
  }

  const strong = scored.filter((r) => !r.weak);
  const weak = scored.filter((r) => r.weak);

  report(strong, "ÄGARENS FACIT — huvudtal");
  for (const pop of [...new Set(strong.map((r) => r.population))]) {
    if (strong.length > 0 && pop !== "okänd") {
      report(strong.filter((r) => r.population === pop), `population: ${pop}`);
    }
  }
  report(weak, "SVAGA ETIKETTER (samlings-tillägg, redovisas separat)");

  console.log(
    `\n${unlabeled} skanningar utan facit (kör TEMPLATE=1 och fyll i), ${unresolvable} markerade ofastställbara.`
  );
  const missingPop = strong.filter((r) => r.population === "okänd").length;
  if (missingPop > 0) {
    console.log(`⚠ ${missingPop} facitmärkta saknar population — sätt "physical"/"screen" för per-populations-talen.`);
  }
}

main().finally(() => prisma.$disconnect());
