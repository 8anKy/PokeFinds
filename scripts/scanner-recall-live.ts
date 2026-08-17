/**
 * KONST-RECALL I PRODUKTION — samma fråga som scanner-art-recall.ts, men med
 * RIKTIGA användares bekräftelser som facit i stället för ägarens etikettfil.
 *
 *   node scripts/with-prod-db.mjs npx tsx scripts/scanner-recall-live.ts
 *   DAGAR=7 node scripts/with-prod-db.mjs npx tsx scripts/scanner-recall-live.ts
 *
 * Frågan: skulle en BILD-FÖRST-skanner (inget vision-anrop, användaren väljer
 * ur en kort lista) hitta kortet? Underlaget skrivs sedan 2026-08-15 av
 * `recordScanUsage` (`result.recall`) + `/api/scanner/feedback`
 * (`result.userChosen`) — för ALLA användare, inte bara admin.
 *
 * ⛔ **KORRIGERING OCH BEKRÄFTELSE FÅR ALDRIG SLÅS IHOP TILL ETT TAL.**
 *    En BEKRÄFTELSE (användaren tog vårt förslag) är svag och partisk till vår
 *    fördel — den finns bara när vi redan hade rätt på plats 1. En KORRIGERING
 *    (användaren valde något annat) är starkt facit OCH anrikad med de svåra
 *    fallen. Ett medelvärde av de två mäter blandningen, inte skannern.
 *
 * ⛔ **`art` ÄR MÅTTET, `shown` ÄR KONTROLLEN.** `art` = bildsökningens egen
 *    topplista (vad en bild-först-skanner hade visat). `shown` = listan
 *    användaren faktiskt fick, där texten redan vägts in. Ligger kortet i
 *    `shown` men inte i `art` betyder det att vision bar träffen — precis den
 *    andel som INTE blir gratis.
 *
 * ⚠️ **ÖVERLEVNADSBIAS — LÄS TALET MED DEN I HANDEN.** En användare som inte
 *    hittar sitt kort i listan ger upp eller söker manuellt, och då skrivs
 *    ingen `userChosen` alls. De raderna är osynliga här, vilket lyfter recall.
 *    Talet är alltså fortfarande ett TAK, om än ett mycket ärligare än
 *    facitfilens (ägarens egna omsorgsfulla fångster). Vill man stänga hålet
 *    måste även manuella sökträffar rapporteras in.
 *
 * Läser bara. Inga API-anrop.
 */
import { Prisma, PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const DAYS = Number(process.env.DAGAR ?? "30");

interface Recall {
  v?: number;
  art?: string[];
  shown?: string[];
  /**
   * Vilken väg skrev raden. Saknas = enkelskanning (/api/scanner/identify),
   * vilket är vad ALLA rader före 2026-08-18 är.
   *
   * ⛔ **"bulk" FÅR ALDRIG SUMMERAS MED ENKELSKANNINGARNA.** `identifyCellsArt`
   * bokför bara celler där `artConfidentFrom` redan sagt ja, så bildens topp-1
   * är rätt svar PER KONSTRUKTION. Hinken är alltså grindad på exakt det måttet
   * den skulle mäta, och en sammanslagning drar topp-1 mot 100 % utan att
   * skannern blivit bättre. Den redovisas separat, som kontroll — inte som
   * resultat.
   */
  src?: "bulk";
}

interface UserChosen {
  cardId?: string;
  kind?: "corrected" | "confirmed";
}

interface Bucket {
  n: number;
  /** Rang i listan (1-baserad); 0 = utanför listan. */
  artRanks: number[];
  shownRanks: number[];
}

function emptyBucket(): Bucket {
  return { n: 0, artRanks: [], shownRanks: [] };
}

function atOrBetter(ranks: number[], k: number): number {
  return ranks.filter((r) => r > 0 && r <= k).length;
}

function report(title: string, b: Bucket): void {
  if (b.n === 0) {
    console.log(`\n--- ${title}: inga rader ---`);
    return;
  }
  const pct = (v: number) => `${((v / b.n) * 100).toFixed(1)} %`;
  console.log(`\n--- ${title} (n=${b.n}) ---`);
  console.log(`  BILDEN ENSAM (art):`);
  for (const k of [1, 3, 5, 15]) {
    console.log(`    topp-${String(k).padEnd(2)} : ${String(atOrBetter(b.artRanks, k)).padStart(4)}  ${pct(atOrBetter(b.artRanks, k))}`);
  }
  const outside = b.artRanks.filter((r) => r === 0).length;
  console.log(`    utanför : ${String(outside).padStart(4)}  ${pct(outside)}`);
  console.log(`  LISTAN SOM VISADES (shown, bild+text):`);
  for (const k of [1, 3]) {
    console.log(`    topp-${String(k).padEnd(2)} : ${String(atOrBetter(b.shownRanks, k)).padStart(4)}  ${pct(atOrBetter(b.shownRanks, k))}`);
  }
  // Den enda siffra som säger vad vision FAKTISKT bidrog med: kortet fanns i
  // den visade listan men inte i bildens. Allt annat hade bilden klarat själv.
  const visionCarried = b.artRanks.filter((r, i) => r === 0 && b.shownRanks[i] > 0).length;
  console.log(`  VISION BAR TRÄFFEN (i shown, ej i art): ${visionCarried}  ${pct(visionCarried)}`);
}

async function main() {
  const since = new Date(Date.now() - DAYS * 24 * 60 * 60 * 1000);
  const jobs = await prisma.scannerJob.findMany({
    where: {
      createdAt: { gte: since },
      status: { not: "FAILED" },
      NOT: { result: { equals: Prisma.DbNull } },
    },
    select: { id: true, userId: true, result: true },
  });

  const corrected = emptyBucket();
  const confirmed = emptyBucket();
  // Bulk hålls i EGNA hinkar — se `Recall.src`. Aldrig summerade med ovan.
  const bulkCorrected = emptyBucket();
  const bulkConfirmed = emptyBucket();
  let withRecall = 0;
  let withoutChoice = 0;
  let bulkRows = 0;
  const users = new Set<string>();

  for (const job of jobs) {
    const r = job.result as Record<string, unknown> | null;
    if (!r || typeof r !== "object") continue;
    const recall = r.recall as Recall | undefined;
    if (!recall || !Array.isArray(recall.art)) continue;
    withRecall++;
    const isBulk = recall.src === "bulk";
    if (isBulk) bulkRows++;
    const chosen = r.userChosen as UserChosen | undefined;
    if (!chosen?.cardId) {
      withoutChoice++;
      continue;
    }
    users.add(job.userId);
    const bucket =
      chosen.kind === "corrected"
        ? isBulk
          ? bulkCorrected
          : corrected
        : isBulk
          ? bulkConfirmed
          : confirmed;
    bucket.n++;
    bucket.artRanks.push(recall.art.indexOf(chosen.cardId) + 1);
    bucket.shownRanks.push((recall.shown ?? []).indexOf(chosen.cardId) + 1);
  }

  console.log(`\n=== KONST-RECALL, PRODUKTION (${DAYS} dygn) ===`);
  console.log(`Skanningar med mätdata : ${withRecall}`);
  console.log(`  varav utan användarval: ${withoutChoice}  (ingen bekräftelse — se överlevnadsbias i filhuvudet)`);
  console.log(`  varav bulk (egen hink): ${bulkRows}  (grindad på svaret — redovisas separat, aldrig summerad)`);
  console.log(`Distinkta användare    : ${users.size}`);

  if (withRecall === 0) {
    console.log(
      `\nInga rader ännu. Mätdatat skrivs från och med deployen 2026-08-15 —\n` +
        `kör om när riktiga skanningar hunnit ske.`
    );
    return;
  }

  // KORRIGERINGAR FÖRST: det är det starka facit:et, och det är också den
  // klass som avgör om designen håller. Bekräftelser är partiska till vår
  // fördel och står under, aldrig hopslagna.
  report("KORRIGERADE — starkt facit, anrikat med svåra fall", corrected);
  report("BEKRÄFTADE — svagt facit, partiskt till vår fördel", confirmed);

  const all: Bucket = {
    n: corrected.n + confirmed.n,
    artRanks: [...corrected.artRanks, ...confirmed.artRanks],
    shownRanks: [...corrected.shownRanks, ...confirmed.shownRanks],
  };
  report("ALLA ENKELSKANNINGAR (blandningsberoende — läs de två ovan i stället)", all);

  // BULK SIST OCH MÄRKT. Hinken kan inte jämföras med ovanstående: raderna
  // finns bara när bildmatchningen redan var säker, så ett högt tal här säger
  // ingenting om recall — det säger att grinden fungerar som den ska.
  if (bulkCorrected.n + bulkConfirmed.n > 0) {
    console.log(
      `\n\n########## BULK — KONTROLLHINK, INTE ETT RESULTAT ##########\n` +
        `Raderna bokförs bara när bilden REDAN var säker (artConfidentFrom).\n` +
        `Topp-1 nära 100 % är därför väntat och betyder inget om träffsäkerhet.\n` +
        `Det som ÄR intressant: varje KORRIGERING här är en trust-regel som föll.`
    );
    report("BULK, korrigerade — trust-regeln hade FEL", bulkCorrected);
    report("BULK, bekräftade — trust-regeln hade rätt", bulkConfirmed);
    const precision =
      bulkCorrected.n + bulkConfirmed.n > 0
        ? (bulkConfirmed.n / (bulkCorrected.n + bulkConfirmed.n)) * 100
        : 0;
    console.log(
      `\n  TRUST-PRECISION I FÄLT: ${bulkConfirmed.n}/${bulkCorrected.n + bulkConfirmed.n}` +
        ` = ${precision.toFixed(1)} %  (offline-mätningen 2026-07-30 gav 100 %, n=40)`
    );
  }

  console.log(
    `\nGRINDEN: bygg bild-först om KORRIGERADE topp-3 håller ≥ 95 % — ENKELSKANNINGAR.\n` +
      `Facitfilen (ägarens fångster) gav 98,0 % — se scripts/scanner-art-recall.ts.\n` +
      `⚠️ Mätt 2026-08-17 på riktiga användare: BEKRÄFTADE topp-3 = 70,9 % (n=79),\n` +
      `   topp-15 = 79,7 %. Facitfilens 98 % reproducerades INTE — dess massa på\n` +
      `   plats 2 (32,3 %) finns inte i riktiga fångster. Korrigerade: n=1, dvs\n` +
      `   grinden går ännu inte att utvärdera.`
  );
}

main().finally(() => prisma.$disconnect());
