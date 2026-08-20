/**
 * Set-komplettering: "hur mycket av det här setet äger jag?"
 *
 * TVÅ SVAR, för det är två olika frågor en samlare ställer:
 *  · SET        — har jag varje KORT? Nämnare: hela setet inkl. secret rares.
 *  · MASTER SET — har jag varje TRYCKNING (ordinarie + reverse holo + …)?
 *                 Nämnare: de tryckningar VI listar.
 * Talen och deras invarianter bor i `src/lib/set-denominator.ts`. Läs det
 * filhuvudet innan du rör en nämnare här.
 *
 * ⛔ EN AGGREGERAD FRÅGA PER SET, ALDRIG EN PER KORT. Setsidans rutnät renderar
 * 20–40 kort samtidigt; ett uppslag per kort hade blivit lika många Neon-frågor
 * på en sida som annars är ISR-cachad och inte rör databasen alls (samma
 * lärdom som `lib/watched-sets.ts` bär för bevakningsklockan).
 *
 * ⛔ TÄLJAREN LÄCKTE (fixad 2026-08-20, 196 poster hos 12 användare): poster som
 * lagts till från en produktsida bar bara `productId`, och filtret nedan frågar
 * på `card: { setId }`. `addCollectionItem` fyller numera i `cardId` från
 * produkten — rör inte det utan att läsa kommentaren där.
 */
import { prisma } from "@/lib/db";
import { ServiceError } from "@/lib/errors";
import { resolveSetTotals } from "@/lib/set-denominator";

export interface SetCompletionResult {
  /** Nämnaren för KORT: hela setet inkl. secret rares. 0 = okänt ⇒ rita inget. */
  total: number;
  /** Antal OLIKA kort ur setet användaren äger (lots räknas en gång). */
  ownedCount: number;
  ownedCardIds: string[];
  /** Nämnaren för MASTER SET: tryckningar vi listar. 0 = vi listar inga. */
  printingsTotal: number;
  /** Antal olika TRYCKNINGAR användaren äger. */
  ownedPrintings: number;
  /** Produkt-id:n användaren äger — rutnätets filter matchar på tryckning. */
  ownedProductIds: string[];
  /** true när setet bevisligen har fler kort än vi listar ⇒ lova aldrig "allt". */
  catalogShort: boolean;
  /** Setets tryckningar enligt TCGdex när de är fler än vi listar. 0 = ingen not. */
  printingsElsewhere: number;
}

export async function getSetCompletion(
  userId: string,
  setId: string
): Promise<SetCompletionResult> {
  // Batchat i EN rundtur: tre sekventiella await hade blivit tre tur-och-retur
  // mot Neon för siffror som ritas i samma rad. `$transaction` med en array
  // skickar dem tillsammans.
  const [set, listed, owned] = await prisma.$transaction([
    prisma.cardSet.findUnique({
      where: { id: setId },
      select: {
        totalCards: true,
        totalCardsFull: true,
        printingsTotal: true,
        _count: { select: { cards: true } },
      },
    }),
    // MASTER SET-NÄMNAREN: distinkta (kort, variant)-par vi listar. `groupBy`
    // och inte `count`, för två produktrader för samma kort och variant är EN
    // tryckning — annars hade en dubblett i katalogen sänkt allas procent.
    // ⛔ `hiddenAt: null`: en produkt ägaren gömt finns inte att köpa och ska
    // inte kunna göra ett set omöjligt att slutföra.
    prisma.product.groupBy({
      by: ["cardId", "variantLabel"],
      where: {
        setId,
        category: "SINGLE_CARD",
        cardId: { not: null },
        hiddenAt: null,
      },
      orderBy: { cardId: "asc" },
    }),
    // EN läsning för båda täljarna. `findMany` och inte två `groupBy`: raderna
    // är få (en användares poster i ETT set) och vi behöver produktens variant
    // för master-räkningen ändå. Relationsfiltret `card: { setId }` gör att
    // sealed (kortlöst) aldrig kommer med — en ETB är inget kort i setet.
    prisma.collectionItem.findMany({
      where: { userId, card: { setId } },
      select: {
        cardId: true,
        productId: true,
        product: { select: { variantLabel: true } },
      },
    }),
  ]);
  if (!set) throw new ServiceError(404, "Setet hittades inte.");

  const ownedCardIds = new Set<string>();
  const ownedProductIds = new Set<string>();
  // Tryckningsnyckeln: produkten BÄR varianten. En post utan produkt (manuellt
  // tillägg, CSV-import) räknas som den ordinarie tryckningen — det är vad
  // användaren menade, och att gissa en variant hade varit att hitta på.
  const ownedPrintingKeys = new Set<string>();
  for (const item of owned) {
    if (item.cardId) {
      ownedCardIds.add(item.cardId);
      ownedPrintingKeys.add(`${item.cardId}\u0000${item.product?.variantLabel ?? ""}`);
    }
    if (item.productId) ownedProductIds.add(item.productId);
  }

  const totals = resolveSetTotals({
    totalCards: set.totalCards,
    totalCardsFull: set.totalCardsFull,
    cardCount: set._count.cards,
    listedPrintings: listed.length,
    printingsTotal: set.printingsTotal,
  });

  return {
    total: totals.full ?? 0,
    ownedCount: ownedCardIds.size,
    ownedCardIds: [...ownedCardIds],
    printingsTotal: totals.printings ?? 0,
    ownedPrintings: ownedPrintingKeys.size,
    ownedProductIds: [...ownedProductIds],
    catalogShort: totals.catalogShort,
    printingsElsewhere: totals.printingsElsewhere ?? 0,
  };
}
