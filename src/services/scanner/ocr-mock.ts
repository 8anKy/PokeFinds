/**
 * UTVECKLINGSMOCK — INTE för produktion.
 *
 * MockOcrAdapter simulerar en OCR-/vision-leverantör genom att slumpa fram
 * ett befintligt kort ur databasen och returnera dess namn och setnummer
 * med en konfidens mellan 0,6 och 0,95. Det gör att hela skannerflödet
 * (uppladdning → analys → matchning → bekräftelse) kan demonstreras utan
 * extern tjänst.
 *
 * I produktion: implementera en riktig OcrAdapter (t.ex. Google Vision,
 * AWS Textract eller en specialiserad TCG-modell) — se docs/SCANNER.md.
 */
import { prisma } from "@/lib/db";
import { ServiceError } from "@/lib/errors";
import type { OcrAdapter, OcrResult } from "@/services/scanner/types";

export class MockOcrAdapter implements OcrAdapter {
  readonly name = "mock";

  async extractCardInfo(imageDataUrl: string): Promise<OcrResult> {
    // Bilden analyseras inte — vi använder bara dess längd för att göra
    // valet deterministiskt för samma bild (samma bild → samma kort).
    const cardCount = await prisma.card.count();
    if (cardCount === 0) {
      throw new ServiceError(
        503,
        "Inga kort finns i databasen ännu — kör seed-skriptet och försök igen."
      );
    }

    const skip = imageDataUrl.length % cardCount;
    const card = await prisma.card.findFirst({
      skip,
      orderBy: { id: "asc" },
      include: { set: { select: { totalCards: true } } },
    });
    if (!card) {
      throw new ServiceError(503, "Kunde inte läsa kortdata. Försök igen.");
    }

    const number = card.set.totalCards
      ? `${card.number}/${card.set.totalCards}`
      : card.number;

    // Pseudoslumpad men deterministisk konfidens i intervallet 0,60–0,95.
    const confidence = 0.6 + ((imageDataUrl.length * 7919) % 3500) / 10000;

    return {
      rawText: `${card.name} ${number} ${card.rarity}`,
      guessedName: card.name,
      guessedNumber: number,
      confidence: Math.round(confidence * 100) / 100,
    };
  }
}
