/** Samlingstjänster: CRUD, värdering, CSV-export/-import. */
import { z } from "zod";
import { prisma } from "@/lib/db";
import { ServiceError } from "@/lib/errors";
import { getCardValues, getProductValues } from "@/services/products";
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
  return prisma.collectionItem.create({
    data: { userId, ...input, quantity: input.quantity ?? 1 },
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

/** Beräknar samlingens värde, kostnad, vinst och värdeutveckling över tid. */
export async function computeCollectionValue(userId: string) {
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

  // Enkel värdeutveckling: kumulativt nuvarande marknadsvärde per inköpsmånad.
  const dated = items
    .filter((i) => valueOf(i.id) != null)
    .map((i) => ({
      date: i.purchaseDate ?? i.createdAt,
      value: (valueOf(i.id) ?? 0) * i.quantity,
    }))
    .sort((a, b) => a.date.getTime() - b.date.getTime());

  const monthly = new Map<string, number>();
  let cumulative = 0;
  for (const d of dated) {
    cumulative += d.value;
    const key = `${d.date.getFullYear()}-${String(d.date.getMonth() + 1).padStart(2, "0")}`;
    monthly.set(key, cumulative);
  }
  const valueOverTime = Array.from(monthly.entries()).map(([month, value]) => ({
    month,
    value,
  }));

  return {
    itemCount: items.reduce((sum, i) => sum + i.quantity, 0),
    uniqueItems: items.length,
    totalValue,
    totalCost,
    profit,
    profitPercent,
    topItems,
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
