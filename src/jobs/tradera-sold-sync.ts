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
}

/** Plockar ut sålda objekt-ids (som strängar) ur en transaktionslista. */
export function soldItemIdsFrom(transactions: Transaction[]): Set<string> {
  return new Set(
    transactions
      .map((t) => t.item?.id)
      .filter((id): id is number => id != null)
      .map(String)
  );
}

/** Hämtar sålda objekt-ids för en säljare de senaste `days` dagarna. */
async function fetchSoldItemIds(
  userId: string,
  token: string,
  days: number
): Promise<Set<string>> {
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
  return soldItemIdsFrom((await res.json()) as Transaction[]);
}

export async function runTraderaSoldSync({ days = 60 }: { days?: number } = {}) {
  if (!APP_ID || !APP_KEY) {
    console.log("[tradera-sold-sync] TRADERA_APP_ID/KEY saknas — hoppar över.");
    return { removed: 0 };
  }

  // Användare som har (a) minst ett utlagt objekt och (b) en giltig token.
  const items = await prisma.collectionItem.findMany({
    where: {
      traderaItemId: { not: null },
      user: { traderaToken: { not: null } },
    },
    select: {
      id: true,
      quantity: true,
      traderaItemId: true,
      userId: true,
      user: { select: { traderaUserId: true, traderaToken: true, traderaTokenExpiresAt: true } },
    },
  });

  // Gruppera per användare (en transactions-hämtning per användare).
  const byUser = new Map<string, typeof items>();
  for (const it of items) {
    const list = byUser.get(it.userId) ?? [];
    list.push(it);
    byUser.set(it.userId, list);
  }

  let removed = 0;
  for (const [, userItems] of byUser) {
    const u = userItems[0].user;
    if (!u.traderaUserId || !u.traderaToken) continue;
    if (u.traderaTokenExpiresAt && u.traderaTokenExpiresAt < new Date()) continue;

    let sold: Set<string>;
    try {
      sold = await fetchSoldItemIds(u.traderaUserId, u.traderaToken, days);
    } catch (e) {
      console.error(`[tradera-sold-sync] hämtning misslyckades för ${u.traderaUserId}:`, e);
      continue;
    }

    for (const it of userItems) {
      if (!it.traderaItemId || !sold.has(it.traderaItemId)) continue;
      if (it.quantity > 1) {
        // Flera exemplar: minska antalet och nollställ kopplingen (annonsen är slut).
        await prisma.collectionItem.update({
          where: { id: it.id },
          data: { quantity: it.quantity - 1, traderaItemId: null },
        });
      } else {
        await prisma.collectionItem.delete({ where: { id: it.id } });
      }
      removed++;
    }
  }

  console.log(`[tradera-sold-sync] klart — ${removed} objekt borttagna/minskade.`);
  return { removed };
}
