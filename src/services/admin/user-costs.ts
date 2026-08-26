/**
 * VAD KOSTAR VARJE ANVÄNDARE, PER FUNKTION? (2026-08-14)
 *
 * Adminpanelens kostnadsvy. Summerar VERKLIGA tokental ur `ScannerJob.result`
 * och `GradingJob.result` och prissätter dem med `src/lib/ai-pricing.ts`.
 *
 * ⛔ **TRE UTFALL, ALDRIG TVÅ.** Varje rad är antingen KOSTNADSFÖRD (vi har
 *    modell + tokental), GRATIS (`costModel: null` — bilden eller streckkoden
 *    avgjorde, inget API-anrop gjordes) eller OMÄTT (raden saknar avtrycket
 *    helt: allt före 2026-08-14, plus en modell vi inte har pris för). Slås de
 *    två sista ihop ser en tung användare gratis ut, vilket är exakt fel håll
 *    för en kostnadsvy. `unmeasured` visas därför bredvid beloppet.
 *
 * ⛔ **RÅ SQL MED FLIT.** En admin-rad i `ScannerJob.result` bär konstavtryck
 *    och rutor (~5,6 kB); att hämta hela kolumnen för 25 användare × 30 dygn
 *    hade dragit hem megabyte per sidladdning för att läsa fyra heltal.
 *    Frågorna GRUPPERAR i Postgres och returnerar en handfull rader.
 *
 * ⛔ **`->>` SKILJER INTE "SAKNAS" FRÅN "ÄR NULL".** Båda ger SQL-NULL, och det
 *    är precis skillnaden mellan OMÄTT och GRATIS. Därför `jsonb_exists()` som
 *    egen kolumn — ta inte bort den som "redundant".
 *
 * ⛔ **INGA INFRAKOSTNADER HÄR.** Neon, Railway och Resend är delade och kan
 *    inte ärligt fördelas per användare (Neon debiteras per VAKEN TID, inte per
 *    fråga — en användare som råkar vara först på morgonen "orsakar" hela
 *    väckningen). Vyn visar därför bara det som ÄR per användare: AI-anropen.
 *    Larmvolymen redovisas som ANTAL, inte som kronor, av samma skäl.
 */
import { prisma } from "@/lib/db";
import { costMicroUsd, microUsdToOre, priceForModel } from "@/lib/ai-pricing";
import { getRatesOre } from "@/lib/exchange-rate";

/**
 * Rullande kostnadsfönster i adminlistan. 30 dygn, INTE "denna månad": den 1:a
 * i månaden hade listan annars visat noll för alla och sett ut som att
 * kostnaden försvunnit. Detaljsidan visar båda fönstren, eftersom bara
 * månadsfönstret går att jämföra med kvoten kunden ser i appen.
 */
export const COST_WINDOW_DAYS = 30;

/** En AI-funktions kostnad för en användare under fönstret. */
export interface FeatureCost {
  /** Rader totalt (alla utfall). */
  rows: number;
  /** Rader som kostade ett API-anrop OCH gick att prissätta. */
  pricedCalls: number;
  /** Rader där inget API-anrop gjordes (bilden/streckkoden avgjorde) = 0 kr. */
  freeCalls: number;
  /** Rader utan kostnadsavtryck, eller med en modell vi saknar pris för. */
  unmeasured: number;
  inputTokens: number;
  outputTokens: number;
  /** Summan i öre. 0 är ett giltigt svar när allt var gratis. */
  costOre: number;
  /** Modeller som förekom men saknar pris — lägg till dem i ai-pricing.ts. */
  unpricedModels: string[];
}

export interface UserCostSummary {
  userId: string;
  scanner: FeatureCost;
  grading: FeatureCost;
  /** Skickade e-postlarm (Resend). Antal, inte kronor — se filhuvudet. */
  emailAlerts: number;
  /** Skickade push-larm (APNs/FCM). Gratis, redovisas för aktivitetsbilden. */
  pushAlerts: number;
  /** Scanner + gradering i öre. */
  totalOre: number;
  /** Summan av båda funktionernas omätta rader. */
  totalUnmeasured: number;
}

function emptyFeature(): FeatureCost {
  return {
    rows: 0,
    pricedCalls: 0,
    freeCalls: 0,
    unmeasured: 0,
    inputTokens: 0,
    outputTokens: 0,
    costOre: 0,
    unpricedModels: [],
  };
}

export function emptyCostSummary(userId: string): UserCostSummary {
  return {
    userId,
    scanner: emptyFeature(),
    grading: emptyFeature(),
    emailAlerts: 0,
    pushAlerts: 0,
    totalOre: 0,
    totalUnmeasured: 0,
  };
}

/** En grupperad rad ur någon av jobbtabellerna. */
interface CostGroupRow {
  userId: string;
  /** Modellnamnet, eller null (= inget API-anrop ELLER avtryck saknas). */
  model: string | null;
  /** Bar raden ett kostnadsavtryck alls? Skiljer GRATIS från OMÄTT. */
  hasCost: boolean;
  rows: bigint | number;
  inputTokens: bigint | number;
  outputTokens: bigint | number;
}

const num = (v: bigint | number | null | undefined): number => Number(v ?? 0);

/**
 * Slår ihop grupperade rader till en `FeatureCost`.
 *
 * Kostnaden räknas PER GRUPP (modell + summerade tokental), inte per rad — det
 * är matematiskt identiskt eftersom priset är linjärt i tokental, och sparar en
 * prisuppslagning per skanning.
 */
/**
 * VILKET AV DE TRE UTFALLEN ÄR DEN HÄR RADEN? Den kanoniska definitionen —
 * `service-costs.ts` (adminöversikten) importerar den i stället för att ha en
 * egen kopia.
 *
 * ⛔ ORDNINGEN ÄR INTE UTBYTBAR, och de två första grenarna är lätta att kasta om:
 *   1. `!hasCost`            → OMÄTT. Avtrycket saknas HELT (rader före
 *      2026-08-14, eller en väg som inte bokför). Vi vet ingenting.
 *   2. `model === null`      → GRATIS. Avtrycket FINNS och säger uttryckligen att
 *      bilden/streckkoden avgjorde: inget API-anrop gjordes. Äkta noll kronor.
 *   3. `micro === null`      → OMÄTT. Modellen saknas i prislistan eller
 *      tokentalen saknas — att räkna 0 kr vore en tyst underskattning.
 *   4. annars                → KOSTNADSFÖRD.
 * Kastas 1 och 2 om ser den kostnadsfria bild-först-vägen (~1 000 anrop/mån) ut
 * som okänd, och de verkligt okända ser gratis ut. Båda felen är tysta, och
 * exakt det hände i adminöversiktens första version (2026-08-26).
 * ⛔ `jsonb_exists()` som EGEN kolumn krävs för steg 1: `->>` kan inte skilja
 * "nyckeln saknas" från "värdet är null", vilket ÄR gränsen mellan omätt och gratis.
 */
export type CostOutcome = "priced" | "free" | "unmeasured";

export function classifyCostRow(
  hasCost: boolean,
  model: string | null,
  microUsd: number | null
): CostOutcome {
  if (!hasCost) return "unmeasured";
  if (model === null) return "free";
  if (microUsd === null) return "unmeasured";
  return "priced";
}

function foldGroups(groups: CostGroupRow[], usdToOre: number): FeatureCost {
  const out = emptyFeature();
  const unpriced = new Set<string>();

  for (const g of groups) {
    const rows = num(g.rows);
    out.rows += rows;

    const input = num(g.inputTokens);
    const output = num(g.outputTokens);
    const micro = g.model === null
      ? null
      : costMicroUsd(g.model, { inputTokens: input, outputTokens: output });

    const outcome = classifyCostRow(g.hasCost, g.model, micro);
    if (outcome === "unmeasured") {
      out.unmeasured += rows;
      if (g.model !== null && !priceForModel(g.model)) unpriced.add(g.model);
      continue;
    }
    if (outcome === "free") {
      out.freeCalls += rows;
      continue;
    }

    // `outcome === "priced"` garanterar att micro är ett tal; TS kan inte se
    // det genom klassificeraren, därav vakten (som aldrig ska kunna slå).
    if (micro === null) continue;
    out.pricedCalls += rows;
    out.inputTokens += input;
    out.outputTokens += output;
    out.costOre += microUsdToOre(micro, usdToOre);
  }

  out.unpricedModels = [...unpriced].sort();
  return out;
}

/**
 * Kostnad per användare för en lista användar-id:n, från och med `since`.
 *
 * Fyra frågor totalt oavsett antal användare (inte fyra per användare) — vyn
 * ska inte skala med sidstorleken.
 */
export async function loadUserCosts(
  userIds: string[],
  since: Date
): Promise<Map<string, UserCostSummary>> {
  const out = new Map<string, UserCostSummary>();
  for (const id of userIds) out.set(id, emptyCostSummary(id));
  if (userIds.length === 0) return out;

  // ⛔ `getRatesOre()`, inte `getCachedRatesOre()`: den synkrona varianten
  // returnerar FALLBACK-konstanten (10,50 kr/USD) i en process som inte redan
  // hämtat kursen — och en webbrequest har inte gjort det. Kostnaden hade då
  // tyst räknats på fel kurs. Den asynkrona läser dygnscachen på disk och gör
  // högst ett nätanrop per dygn.
  const { usdToOre } = await getRatesOre();

  const [scanGroups, gradeGroups, alertGroups] = await Promise.all([
    // SKANNERN. `status <> 'FAILED'` = samma urval som månadskvoten
    // (getScannerQuota) — annars visar kostnadsvyn ett annat antal skanningar
    // än kvoten gör, för samma användare och samma period.
    prisma.$queryRaw<CostGroupRow[]>`
      SELECT
        "userId",
        "result"->>'costModel' AS "model",
        COALESCE(jsonb_exists("result", 'costModel'), false) AS "hasCost",
        COUNT(*) AS "rows",
        COALESCE(SUM(("result"->'costUsage'->>'inputTokens')::bigint), 0) AS "inputTokens",
        COALESCE(SUM(("result"->'costUsage'->>'outputTokens')::bigint), 0) AS "outputTokens"
      FROM "ScannerJob"
      WHERE "userId" = ANY(${userIds})
        AND "createdAt" >= ${since}
        AND "status" <> 'FAILED'
      GROUP BY 1, 2, 3
    `,
    // GRADERINGEN. Modellen står i en EGEN kolumn (`modelUsed`) och används
    // rakt av; `costUsage` i result bär tokentalen. En rad utan tokental blir
    // omätt, inte gratis — graderingen har ingen gratis-väg.
    prisma.$queryRaw<CostGroupRow[]>`
      SELECT
        "userId",
        "modelUsed" AS "model",
        COALESCE(("result"->'costUsage') IS NOT NULL AND jsonb_typeof("result"->'costUsage') = 'object', false) AS "hasCost",
        COUNT(*) AS "rows",
        COALESCE(SUM(("result"->'costUsage'->>'inputTokens')::bigint), 0) AS "inputTokens",
        COALESCE(SUM(("result"->'costUsage'->>'outputTokens')::bigint), 0) AS "outputTokens"
      FROM "GradingJob"
      WHERE "userId" = ANY(${userIds})
        AND "createdAt" >= ${since}
        AND "status" <> 'FAILED'
      GROUP BY 1, 2, 3
    `,
    prisma.alert.groupBy({
      by: ["userId", "channel"],
      where: {
        userId: { in: userIds },
        triggeredAt: { gte: since },
        status: "SENT",
        channel: { in: ["EMAIL", "PUSH"] },
      },
      _count: { _all: true },
    }),
  ]);

  const byUser = <T extends { userId: string }>(rows: T[]): Map<string, T[]> => {
    const m = new Map<string, T[]>();
    for (const r of rows) {
      const list = m.get(r.userId);
      if (list) list.push(r);
      else m.set(r.userId, [r]);
    }
    return m;
  };

  const scanByUser = byUser(scanGroups);
  const gradeByUser = byUser(gradeGroups);

  for (const [userId, summary] of out) {
    summary.scanner = foldGroups(scanByUser.get(userId) ?? [], usdToOre);
    summary.grading = foldGroups(gradeByUser.get(userId) ?? [], usdToOre);
    summary.totalOre = summary.scanner.costOre + summary.grading.costOre;
    summary.totalUnmeasured = summary.scanner.unmeasured + summary.grading.unmeasured;
  }

  for (const row of alertGroups) {
    const summary = out.get(row.userId);
    if (!summary) continue;
    if (row.channel === "EMAIL") summary.emailAlerts = row._count._all;
    else if (row.channel === "PUSH") summary.pushAlerts = row._count._all;
  }

  return out;
}
