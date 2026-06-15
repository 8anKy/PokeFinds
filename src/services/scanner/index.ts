/**
 * Kortskanner: orkestrerar OCR-adapter → kortmatchning → ScannerJob.
 *
 * Bildlagring (MVP): vi sparar INTE base64-datan i databasen — fältet
 * imageUrl sätts till "inline-upload". I produktion laddas bilden upp till
 * S3-kompatibel objektlagring och URL:en sparas här (se docs/SCANNER.md).
 */
import type { Prisma, ScannerJob } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ServiceError } from "@/lib/errors";
import { extractSetNumber, scoreSimilarity } from "@/scrapers/matching";
import { getCardValues } from "@/services/products";
import { ClaudeVisionOcrAdapter } from "@/services/scanner/claude-vision";
import { MockOcrAdapter } from "@/services/scanner/ocr-mock";
import type { OcrAdapter, OcrResult, ScanCandidate } from "@/services/scanner/types";

/** Markör för bilder som laddats upp inline (MVP, ingen objektlagring). */
const INLINE_UPLOAD = "inline-upload";

/** Max antal kandidater som returneras. */
const MAX_CANDIDATES = 5;

/**
 * Returnerar konfigurerad OCR-adapter utifrån env-variabeln OCR_PROVIDER.
 * "mock" (standard) använder utvecklingsmocken. Nya leverantörer
 * registreras här — se docs/SCANNER.md.
 *
 * `precise` väljer en starkare (men dyrare) vision-modell. Live-loopen pollar
 * med den snabba/billiga modellen (SCANNER_MODEL, Haiku); den precisa modellen
 * (SCANNER_MODEL_PRECISE, Sonnet) körs bara EN gång per kort — vid uppladdning
 * och vid den slutliga bekräftelsen innan ett kort låses — så att träffsäkerheten
 * blir hög utan att varje videoruta kostar Sonnet-tokens.
 */
export function getOcrAdapter(precise = false): OcrAdapter {
  const provider = process.env.OCR_PROVIDER ?? "mock";
  switch (provider) {
    case "mock":
      return new MockOcrAdapter();
    case "claude":
      return new ClaudeVisionOcrAdapter(
        precise
          ? process.env.SCANNER_MODEL_PRECISE ?? "claude-sonnet-4-6"
          : process.env.SCANNER_MODEL ?? "claude-haiku-4-5"
      );
    default:
      throw new ServiceError(
        503,
        "OCR-leverantör ej konfigurerad — se docs/SCANNER.md"
      );
  }
}

/**
 * Matchar ett OCR-resultat mot kortkatalogen.
 * Strategi: kandidatfiltrering via namn (contains, skiftlägesokänslig) →
 * Dice-bigram-likhet (scoreSimilarity) → bonus för matchande setnummer.
 */
export async function matchCards(ocr: OcrResult): Promise<ScanCandidate[]> {
  const query = ocr.guessedName?.trim() || ocr.rawText.trim();
  if (!query) return [];

  // Kandidater: kort vars namn innehåller någon betydelsebärande token.
  const tokens = query
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length >= 3)
    .slice(0, 5);
  if (tokens.length === 0) return [];

  const candidates = await prisma.card.findMany({
    where: {
      OR: tokens.map((t) => ({ name: { contains: t, mode: "insensitive" as const } })),
    },
    include: { set: { select: { name: true, totalCards: true } } },
    take: 50,
  });
  if (candidates.length === 0) return [];

  const guessedNum = ocr.guessedNumber ? extractSetNumber(ocr.guessedNumber) : null;

  const scored = candidates.map((card): ScanCandidate => {
    let score = scoreSimilarity(query, card.name);
    // Bonus för matchande setnummer (t.ex. "25/102").
    if (guessedNum) {
      const cardNum = parseInt(card.number, 10);
      const matchesNumber = !Number.isNaN(cardNum) && cardNum === guessedNum.num;
      const matchesTotal =
        card.set.totalCards === 0 || card.set.totalCards === guessedNum.total;
      if (matchesNumber && matchesTotal) {
        score = Math.min(1, score + 0.2);
      }
    }
    return {
      cardId: card.id,
      name: card.name,
      setName: card.set.name,
      number: card.number,
      rarity: card.rarity,
      imageUrl: card.imageUrl,
      score: Math.round(score * 1000) / 1000,
      slug: null,
      estimatedValue: null,
    };
  });

  const top = scored
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_CANDIDATES);

  // Bifoga aktuellt marknadsvärde (Cardmarket-trend) + produkt-slug (djuplänk)
  // för de visade kandidaterna.
  const cardIds = top.map((c) => c.cardId);
  const [values, products] = await Promise.all([
    getCardValues(cardIds),
    prisma.product.findMany({
      where: { cardId: { in: cardIds } },
      select: { cardId: true, slug: true },
    }),
  ]);
  const slugByCard = new Map(
    products.flatMap((p) => (p.cardId ? [[p.cardId, p.slug] as const] : []))
  );
  for (const c of top) {
    c.estimatedValue = values.get(c.cardId) ?? null;
    c.slug = slugByCard.get(c.cardId) ?? null;
  }

  return top;
}

export interface ScanResult {
  job: ScannerJob;
  candidates: ScanCandidate[];
}

/**
 * Kör en komplett skanning: skapar ett ScannerJob (RUNNING), kör
 * OCR-adaptern, matchar mot katalogen och sparar resultatet (COMPLETED).
 * Vid fel markeras jobbet som FAILED och felet kastas vidare.
 */
export async function runScannerJob(
  userId: string,
  imageDataUrl: string
): Promise<ScanResult> {
  const adapter = getOcrAdapter();

  const job = await prisma.scannerJob.create({
    data: {
      userId,
      // MVP: persistera inte base64-datan; produktion = S3-URL.
      imageUrl: INLINE_UPLOAD,
      status: "RUNNING",
    },
  });

  try {
    const ocr = await adapter.extractCardInfo(imageDataUrl);
    const candidates = await matchCards(ocr);

    const result: Prisma.JsonObject = {
      provider: adapter.name,
      ocr: {
        rawText: ocr.rawText,
        guessedName: ocr.guessedName ?? null,
        guessedNumber: ocr.guessedNumber ?? null,
        confidence: ocr.confidence,
      },
      imageNote: "uploaded-inline",
      candidates: candidates.map((c) => ({ ...c })),
    };

    const updated = await prisma.scannerJob.update({
      where: { id: job.id },
      data: { status: "COMPLETED", result, confidence: ocr.confidence },
    });

    return { job: updated, candidates };
  } catch (error) {
    await prisma.scannerJob
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

/** Hämtar användarens senaste skanningar. */
export async function listScannerJobs(userId: string, take = 10) {
  return prisma.scannerJob.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take,
  });
}

/**
 * Uppskattar ett korts aktuella marknadsvärde (öre) via kortets produkt
 * (lägsta pris = Cardmarket-trend) — samma mått som produktsidan och samlingens
 * live-värdering. Returnerar null om data saknas.
 */
export async function estimateCardValue(cardId: string): Promise<number | null> {
  const values = await getCardValues([cardId]);
  return values.get(cardId) ?? null;
}

export interface IdentifyResult {
  /** Adaptern som användes ("mock" = simulerad, "claude" = riktig vision). */
  provider: string;
  guessedName: string | null;
  guessedNumber: string | null;
  confidence: number;
  candidates: ScanCandidate[];
}

/**
 * Live-identifiering: kör OCR-/vision-adaptern + matchar mot katalogen UTAN att
 * skapa ett ScannerJob (billigt nog att polla med nedskalade videorutor).
 * Returnerar bästa katalogträffar + aktuellt marknadsvärde. Sätt `precise` för
 * den starkare vision-modellen (bekräftelse/uppladdning).
 */
export async function identifyCard(
  imageDataUrl: string,
  opts: { precise?: boolean } = {}
): Promise<IdentifyResult> {
  const adapter = getOcrAdapter(opts.precise);
  const ocr = await adapter.extractCardInfo(imageDataUrl);
  const candidates =
    ocr.guessedName || ocr.rawText.trim() ? await matchCards(ocr) : [];
  return {
    provider: adapter.name,
    guessedName: ocr.guessedName ?? null,
    guessedNumber: ocr.guessedNumber ?? null,
    confidence: ocr.confidence,
    candidates,
  };
}
