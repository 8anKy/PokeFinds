/** Samlingstjänster: CRUD, värdering, CSV-export/-import. */
import { z } from "zod";
import { prisma } from "@/lib/db";
import { ServiceError } from "@/lib/errors";
import {
  getCardValues,
  getProductValues,
  computeLowestPrice,
} from "@/services/products";
import { isDirectOfferUrl } from "@/lib/marketplace-urls";
import type { CardCondition, CardLanguage } from "@prisma/client";

const COLLECTION_INCLUDE = {
  card: { include: { set: { select: { id: true, name: true } } } },
  product: { select: { id: true, title: true, slug: true, imageUrl: true } },
} as const;

export async function listCollection(userId: string) {
  return prisma.collectionItem.findMany({
    where: { userId },
    include: COLLECTION_INCLUDE,
    orderBy: { createdAt: "desc" },
  });
}

export interface CollectionItemInput {
  cardId?: string;
  productId?: string;
  quantity?: number;
  condition?: CardCondition;
  language?: CardLanguage;
  purchasePrice?: number; // öre
  purchaseDate?: Date;
  estimatedValue?: number; // öre
  gradingCompany?: string;
  grade?: string;
  notes?: string;
  imageUrl?: string;
}

export async function addCollectionItem(userId: string, input: CollectionItemInput) {
  if (input.cardId) {
    const card = await prisma.card.findUnique({ where: { id: input.cardId }, select: { id: true } });
    if (!card) throw new ServiceError(404, "Kortet hittades inte.");
  }
  if (input.productId) {
    const product = await prisma.product.findUnique({
      where: { id: input.productId },
      select: { id: true },
    });
    if (!product) throw new ServiceError(404, "Produkten hittades inte.");
  }
  const addQty = input.quantity ?? 1;
  // Stacka på befintlig identisk post istället för att skapa en ny (samma kort/produkt,
  // skick, språk och gradering = samma stack). ponytail: matchar på identitet, inte köppris.
  const existing = await prisma.collectionItem.findFirst({
    where: {
      userId,
      cardId: input.cardId ?? null,
      productId: input.productId ?? null,
      condition: input.condition ?? "NEAR_MINT", // matchar create-defaulten i schemat
      language: input.language ?? "EN",
      gradingCompany: input.gradingCompany ?? null,
      grade: input.grade ?? null,
    },
  });
  if (existing) {
    return prisma.collectionItem.update({
      where: { id: existing.id },
      data: { quantity: existing.quantity + addQty },
      include: COLLECTION_INCLUDE,
    });
  }
  return prisma.collectionItem.create({
    data: { userId, ...input, quantity: addQty },
    include: COLLECTION_INCLUDE,
  });
}

export async function updateCollectionItem(
  userId: string,
  itemId: string,
  input: Partial<CollectionItemInput>
) {
  const item = await prisma.collectionItem.findUnique({ where: { id: itemId } });
  if (!item || item.userId !== userId) {
    throw new ServiceError(404, "Samlingsobjektet hittades inte.");
  }
  return prisma.collectionItem.update({
    where: { id: itemId },
    data: input,
    include: COLLECTION_INCLUDE,
  });
}

export async function removeCollectionItem(userId: string, itemId: string) {
  const item = await prisma.collectionItem.findUnique({ where: { id: itemId } });
  if (!item || item.userId !== userId) {
    throw new ServiceError(404, "Samlingsobjektet hittades inte.");
  }
  await prisma.collectionItem.delete({ where: { id: itemId } });
  return { deleted: true };
}

/**
 * Aktuellt marknadsvärde per objekt (öre, per styck). Live Cardmarket-trend via
 * kortets/produktens lägsta pris; faller tillbaka på det lagrade `estimatedValue`
 * (ögonblicksbild vid tillägg) när live-data saknas. Returnerar en map itemId →
 * värde per styck (objekt utan känt värde utelämnas).
 */
export async function valueCollectionItems(
  items: {
    id: string;
    cardId: string | null;
    productId: string | null;
    estimatedValue: number | null;
  }[]
): Promise<Map<string, number>> {
  const cardIds = items.map((i) => i.cardId).filter((v): v is string => v != null);
  const productIds = items
    .map((i) => i.productId)
    .filter((v): v is string => v != null);

  const [cardValues, productValues] = await Promise.all([
    getCardValues(cardIds),
    getProductValues(productIds),
  ]);

  const result = new Map<string, number>();
  for (const item of items) {
    const live =
      (item.cardId != null ? cardValues.get(item.cardId) : undefined) ??
      (item.productId != null ? productValues.get(item.productId) : undefined);
    const value = live ?? item.estimatedValue ?? null;
    if (value != null) result.set(item.id, value);
  }
  return result;
}

export interface CollectionMover {
  id: string; // collection item-id
  name: string;
  imageUrl: string | null;
  setName: string | null;
  value: number | null; // aktuellt pris per styck (öre)
  percent: number; // 7-dagars prisförändring (%)
}

type Snap = { date: Date; avgPrice: number };
const SNAP_OFFER_SELECT = { price: true, stockStatus: true, url: true } as const;
const dayKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
/** Senaste avgPrice med datum <= `end`, annars äldsta tillgängliga (snaps är sorterade asc). */
function avgAtOrBefore(snaps: Snap[], end: number): number | null {
  let v: number | null = null;
  for (const s of snaps) {
    if (s.date.getTime() <= end) v = s.avgPrice;
    else break;
  }
  return v ?? (snaps[0]?.avgPrice ?? null);
}

/**
 * Beräknar samlingens värde, kostnad, vinst, top movers och värdeutveckling över tid.
 *
 * Värdeutvecklingen är portföljens MARKNADSVÄRDE per månad: för varje månad summeras
 * varje ägt objekts marknadsvärde DEN månaden (CM-trend ur priceSnapshots) × antal.
 * Objekt räknas med från sin inköpsmånad, så kurvan stiger när man lägger till objekt
 * OCH rör sig när objektens priser ändras (kan alltså gå både upp och ner). Innevarande
 * månad använder aktuellt värde så slutpunkten matchar "Totalt värde".
 */
export async function computeCollectionValue(
  userId: string,
  opts?: { maxDays?: number | null }
) {
  const items = await prisma.collectionItem.findMany({
    where: { userId },
    include: COLLECTION_INCLUDE,
  });

  // Live-värde per objekt (per styck), Cardmarket-trend med snapshot-fallback.
  const itemValues = await valueCollectionItems(items);
  const valueOf = (id: string): number | null => itemValues.get(id) ?? null;

  let totalValue = 0;
  let totalCost = 0;
  for (const item of items) {
    const v = valueOf(item.id);
    if (v != null) totalValue += v * item.quantity;
    if (item.purchasePrice != null) totalCost += item.purchasePrice * item.quantity;
  }
  const profit = totalValue - totalCost;
  const profitPercent =
    totalCost > 0 ? Math.round((profit / totalCost) * 10000) / 100 : null;

  const topItems = [...items]
    .filter((i) => valueOf(i.id) != null)
    .sort((a, b) => valueOf(b.id)! * b.quantity - valueOf(a.id)! * a.quantity)
    .slice(0, 5)
    .map((i) => ({
      id: i.id,
      name: i.card?.name ?? i.product?.title ?? "Okänt objekt",
      quantity: i.quantity,
      estimatedValue: valueOf(i.id),
      totalValue: (valueOf(i.id) ?? 0) * i.quantity,
    }));

  // ---- Prissnapshots per objekt (för historik + movers) ----
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const ownedFrom = (i: (typeof items)[number]) => startOfDay(i.purchaseDate ?? i.createdAt);
  const valued = items.filter((i) => valueOf(i.id) != null);

  const valueOverTime: { date: string; value: number }[] = [];
  let movers: CollectionMover[] = [];

  if (valued.length > 0) {
    const startDay = valued.map(ownedFrom).reduce((a, b) => (b < a ? b : a));
    const cardIds = valued.map((i) => i.cardId).filter((v): v is string => v != null);
    const productIds = valued.map((i) => i.productId).filter((v): v is string => v != null);
    const snapSelect = {
      where: { date: { gte: startDay } },
      select: { date: true, avgPrice: true },
      orderBy: { date: "asc" as const },
    };

    const [cardProducts, prods] = await Promise.all([
      cardIds.length
        ? prisma.product.findMany({
            where: { cardId: { in: cardIds } },
            select: { cardId: true, offers: { select: SNAP_OFFER_SELECT }, priceSnapshots: snapSelect },
          })
        : Promise.resolve([]),
      productIds.length
        ? prisma.product.findMany({
            where: { id: { in: productIds } },
            select: { id: true, offers: { select: SNAP_OFFER_SELECT }, priceSnapshots: snapSelect },
          })
        : Promise.resolve([]),
    ]);

    // Per kort: snapshots från produkten med lägst aktuellt pris (= getCardValues).
    const cardSnaps = new Map<string, Snap[]>();
    const cardPrice = new Map<string, number>();
    for (const p of cardProducts) {
      if (!p.cardId) continue;
      const { price } = computeLowestPrice(p.offers.filter((o) => isDirectOfferUrl(o.url)));
      if (price == null) continue;
      const prev = cardPrice.get(p.cardId);
      if (prev == null || price < prev) {
        cardPrice.set(p.cardId, price);
        cardSnaps.set(p.cardId, p.priceSnapshots);
      }
    }
    const prodSnaps = new Map<string, Snap[]>();
    for (const p of prods) prodSnaps.set(p.id, p.priceSnapshots);

    const snapsForItem = (i: (typeof items)[number]): Snap[] | undefined =>
      i.cardId ? cardSnaps.get(i.cardId) : i.productId ? prodSnaps.get(i.productId) : undefined;

    // Värdeutveckling: per objekt ANKRAS i dess AKTUELLA värde (samma källa som
    // "Totalt värde" → ingen klippa/enhetskrock), och CM-trenden används bara för
    // den RELATIVA rörelsen bakåt i tiden: värde(månad) = nuvärde × trend(månad)/trend(nu).
    // Objekt utan trend → platt på nuvärdet. Slutpunkten = summan av nuvärden = Totalt värde.
    const nowMs = Date.now();
    const valuedInfo = valued.map((i) => {
      const snaps = snapsForItem(i);
      const trendNow = snaps && snaps.length ? avgAtOrBefore(snaps, nowMs) : null;
      return {
        quantity: i.quantity,
        current: valueOf(i.id) ?? 0,
        from: ownedFrom(i).getTime(),
        snaps: snaps && snaps.length && trendNow && trendNow > 0 ? snaps : null,
        trendNow: trendNow ?? 0,
      };
    });

    const endMs = startOfDay(new Date()).getTime();
    // Plan-tak: gratis-användare ser bara de senaste maxDays dagarna (premium = full).
    const capStart =
      opts?.maxDays != null
        ? startOfDay(new Date(endMs - opts.maxDays * 86_400_000))
        : null;
    const seriesStart = capStart && capStart > startDay ? capStart : startDay;
    const cursor = new Date(seriesStart);
    while (cursor.getTime() <= endMs) {
      const dayEnd = new Date(
        cursor.getFullYear(),
        cursor.getMonth(),
        cursor.getDate(),
        23,
        59,
        59
      ).getTime();
      let total = 0;
      for (const v of valuedInfo) {
        if (v.from > cursor.getTime()) continue;
        let per = v.current;
        if (v.snaps) {
          const t = avgAtOrBefore(v.snaps, dayEnd);
          if (t != null) per = Math.round(v.current * (t / v.trendNow));
        }
        total += per * v.quantity;
      }
      valueOverTime.push({ date: dayKey(cursor), value: total });
      cursor.setDate(cursor.getDate() + 1);
    }

    // Top movers — störst 7-dagars prisökning (kräver ≥2 objekt i samlingen).
    if (items.length >= 2) {
      const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
      const list: CollectionMover[] = [];
      for (const i of valued) {
        const snaps = snapsForItem(i);
        if (!snaps || snaps.length < 2) continue;
        const latest = snaps[snaps.length - 1].avgPrice;
        const old = avgAtOrBefore(snaps, weekAgo);
        if (old == null || old <= 0) continue;
        const percent = Math.round(((latest - old) / old) * 10000) / 100;
        if (percent <= 0) continue;
        list.push({
          id: i.id,
          name: i.card?.name ?? i.product?.title ?? "Okänt objekt",
          imageUrl: i.imageUrl ?? i.card?.imageUrl ?? i.product?.imageUrl ?? null,
          setName: i.card?.set?.name ?? null,
          value: valueOf(i.id),
          percent,
        });
      }
      list.sort((a, b) => b.percent - a.percent);
      movers = list;
    }
  }

  return {
    itemCount: items.reduce((sum, i) => sum + i.quantity, 0),
    uniqueItems: items.length,
    totalValue,
    totalCost,
    profit,
    profitPercent,
    topItems,
    movers,
    valueOverTime,
    /** itemId → aktuellt värde per styck (öre). För live-priser i tabellen. */
    itemValues: Object.fromEntries(itemValues),
  };
}

// ---------- CSV ----------

const CSV_HEADERS = [
  "name",
  "quantity",
  "condition",
  "language",
  "purchasePrice",
  "purchaseDate",
  "estimatedValue",
  "gradingCompany",
  "grade",
  "notes",
] as const;

function csvEscape(value: string): string {
  if (/[",\n\r;]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/** Genererar en CSV-sträng av användarens samling. Priser i öre. */
export async function exportCollectionCsv(userId: string): Promise<string> {
  const items = await listCollection(userId);
  const lines = [CSV_HEADERS.join(",")];
  for (const item of items) {
    const name = item.card?.name ?? item.product?.title ?? "";
    lines.push(
      [
        csvEscape(name),
        String(item.quantity),
        item.condition,
        item.language,
        item.purchasePrice != null ? String(item.purchasePrice) : "",
        item.purchaseDate ? item.purchaseDate.toISOString().slice(0, 10) : "",
        item.estimatedValue != null ? String(item.estimatedValue) : "",
        csvEscape(item.gradingCompany ?? ""),
        csvEscape(item.grade ?? ""),
        csvEscape(item.notes ?? ""),
      ].join(",")
    );
  }
  return lines.join("\n");
}

const importRowSchema = z.object({
  name: z.string().min(1, "Namn krävs."),
  quantity: z.coerce.number().int().min(1).default(1),
  condition: z
    .enum(["MINT", "NEAR_MINT", "EXCELLENT", "GOOD", "PLAYED", "POOR", "SEALED"])
    .default("NEAR_MINT"),
  language: z.enum(["SV", "EN", "JP", "DE", "FR", "OTHER"]).default("EN"),
  purchasePrice: z.coerce.number().int().min(0).optional(),
  purchaseDate: z.coerce.date().optional(),
  estimatedValue: z.coerce.number().int().min(0).optional(),
  gradingCompany: z.string().max(50).optional(),
  grade: z.string().max(20).optional(),
  notes: z.string().max(1000).optional(),
});

export type ImportRow = z.input<typeof importRowSchema>;

export interface ImportResult {
  imported: number;
  errors: { row: number; message: string }[];
}

/**
 * Importerar samlingsrader. Validerar varje rad och returnerar fel per rad.
 * Giltiga rader skapas i en transaktion. Matchar kort på namn om möjligt.
 */
export async function importCollectionRows(
  userId: string,
  rows: unknown[]
): Promise<ImportResult> {
  const errors: { row: number; message: string }[] = [];
  const valid: { row: number; data: z.output<typeof importRowSchema> }[] = [];

  rows.forEach((raw, index) => {
    const parsed = importRowSchema.safeParse(raw);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      errors.push({
        row: index + 1,
        message: `Ogiltig rad: ${issue.path.join(".")} – ${issue.message}`,
      });
    } else {
      valid.push({ row: index + 1, data: parsed.data });
    }
  });

  if (valid.length === 0) return { imported: 0, errors };

  // Försök matcha kort på namn (best effort)
  const names = Array.from(new Set(valid.map((v) => v.data.name)));
  const cards = await prisma.card.findMany({
    where: { name: { in: names, mode: "insensitive" } },
    select: { id: true, name: true },
  });
  const cardByName = new Map(cards.map((c) => [c.name.toLowerCase(), c.id]));

  await prisma.$transaction(
    valid.map((v) =>
      prisma.collectionItem.create({
        data: {
          userId,
          cardId: cardByName.get(v.data.name.toLowerCase()),
          quantity: v.data.quantity,
          condition: v.data.condition,
          language: v.data.language,
          purchasePrice: v.data.purchasePrice,
          purchaseDate: v.data.purchaseDate,
          estimatedValue: v.data.estimatedValue,
          gradingCompany: v.data.gradingCompany,
          grade: v.data.grade,
          notes: v.data.notes
            ? v.data.notes
            : cardByName.has(v.data.name.toLowerCase())
              ? undefined
              : `Importerad: ${v.data.name}`,
        },
      })
    )
  );

  return { imported: valid.length, errors };
}
