/**
 * Tradera sålt-synk: tar bort (eller minskar antalet på) samlingsobjekt vars
 * Tradera-annons har sålts. En annons kopplas till objektet via
 * CollectionItem.traderaItemId (sätts när objektet läggs ut, se api/tradera/sell).
 *
 * "Sålt" = objektet dyker upp i säljarens transaktioner (GET seller-transactions).
 * Körs schemalagt (GitHub Actions) — bara HTTP + små DB-skrivningar.
 */
import { prisma } from "@/lib/db";

const stripQuotes = (v: string) => v.trim().replace(/^["']|["']$/g, "");
const APP_ID = stripQuotes(process.env.TRADERA_APP_ID ?? "");
const APP_KEY = stripQuotes(process.env.TRADERA_APP_KEY ?? "");
const BASE = "https://api.tradera.com";

interface Transaction {
  item?: { id?: number };
  amount?: number; // transaktionsbelopp i hela kronor (brutto, före avgifter)
  date?: string;
}

export interface SoldInfo {
  salePriceOre: number;
  soldAt: Date;
}

/** Bygger en karta objekt-id → försäljningsinfo ur en transaktionslista. */
export function salesByItemId(transactions: Transaction[]): Map<string, SoldInfo> {
  const map = new Map<string, SoldInfo>();
  for (const t of transactions) {
    const id = t.item?.id;
    if (id == null) continue;
    map.set(String(id), {
      salePriceOre: Math.round((t.amount ?? 0) * 100), // kr → öre
      soldAt: t.date ? new Date(t.date) : new Date(),
    });
  }
  return map;
}

/** Hämtar sålda objekt (id → pris/datum) för en säljare de senaste `days` dagarna. */
async function fetchSales(
  userId: string,
  token: string,
  days: number
): Promise<Map<string, SoldInfo>> {
  const minDate = new Date(Date.now() - days * 86_400_000).toISOString();
  const res = await fetch(
    `${BASE}/v4/listings/seller-transactions?minTransactionDate=${encodeURIComponent(minDate)}`,
    {
      headers: {
        "X-App-Id": APP_ID,
        "X-App-Key": APP_KEY,
        "X-User-Id": userId,
        "X-User-Token": token,
      },
    }
  );
  if (!res.ok) {
    throw new Error(`seller-transactions HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  return salesByItemId((await res.json()) as Transaction[]);
}

/**
 * Synkar EN användares sålda annonser → tar bort matchande samlingsobjekt.
 * Snabb no-op när användaren inte har några utlagda objekt (ingen Tradera-anrop).
 * Används både av det dagliga jobbet och on-demand vid portföljvisning.
 */
export async function syncSoldCollectionItems(
  userId: string,
  { days = 60 }: { days?: number } = {}
): Promise<{ removed: number }> {
  if (!APP_ID || !APP_KEY) return { removed: 0 };

  const listed = await prisma.collectionItem.findMany({
    where: { userId, traderaItemId: { not: null } },
    select: {
      id: true,
      quantity: true,
      traderaItemId: true,
      traderaQuantity: true,
      condition: true,
      language: true,
      purchasePrice: true,
      imageUrl: true,
      notes: true,
      card: { select: { name: true, imageUrl: true, set: { select: { name: true } } } },
      product: { select: { title: true, imageUrl: true } },
    },
  });
  if (listed.length === 0) return { removed: 0 }; // inget utlagt → hoppa Tradera-anropet

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { traderaUserId: true, traderaToken: true, traderaTokenExpiresAt: true },
  });
  if (!user?.traderaUserId || !user.traderaToken) return { removed: 0 };
  if (user.traderaTokenExpiresAt && user.traderaTokenExpiresAt < new Date()) return { removed: 0 };

  const sales = await fetchSales(user.traderaUserId, user.traderaToken, days);

  // EN annons kan gälla FLERA poster (2026-10-05: "4 st" i samma annons). Gruppera på
  // annonsnumret ⇒ EN Sale per annons med hela beloppet, och varje post tappar exakt
  // de exemplar den hade i annonsen (`traderaQuantity`; NULL = äldre annons = 1).
  const byListing = new Map<string, typeof listed>();
  for (const it of listed) {
    if (!it.traderaItemId) continue;
    byListing.set(it.traderaItemId, [...(byListing.get(it.traderaItemId) ?? []), it]);
  }

  let removed = 0;
  for (const [traderaItemId, rows] of byListing) {
    const sale = sales.get(traderaItemId);
    if (!sale) continue;
    const first = rows[0];
    const copiesOf = (r: (typeof rows)[number]) => Math.min(r.traderaQuantity ?? 1, r.quantity);
    const count = rows.reduce((n, r) => n + copiesOf(r), 0);
    const baseName = first.card?.name ?? first.product?.title ?? first.notes ?? "Okänt objekt";
    // Kostnadsbasen är summan BARA när varje exemplar har ett pris — en delsumma
    // hade gett en påhittad vinst.
    const allCosted = rows.every((r) => r.purchasePrice != null);

    // Ögonblicksbild av det sålda objektet (överlever att kortet tas ur samlingen).
    await prisma.sale.create({
      data: {
        userId,
        name: count > 1 ? `${count} × ${baseName}` : baseName,
        setName: first.card?.set?.name ?? null,
        imageUrl: first.imageUrl ?? first.card?.imageUrl ?? first.product?.imageUrl ?? null,
        condition: first.condition,
        language: first.language,
        purchasePriceOre: allCosted
          ? rows.reduce((sum, r) => sum + r.purchasePrice! * copiesOf(r), 0)
          : null,
        salePriceOre: sale.salePriceOre,
        soldAt: sale.soldAt,
        traderaItemId,
      },
    });

    for (const it of rows) {
      const sold = copiesOf(it);
      if (it.quantity > sold) {
        // Fler exemplar än annonsen gällde: minska och nollställ kopplingen.
        await prisma.collectionItem.update({
          where: { id: it.id },
          data: { quantity: it.quantity - sold, traderaItemId: null, traderaQuantity: null },
        });
      } else {
        await prisma.collectionItem.delete({ where: { id: it.id } });
      }
    }
    removed += count;
  }
  return { removed };
}

/** Dagligt jobb: kör sålt-synk för alla användare med utlagda objekt. */
export async function runTraderaSoldSync({ days = 60 }: { days?: number } = {}) {
  if (!APP_ID || !APP_KEY) {
    console.log("[tradera-sold-sync] TRADERA_APP_ID/KEY saknas — hoppar över.");
    return { removed: 0 };
  }

  const users = await prisma.collectionItem.findMany({
    where: { traderaItemId: { not: null }, user: { traderaToken: { not: null } } },
    select: { userId: true },
    distinct: ["userId"],
  });

  let removed = 0;
  for (const { userId } of users) {
    try {
      removed += (await syncSoldCollectionItems(userId, { days })).removed;
    } catch (e) {
      console.error(`[tradera-sold-sync] hämtning misslyckades för användare ${userId}:`, e);
    }
  }

  console.log(`[tradera-sold-sync] klart — ${removed} objekt borttagna/minskade.`);
  return { removed };
}
