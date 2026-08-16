/**
 * Set-komplettering: "hur många kort i det här setet äger jag?"
 *
 * ⛔ EN AGGREGERAD FRÅGA PER SET, ALDRIG EN PER KORT. Setsidans rutnät renderar
 * 20–40 kort samtidigt; ett uppslag per kort hade blivit lika många Neon-frågor
 * på en sida som annars är ISR-cachad och inte rör databasen alls (samma
 * lärdom som `lib/watched-sets.ts` bär för bevakningsklockan).
 *
 * ⛔ NÄMNAREN LJUGER LÄTT: `CardSet.totalCards` kommer från pokemontcg.io och
 * räknar inte alltid secret rares, så en samlare kan äga FLER kort än nämnaren
 * påstår. Därför returnerar vi ALLTID antalet (inte bara en procent), faller
 * tillbaka på antalet kort vi själva har precis som setsidan gör, och låter
 * anroparen klampa procenten till 100.
 *
 * ⛔ Master set (reverse holo och andra tryckningar) ligger UTANFÖR det här:
 * `ownedCardIds` är KORT-id:n, och ett kort kan finnas i flera tryckningar som
 * `CollectionItem` inte skiljer på. En "master"-procent kräver `variantLabel` i
 * både täljare och nämnare — bygg den inte genom att räkna vidare på den här.
 */
import { prisma } from "@/lib/db";
import { ServiceError } from "@/lib/errors";

export interface SetCompletionResult {
  /** Nämnaren setsidan visar: `totalCards`, annars antalet kort vi har. */
  total: number;
  /** Antal OLIKA kort ur setet användaren äger (lots räknas en gång). */
  ownedCount: number;
  ownedCardIds: string[];
}

export async function getSetCompletion(
  userId: string,
  setId: string
): Promise<SetCompletionResult> {
  // Batchat i EN rundtur: två sekventiella await hade blivit två tur-och-retur
  // mot Neon för en siffra som ritas i samma rad. `$transaction` med en array
  // skickar dem tillsammans.
  const [set, owned] = await prisma.$transaction([
    prisma.cardSet.findUnique({
      where: { id: setId },
      select: { totalCards: true, _count: { select: { cards: true } } },
    }),
    // groupBy, inte findMany + dedup i minnet: samlingen lagras som LOTS (en rad
    // per skick/språk), så samma kort kan ha flera rader. Postgres dedupar dem
    // billigare än vi gör. Relationsfiltret `card: { setId }` gör att sealed
    // (cardId = null) aldrig kommer med — en ETB är inget kort i setet.
    prisma.collectionItem.groupBy({
      by: ["cardId"],
      where: { userId, card: { setId } },
      // Prisma KRÄVER orderBy på groupBy (typnivå). Ordningen spelar ingen roll
      // här — resultatet blir ett Set i klienten — så vi tar den billigaste.
      orderBy: { cardId: "asc" },
    }),
  ]);
  if (!set) throw new ServiceError(404, "Setet hittades inte.");

  const ownedCardIds = owned
    .map((row) => row.cardId)
    .filter((id): id is string => id !== null);

  return {
    total: set.totalCards > 0 ? set.totalCards : set._count.cards,
    ownedCount: ownedCardIds.length,
    ownedCardIds,
  };
}
