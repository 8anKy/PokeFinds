/**
 * Mätning inför set-komplettering: räcker vår data till MASTER SET, och hur ser
 * sällsynthetsfördelningen ut? Läser bara — EN Neon-väckning, alla frågor i ett
 * svep.
 */
import { prisma } from "../src/lib/db";

async function main() {
  const out: Record<string, unknown> = {};

  // 1. Vilka variantetiketter finns, och hur många singelprodukter bär dem?
  const variants = await prisma.product.groupBy({
    by: ["variantLabel"],
    where: { category: "SINGLE_CARD" },
    _count: { _all: true },
    orderBy: { _count: { id: "desc" } },
  });
  out.variantLabels = variants.map((v) => ({ label: v.variantLabel ?? "(null)", products: v._count._all }));

  // 2. Singelprodukter kopplade till kort vs herrelösa
  const [singlesTotal, singlesWithCard, cardsWithAnyProduct] = await prisma.$transaction([
    prisma.product.count({ where: { category: "SINGLE_CARD" } }),
    prisma.product.count({ where: { category: "SINGLE_CARD", cardId: { not: null } } }),
    prisma.card.count({ where: { products: { some: {} } } }),
  ]);
  out.singles = { singlesTotal, singlesWithCard, cardsWithAnyProduct, cardsTotal: await prisma.card.count() };

  // 3. Hur många KORT har en reverse-holo-variant? (master set-nämnaren)
  const revProducts = await prisma.product.findMany({
    where: { category: "SINGLE_CARD", cardId: { not: null }, variantLabel: { not: null } },
    select: { cardId: true, variantLabel: true, setId: true },
  });
  const revByLabel = new Map<string, Set<string>>();
  for (const p of revProducts) {
    const k = p.variantLabel!;
    if (!revByLabel.has(k)) revByLabel.set(k, new Set());
    revByLabel.get(k)!.add(p.cardId!);
  }
  out.cardsPerVariantLabel = [...revByLabel.entries()]
    .map(([k, v]) => ({ label: k, distinctCards: v.size }))
    .sort((a, b) => b.distinctCards - a.distinctCards);

  // 4. Samlingsposternas identitet: bär de productId (= tryckning) eller bara cardId?
  const [ciTotal, ciCardOnly, ciProductOnly, ciBoth, ciNeither] = await prisma.$transaction([
    prisma.collectionItem.count(),
    prisma.collectionItem.count({ where: { cardId: { not: null }, productId: null } }),
    prisma.collectionItem.count({ where: { cardId: null, productId: { not: null } } }),
    prisma.collectionItem.count({ where: { cardId: { not: null }, productId: { not: null } } }),
    prisma.collectionItem.count({ where: { cardId: null, productId: null } }),
  ]);
  out.collectionItems = { ciTotal, ciCardOnly, ciProductOnly, ciBoth, ciNeither };

  // 5. Sällsynthetsfördelning globalt (facit för "hits" och rarity-nedbrytning)
  const rarities = await prisma.card.groupBy({
    by: ["rarity"],
    _count: { _all: true },
    orderBy: { _count: { id: "desc" } },
  });
  out.rarities = rarities.map((r) => ({ rarity: r.rarity, cards: r._count._all }));

  // 6. Hur många set äger användarna kort ur? (dimensionerar översiktsvyn)
  const perUser = await prisma.$queryRawUnsafe<{ userid: string; sets: bigint; items: bigint }[]>(
    `SELECT ci."userId" AS userid, COUNT(DISTINCT c."setId") AS sets, COUNT(*) AS items
       FROM "CollectionItem" ci JOIN "Card" c ON c.id = ci."cardId"
      GROUP BY ci."userId" ORDER BY sets DESC LIMIT 20`
  );
  out.setsPerUser = perUser.map((r) => ({ sets: Number(r.sets), items: Number(r.items) }));

  // 7. Sällsynthet per set för de fem största EN-seten (form på rarity-nedbrytningen)
  const bigSets = await prisma.cardSet.findMany({
    where: { language: "EN" },
    select: { id: true, name: true, totalCards: true, _count: { select: { cards: true } } },
    orderBy: { releaseDate: "desc" },
    take: 5,
  });
  const perSet: unknown[] = [];
  for (const s of bigSets) {
    const rs = await prisma.card.groupBy({
      by: ["rarity"],
      where: { setId: s.id },
      _count: { _all: true },
      orderBy: { _count: { id: "desc" } },
    });
    perSet.push({ set: s.name, cards: s._count.cards, printed: s.totalCards, rarities: rs.map((r) => `${r.rarity}=${r._count._all}`) });
  }
  out.raritiesPerRecentSet = perSet;

  console.log(JSON.stringify(out, null, 2));
}
main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
