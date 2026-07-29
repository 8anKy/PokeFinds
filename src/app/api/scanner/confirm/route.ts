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
import { getProductValues } from "@/services/products";
import { estimateCardValue } from "@/services/scanner";

export const dynamic = "force-dynamic";

const confirmSchema = z.object({
  jobId: z.string().min(1),
  cardId: z.string().min(1),
  // VALD TRYCKNING. Base-kort har ETT Card men TRE produkter (Unlimited /
  // Shadowless / 1st Edition) och de skiljer sig kraftigt i värde. Utan detta
  // sparades alltid kortet utan produkt och värderades på den BILLIGASTE
  // tryckningen — en 1st Edition hamnade tyst i samlingen som Unlimited.
  productId: z.string().min(1).optional(),
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

    // Tryckningen måste tillhöra det bekräftade kortet — annars kunde en klient
    // parkera vilken produkt som helst på vilket kort som helst.
    let productId: string | null = null;
    if (input.productId) {
      const product = await prisma.product.findUnique({
        where: { id: input.productId },
        select: { id: true, cardId: true },
      });
      if (!product || product.cardId !== input.cardId) {
        throw new ServiceError(400, "Tryckningen hör inte till det valda kortet.");
      }
      productId = product.id;
    }

    // Värderas på den VALDA tryckningen när en sådan finns; annars på kortets
    // billigaste produkt som förut.
    const estimatedValue = productId
      ? (await getProductValues([productId])).get(productId) ?? null
      : await estimateCardValue(input.cardId);

    const item = await prisma.collectionItem.create({
      data: {
        userId: user.id,
        cardId: input.cardId,
        productId,
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
