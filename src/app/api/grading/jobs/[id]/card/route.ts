/**
 * PUT /api/grading/jobs/[id]/card — "Fel kort? Välj rätt" (2026-10-01).
 *
 * Modellen identifierar kortet ur fotot och card-link.ts styrker det bara med
 * samlarnumret, så graderingen kan sakna kort eller — sällsynt — ha fel. Här väljer
 * användaren själv ur samma katalogsökning som skannern (`/api/scanner/search`).
 * Valet SPARAS på jobbet (`cardPicked`), så historiken, slabben och "Lönar det sig?"
 * följer det, och worth-rutten kopplar aldrig om ett valt kort.
 *
 * Bedömningen (poängen) rörs INTE — den gäller fotot, inte katalogkortet.
 */
import type { NextRequest } from "next/server";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { apiError, jsonOk } from "@/lib/api";
import { requireEntitledUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { ServiceError } from "@/lib/errors";
import { effectivePlanTier } from "@/lib/plan";
import { linkByCardId } from "@/services/grading/card-link";
import { gradingWorth } from "@/services/grading/extras";

export const dynamic = "force-dynamic";

const schema = z.object({
  cardId: z.string().trim().min(1).max(64),
  /** Vald tryckning (reverse holo …) — prövas mot kortet, annars ordinarie. */
  slug: z.string().trim().min(1).max(200).optional(),
});

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireEntitledUser();
    const { cardId, slug } = schema.parse(await req.json());
    const job = await prisma.gradingJob.findFirst({
      where: { id: params.id, userId: user.id, status: "COMPLETED" },
      select: { id: true, overallGrade: true, result: true },
    });
    if (!job) throw new ServiceError(404, "Graderingen hittades inte.");

    const linked = await linkByCardId(cardId);
    if (!linked) throw new ServiceError(404, "Posten hittades inte.");

    // En slug från klienten gäller bara om produkten verkligen hör till kortet.
    const printing = slug
      ? await prisma.product.findFirst({ where: { slug, cardId }, select: { slug: true } })
      : null;

    const card = {
      cardId: linked.cardId,
      cardImageUrl: linked.imageUrl,
      cardSlug: printing?.slug ?? linked.slug,
      cardLabel: `${linked.name} · ${linked.setName} ${linked.number}`,
      cardSetName: linked.setName,
      cardLanguage: linked.language,
    };
    const r = (job.result ?? {}) as Record<string, unknown>;
    await prisma.gradingJob.update({
      where: { id: job.id },
      data: { result: { ...r, ...card, cardPicked: true } as unknown as Prisma.InputJsonObject },
    });

    const worth =
      job.overallGrade != null
        ? await gradingWorth(card.cardId, card.cardSlug, job.overallGrade, effectivePlanTier(user) === "PREMIUM").catch(
            () => null
          )
        : null;
    return jsonOk({ card, worth });
  } catch (e) {
    return apiError(e);
  }
}
