/**
 * GET /api/grading/jobs/[id]/worth — "Lönar det sig att gradera?" för en TIDIGARE
 * gradering (2026-10-01). Räknas vid behov, aldrig sparat: marknadsvärdet och de
 * sålda graderade priserna rör sig, så ett lagrat svar hade blivit gammalt.
 * Bara när användaren själv öppnar en gradering ur historiken — en läsning per tryck.
 *
 * KOPPLAR OCKSÅ OM ÄLDRE GRADERINGAR: en gradering som aldrig fick ett katalogkort
 * (t.ex. Classic Collection-nytryck före tie-breaken i card-link.ts) försöks igen
 * här, och en träff SPARAS på jobbet — då får slabben och listraden en bild.
 */
import type { Prisma } from "@prisma/client";
import { apiError, jsonOk } from "@/lib/api";
import { requireEntitledUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { ServiceError } from "@/lib/errors";
import { effectivePlanTier } from "@/lib/plan";
import { resolveGradedCard } from "@/services/grading/card-link";
import { gradingWorth } from "@/services/grading/extras";

export const dynamic = "force-dynamic";

interface StoredResult {
  cardName?: string | null;
  cardId?: string | null;
  cardSlug?: string | null;
  cardImageUrl?: string | null;
  /** Användaren valde kortet själv (../card/route.ts) — koppla aldrig om det. */
  cardPicked?: boolean;
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  try {
    const user = await requireEntitledUser();
    const job = await prisma.gradingJob.findFirst({
      where: { id: params.id, userId: user.id, status: "COMPLETED" },
      select: { id: true, overallGrade: true, result: true },
    });
    if (!job) throw new ServiceError(404, "Graderingen hittades inte.");
    const r = (job.result ?? {}) as StoredResult & Record<string, unknown>;

    let card: {
      cardId: string;
      cardImageUrl: string | null;
      cardSlug: string | null;
      cardLabel: string;
      cardSetName: string;
      cardLanguage: string;
    } | null = null;
    if (!r.cardImageUrl && !r.cardPicked) {
      const linked = await resolveGradedCard(r.cardName).catch(() => null);
      if (linked) {
        card = {
          cardId: linked.cardId,
          cardImageUrl: linked.imageUrl,
          cardSlug: linked.slug,
          cardLabel: `${linked.name} · ${linked.setName} ${linked.number}`,
          cardSetName: linked.setName,
          cardLanguage: linked.language,
        };
        await prisma.gradingJob
          .update({ where: { id: job.id }, data: { result: { ...r, ...card } as unknown as Prisma.InputJsonObject } })
          .catch(() => undefined);
      }
    }

    const cardId = card?.cardId ?? r.cardId;
    const slug = card?.cardSlug ?? r.cardSlug;
    const worth =
      job.overallGrade != null
        ? await gradingWorth(cardId, slug, job.overallGrade, effectivePlanTier(user) === "PREMIUM")
        : null;
    return jsonOk({ worth, card });
  } catch (e) {
    return apiError(e);
  }
}
