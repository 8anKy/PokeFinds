/**
 * POST /api/scanner/confirm — bekräfta identifierat kort och lägg till
 * det i användarens samling.
 */
import { z } from "zod";
import { CardCondition, CardLanguage, type Prisma } from "@prisma/client";
import { apiError, jsonOk } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { ServiceError } from "@/lib/errors";
import { estimateCardValue } from "@/services/scanner";

export const dynamic = "force-dynamic";

const confirmSchema = z.object({
  jobId: z.string().min(1),
  cardId: z.string().min(1),
  quantity: z.number().int().min(1).max(10000).default(1),
  condition: z.nativeEnum(CardCondition).default("NEAR_MINT"),
  language: z.nativeEnum(CardLanguage).default("EN"),
});

export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const input = confirmSchema.parse(await req.json());

    // Verifiera att jobbet finns och tillhör användaren.
    const job = await prisma.scannerJob.findUnique({ where: { id: input.jobId } });
    if (!job || job.userId !== user.id) {
      throw new ServiceError(404, "Skanningen hittades inte.");
    }

    const card = await prisma.card.findUnique({
      where: { id: input.cardId },
      select: { id: true },
    });
    if (!card) throw new ServiceError(404, "Kortet hittades inte.");

    const estimatedValue = await estimateCardValue(input.cardId);

    const item = await prisma.collectionItem.create({
      data: {
        userId: user.id,
        cardId: input.cardId,
        quantity: input.quantity,
        condition: input.condition,
        language: input.language,
        estimatedValue,
      },
      include: {
        card: { include: { set: { select: { id: true, name: true } } } },
      },
    });

    // Markera jobbet som bekräftat i resultatet.
    const prevResult =
      job.result && typeof job.result === "object" && !Array.isArray(job.result)
        ? (job.result as Prisma.JsonObject)
        : {};
    await prisma.scannerJob.update({
      where: { id: job.id },
      data: {
        result: {
          ...prevResult,
          confirmedCardId: input.cardId,
          confirmedAt: new Date().toISOString(),
        },
      },
    });

    return jsonOk({ item }, { status: 201 });
  } catch (e) {
    return apiError(e);
  }
}
