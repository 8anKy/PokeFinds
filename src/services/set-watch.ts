/**
 * Set-bevakningar: bevaka ALLA sealed-produkter i ett set, inklusive de som
 * auto-importen skapar senare.
 *
 * Pro-only, och det är en HÅRD grind här — inte bara en låst knapp i UI:t.
 * Restock-larm har alltid varit en Pro-förmån (`checkRestockAlerts` filtrerar på
 * `proUserWhere()`), så en set-bevakning på ett gratiskonto vore en rad som aldrig
 * kan avfyra något: en tyst lögn i bevakningslistan. Hellre ett ärligt 403.
 */
import { prisma } from "@/lib/db";
import { ServiceError } from "@/lib/errors";
import { SEALED_CATEGORY_EXCLUSIONS } from "@/lib/product-category";
import { isDirectOfferUrl } from "@/lib/marketplace-urls";
import { NOT_HIDDEN } from "@/lib/product-visibility";

export async function listSetWatches(userId: string) {
  const watches = await prisma.setWatch.findMany({
    where: { userId },
    select: {
      id: true,
      setId: true,
      isPaused: true,
      createdAt: true,
      // logoUrl = setets egen logotyp (samma bild som katalogens set-ark visar).
      // symbolUrl som reserv: en del äldre set saknar logotyp men har symbolen.
      set: { select: { name: true, series: true, logoUrl: true, symbolUrl: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  if (watches.length === 0) return [];

  // Sealed-antalet som EGEN groupBy, inte som filtrerad `_count` i frågan ovan:
  // filtrerade relationsräknare kräver preview-flaggan `filteredRelationCount`,
  // och att slå på en preview-funktion för en undertext vore att ta en risk i
  // HELA schemat för en kosmetisk siffra. Bara sealed räknas — rubriken lovar
  // sealed-larm, så ett "180 produkter" hade räknat in singlar som aldrig kan
  // trigga en restock.
  const counts = await prisma.product.groupBy({
    by: ["setId"],
    where: {
      setId: { in: watches.map((w) => w.setId) },
      category: { notIn: [...SEALED_CATEGORY_EXCLUSIONS] },
    },
    _count: { _all: true },
  });
  const bySet = new Map(counts.map((c) => [c.setId, c._count._all]));

  // "N produkter i lager" på Set-fliken (2026-10-25): samma köpbarhet som rubrikpriset —
  // i lager, direktlänk, > 0 kr. Ett set har ~10–50 sealed, så urvalet är litet.
  const stocked = await prisma.offer.findMany({
    where: {
      stockStatus: "IN_STOCK",
      price: { gt: 0 },
      product: {
        setId: { in: watches.map((w) => w.setId) },
        category: { notIn: [...SEALED_CATEGORY_EXCLUSIONS] },
        ...NOT_HIDDEN,
      },
    },
    select: { url: true, productId: true, product: { select: { setId: true } } },
  });
  const inStockBySet = new Map<string, Set<string>>();
  for (const o of stocked) {
    if (!o.product.setId || !isDirectOfferUrl(o.url)) continue;
    const ids = inStockBySet.get(o.product.setId) ?? new Set<string>();
    ids.add(o.productId);
    inStockBySet.set(o.product.setId, ids);
  }

  return watches.map((w) => ({
    id: w.id,
    setId: w.setId,
    createdAt: w.createdAt,
    name: w.set.name,
    series: w.set.series,
    logoUrl: w.set.logoUrl ?? w.set.symbolUrl,
    sealedCount: bySet.get(w.setId) ?? 0,
    inStockCount: inStockBySet.get(w.setId)?.size ?? 0,
    isPaused: w.isPaused,
  }));
}

/** Bara id:na — det klientkomponenterna behöver för att rita rätt tillstånd. */
export async function listSetWatchIds(userId: string): Promise<string[]> {
  const rows = await prisma.setWatch.findMany({
    where: { userId },
    select: { setId: true },
  });
  return rows.map((r) => r.setId);
}

export async function addSetWatch(userId: string, isPro: boolean, setId: string) {
  if (!isPro) {
    throw new ServiceError(
      403,
      "Att bevaka ett helt set är en Pro-förmån. Uppgradera för att aktivera det."
    );
  }

  const set = await prisma.cardSet.findUnique({
    where: { id: setId },
    select: { id: true },
  });
  if (!set) throw new ServiceError(404, "Setet hittades inte.");

  // Idempotent med flit: knappen är en växel och två snabba tryck (eller två
  // flikar) ska inte ge ett fel som läser som att bevakningen misslyckades.
  const existing = await prisma.setWatch.findUnique({
    where: { userId_setId: { userId, setId } },
    select: { id: true },
  });
  if (existing) return { id: existing.id, setId, created: false };

  const created = await prisma.setWatch.create({
    data: { userId, setId },
    select: { id: true },
  });
  return { id: created.id, setId, created: true };
}

/**
 * Nycklad på setId, inte på radens id: anroparen (produktkortets klocka) känner
 * setet men aldrig bevakningsradens id, och att hämta den först vore en extra
 * rundtur för att ta bort en rad vi ändå kan peka ut unikt.
 */
export async function removeSetWatch(userId: string, setId: string) {
  const { count } = await prisma.setWatch.deleteMany({ where: { userId, setId } });
  if (count === 0) throw new ServiceError(404, "Bevakningen hittades inte.");
  return { deleted: true };
}

/** Pausad set-bevakning ligger kvar men larmar inte (`isPaused: false` i båda larmvägarna). */
export async function setSetWatchPaused(userId: string, setId: string, isPaused: boolean) {
  const { count } = await prisma.setWatch.updateMany({ where: { userId, setId }, data: { isPaused } });
  if (count === 0) throw new ServiceError(404, "Bevakningen hittades inte.");
  return { setId, isPaused };
}
