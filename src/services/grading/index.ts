/**
 * Kortgradering: väljer adapter/modell utifrån användarens plan, kvotbegränsar
 * gratisnivån och kör graderingen som ett GradingJob.
 *
 * Plan → modell, PER LEVERANTÖR (GRADING_PROVIDER):
 *   claude: FREE → GRADING_MODEL_FREE        (default claude-haiku-4-5)
 *           PRO  → GRADING_MODEL_PREMIUM     (default claude-sonnet-4-6)
 *   gemini: FREE → GRADING_MODEL_FREE_GEMINI (default gemini-3.1-flash-lite)
 *           PRO  → GRADING_MODEL_PREMIUM_GEMINI (default gemini-3.6-flash)
 * Månadskvoten är oförändrad och leverantörsoberoende (FREE N, PREMIUM N).
 *
 * Bildlagring (MVP): base64-datan persisteras inte; frontImageUrl/backImageUrl
 * sätts till "inline-upload" (jfr skannern). I produktion → objektlagring.
 */
import type { GradingJob, PlanTier, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ServiceError } from "@/lib/errors";
// ⛔ Delad med skannern OCH adminens kostnadsvy — kvotfönstret måste vara
// samma gräns överallt. Se src/lib/utils.ts.
import { startOfMonthUtc } from "@/lib/utils";
import { resolveGradedCard } from "@/services/grading/card-link";
import { ClaudeVisionGradingAdapter } from "@/services/grading/claude-vision";
import { GeminiVisionGradingAdapter } from "@/services/grading/gemini-vision";
import { MockGradingAdapter } from "@/services/grading/mock";
import type { GradingAdapter, GradingContext } from "@/services/grading/types";

const INLINE_UPLOAD = "inline-upload";

/** Antal gratis graderingar per kalendermånad (FREE-plan). */
export function freeMonthlyLimit(): number {
  const n = Number(process.env.GRADING_FREE_MONTHLY_LIMIT ?? "3");
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 3;
}

/** Månadsgräns för Pro — binder den dyrare Pro-modellens kostnad mot Pro-priset. */
export function premiumMonthlyLimit(): number {
  const n = Number(process.env.GRADING_PREMIUM_MONTHLY_LIMIT ?? "15");
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 15;
}

function limitForTier(planTier: PlanTier): number {
  return planTier === "PREMIUM" ? premiumMonthlyLimit() : freeMonthlyLimit();
}

/** 3.x, inte 2.5: 2.5-serien är spärrad för nya API-nycklar (mätt i fält
 *  2026-08-02, se src/services/scanner/gemini-vision.ts) och stängs ned
 *  2026-10-16. Flash-Lite för gratisnivån, Flash för Pro — Pro betalar för en
 *  noggrannare bedömning, inte för en annan leverantör. */
const DEFAULT_GEMINI_FREE = "gemini-3.1-flash-lite";
const DEFAULT_GEMINI_PREMIUM = "gemini-3.6-flash";

/**
 * ⛔ MODELLNAMNEN HAR EGNA VARIABLER PER LEVERANTÖR (samma beslut som
 * `DEALS_VERIFY_MODEL_GEMINI` i src/services/deal-verify/index.ts). Delade
 * GRADING_MODEL_*-variabler hade betytt att ett leverantörsbyte tyst skickar ett
 * Claude-modellnamn till Google → 404 på varje gradering, dvs en funktion som är
 * död för alla utom den som läser serverloggen. Skannerns SCANNER_MODEL har
 * fortfarande exakt den svagheten.
 */
function modelForTier(provider: string, planTier: PlanTier): string {
  const premium = planTier === "PREMIUM";
  if (provider === "gemini") {
    // `||` och inte `??`: GitHub Actions/Railway sätter en oangiven variabel till
    // TOM STRÄNG, inte undefined — och en tom modellsträng ger 404 på varje
    // anrop. Claude-grenen nedan behåller `??` med flit: den är befintligt
    // beteende och ett leverantörsbyte ska inte smyga in en andra ändring.
    return premium
      ? process.env.GRADING_MODEL_PREMIUM_GEMINI || DEFAULT_GEMINI_PREMIUM
      : process.env.GRADING_MODEL_FREE_GEMINI || DEFAULT_GEMINI_FREE;
  }
  return premium
    ? process.env.GRADING_MODEL_PREMIUM ?? "claude-sonnet-4-6"
    : process.env.GRADING_MODEL_FREE ?? "claude-haiku-4-5";
}

/**
 * Väljer graderingsadapter. GRADING_PROVIDER=mock (standard) använder mocken;
 * "claude" och "gemini" använder vision-modellen som matchar planen.
 *
 * ⛔ INGEN TYST FALLBACK vid okänd leverantör: en felstavad variabel ska ge ett
 * synligt 503, inte en oväntad modell som skriver en gradering användaren sparar
 * i sin samling.
 */
export function getGradingAdapter(planTier: PlanTier): GradingAdapter {
  const provider = process.env.GRADING_PROVIDER ?? "mock";
  switch (provider) {
    case "mock":
      return new MockGradingAdapter();
    case "claude":
      return new ClaudeVisionGradingAdapter(modelForTier(provider, planTier));
    case "gemini":
      return new GeminiVisionGradingAdapter(modelForTier(provider, planTier));
    default:
      throw new ServiceError(503, "Graderingsleverantör ej konfigurerad.");
  }
}


export interface GradingQuota {
  /** Antal graderingar gjorda denna månad. */
  used: number;
  /** Månadsgräns. */
  limit: number | null;
  /** Återstående denna månad. */
  remaining: number | null;
  /** True för Pro (styr UI-text: ingen "uppgradera"-knapp). */
  isPremium: boolean;
}

/** Returnerar månadens kvotstatus för en användare. */
export async function getGradingQuota(
  userId: string,
  planTier: PlanTier
): Promise<GradingQuota> {
  const limit = limitForTier(planTier);
  // Misslyckade graderingar ska inte tära på månadskvoten.
  const used = await prisma.gradingJob.count({
    where: {
      userId,
      createdAt: { gte: startOfMonthUtc() },
      status: { not: "FAILED" },
    },
  });
  return {
    used,
    limit,
    remaining: Math.max(0, limit - used),
    isPremium: planTier === "PREMIUM",
  };
}

export interface GradingJobResult {
  job: GradingJob;
}

/**
 * Kör en komplett gradering: kvotkontroll → GradingJob (RUNNING) → adapter →
 * spara resultat (COMPLETED). Vid fel markeras jobbet FAILED och felet kastas.
 */
export async function runGradingJob(
  userId: string,
  planTier: PlanTier,
  frontDataUrl: string,
  backDataUrl: string,
  context?: GradingContext
): Promise<GradingJobResult> {
  // Månadskvot (FREE = gratisgräns, PREMIUM = Pro-gräns mot Pro-modellens kostnad).
  const quota = await getGradingQuota(userId, planTier);
  if (quota.remaining !== null && quota.remaining <= 0) {
    throw new ServiceError(
      429,
      planTier === "PREMIUM"
        ? `Du har nått månadens gräns på ${quota.limit} graderingar. Tillbaka nästa månad.`
        : `Du har använt dina ${quota.limit} gratis graderingar denna månad. Uppgradera till Pro för fler.`
    );
  }

  const adapter = getGradingAdapter(planTier);

  const job = await prisma.gradingJob.create({
    data: {
      userId,
      frontImageUrl: INLINE_UPLOAD,
      backImageUrl: INLINE_UPLOAD,
      status: "RUNNING",
    },
  });

  try {
    const result = await adapter.grade(frontDataUrl, backDataUrl, context);

    // KATALOGKORTET, om det går att styrka. Historiken har ingen bild att visa —
    // användarens foton sparas aldrig — så katalogbilden är den enda som finns.
    // Löses EN gång här i stället för vid varje historikvisning: en uppslagning per
    // gradering i stället för en per sidladdning (Neon debiteras per VAKEN TID).
    // `null` när numret saknas eller är tvetydigt; se card-link.ts för varför ett
    // namn ensamt inte duger.
    const cardName = result.cardName ?? context?.cardName ?? null;
    const linked = await resolveGradedCard(cardName).catch(() => null);

    const updated = await prisma.gradingJob.update({
      where: { id: job.id },
      data: {
        status: "COMPLETED",
        overallGrade: result.overall,
        confidence: result.confidence,
        modelUsed: result.modelUsed,
        result: {
          provider: adapter.name,
          subScores: { ...result.subScores },
          overall: result.overall,
          confidence: result.confidence,
          rationale: result.rationale,
          modelUsed: result.modelUsed,
          // KOSTNADSAVTRYCK (2026-08-14): API:ts egna tokental, för ALLA
          // användare. Adminpanelens kostnad-per-användare summerar dem
          // tillsammans med `modelUsed` (som redan är en egen kolumn).
          // ⛔ Saknas fältet räknas graderingen som OMÄTT, aldrig som gratis —
          // alla rader före det här datumet ser ut så. Se src/lib/ai-pricing.ts.
          costUsage: result.usage ? { ...result.usage } : null,
          // Modellens egen identifiering vinner över anroparens hint: hinten kommer
          // från en tidigare skanning och kan gälla ett helt annat kort än det som
          // just fotograferades.
          cardName,
          // Katalogkortet — bara när identiteten är styrkt av samlarnumret.
          cardId: linked?.cardId ?? null,
          cardImageUrl: linked?.imageUrl ?? null,
          cardSlug: linked?.slug ?? null,
          // Katalogens egen skrivning, så raden kan visa "Camerupt · Ascended Heroes
          // 28" i stället för modellens gissning ("… · Obsidian Flames", som var fel).
          cardLabel: linked ? `${linked.name} · ${linked.setName} ${linked.number}` : null,
        } as unknown as Prisma.InputJsonObject,
      },
    });
    return { job: updated };
  } catch (error) {
    await prisma.gradingJob
      .update({
        where: { id: job.id },
        data: {
          status: "FAILED",
          result: {
            error: error instanceof Error ? error.message : "Okänt fel",
          },
        },
      })
      .catch(() => undefined);
    throw error;
  }
}

/** Hämtar användarens senaste graderingar. */
export async function listGradingJobs(userId: string, take = 10) {
  return prisma.gradingJob.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take,
  });
}
