/**
 * Kortgradering: väljer adapter/modell utifrån användarens plan, kvotbegränsar
 * gratisnivån och kör graderingen som ett GradingJob.
 *
 * Plan → modell:
 *   FREE    → GRADING_MODEL_FREE    (default claude-haiku-4-5), max N/månad
 *   PREMIUM → GRADING_MODEL_PREMIUM (default claude-sonnet-4-6), max N/månad
 *
 * Bildlagring (MVP): base64-datan persisteras inte; frontImageUrl/backImageUrl
 * sätts till "inline-upload" (jfr skannern). I produktion → objektlagring.
 */
import type { GradingJob, PlanTier, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ServiceError } from "@/lib/errors";
import { ClaudeVisionGradingAdapter } from "@/services/grading/claude-vision";
import { MockGradingAdapter } from "@/services/grading/mock";
import type { GradingAdapter, GradingContext } from "@/services/grading/types";

const INLINE_UPLOAD = "inline-upload";

/** Antal gratis graderingar per kalendermånad (FREE-plan). */
export function freeMonthlyLimit(): number {
  const n = Number(process.env.GRADING_FREE_MONTHLY_LIMIT ?? "3");
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 3;
}

/** Månadsgräns för Pro (Sonnet — binder marginalen mot Pro-priset). */
export function premiumMonthlyLimit(): number {
  const n = Number(process.env.GRADING_PREMIUM_MONTHLY_LIMIT ?? "15");
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 15;
}

function limitForTier(planTier: PlanTier): number {
  return planTier === "PREMIUM" ? premiumMonthlyLimit() : freeMonthlyLimit();
}

function modelForTier(planTier: PlanTier): string {
  return planTier === "PREMIUM"
    ? process.env.GRADING_MODEL_PREMIUM ?? "claude-sonnet-4-6"
    : process.env.GRADING_MODEL_FREE ?? "claude-haiku-4-5";
}

/**
 * Väljer graderingsadapter. GRADING_PROVIDER=mock (standard) använder mocken;
 * "claude" använder vision-modellen som matchar planen.
 */
export function getGradingAdapter(planTier: PlanTier): GradingAdapter {
  const provider = process.env.GRADING_PROVIDER ?? "mock";
  switch (provider) {
    case "mock":
      return new MockGradingAdapter();
    case "claude":
      return new ClaudeVisionGradingAdapter(modelForTier(planTier));
    default:
      throw new ServiceError(503, "Graderingsleverantör ej konfigurerad.");
  }
}

function startOfMonthUtc(): Date {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCHours(0, 0, 0, 0);
  return d;
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
  // Månadskvot (FREE = gratisgräns, PREMIUM = Pro-gräns mot Sonnet-kostnad).
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
          // Modellens egen identifiering vinner över anroparens hint: hinten kommer
          // från en tidigare skanning och kan gälla ett helt annat kort än det som
          // just fotograferades.
          cardName: result.cardName ?? context?.cardName ?? null,
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
