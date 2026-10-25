/** Bevakningslista: lista, lägg till, uppdatera, ta bort. */
import { FREE_RESTOCK_ALERT_LIMIT } from "@/lib/free-restock-alert";
import { prisma } from "@/lib/db";
import { headlineCandidates } from "@/lib/offer-source";
import { isDirectOfferUrl } from "@/lib/marketplace-urls";
import { ServiceError } from "@/lib/errors";
import type { PlanTier } from "@prisma/client";

/**
 * Hur många produkter ett gratiskonto får spara (ägarbeslut 2026-08-06: 10 → 5).
 *
 * ⛔ TALET ÄR PUBLICERAT. Det står i prissidans funktionslista och i startsidans
 * FAQ, på BÅDA språken, som fri text utan koppling hit — ändras konstanten utan
 * att copyn följer med säljer vi en gräns vi inte håller. `tests/unit/
 * watchlist-limit-copy-sync.test.ts` läser båda messages-filerna och failar om
 * de säger något annat än det här talet. Samma vaktmönster som bulk-cap-sync.
 *
 * Sänkningen RADERAR ingenting: befintliga poster ligger kvar, gränsen bromsar
 * bara nya tillägg (`count >= LIMIT` nedan). En användare som redan har 8 kvar
 * behåller sina 8 och kan lägga till igen när hen tagit bort ner till 4.
 */
import { FREE_PLAN_WATCHLIST_LIMIT } from "@/lib/watchlist-limits";
export { FREE_PLAN_WATCHLIST_LIMIT };

/**
 * ⛔ `select`, ALDRIG `include` PÅ `product` (2026-08-05). `withLowestPrice` nedan
 * sprider HELA produktraden vidare till svaret, så ett bart `include` skickade med
 * `description` (fritext, kan vara flera kB), `normalizedTitle`, `gtin*`, samtliga
 * räknare och tidsstämplar — inget av det läses av vare sig bevakningssidan eller
 * någon klient. Fälten nedan är precis de som används:
 *   id (product-actions.tsx "bevakas redan"-kollen — RAW fetch, hand-typad, så ett
 *      borttaget id blir en TYST `false` utan kompileringsfel), title, slug,
 *   imageUrl, category (ikonvalet), set.name (undertexten) samt offers, som
 *   `withLowestPrice` förbrukar och sedan strippar.
 * Lägg till fält här när en anropare behöver dem; lägg ALDRIG tillbaka `include`.
 */
const WATCHLIST_INCLUDE = {
  product: {
    select: {
      id: true,
      title: true,
      slug: true,
      imageUrl: true,
      category: true,
      set: { select: { id: true, name: true } },
      offers: { select: { price: true, stockStatus: true, url: true, retailerId: true } },
    },
  },
} as const;

function withLowestPrice<
  T extends {
    product: { offers: { price: number | null; stockStatus: string; url?: string | null; retailerId?: string }[] };
  }
>(item: T) {
  const offers = headlineCandidates(item.product.offers).filter(
    (o): o is { price: number; stockStatus: string } => o.price !== null
  );
  const inStock = offers.filter((o) => o.stockStatus === "IN_STOCK");
  const pool = inStock.length > 0 ? inStock : offers;
  const lowestPrice =
    pool.length > 0 ? Math.min(...pool.map((o) => o.price)) : null;
  // "I lager hos N" på bevakningskortet (2026-10-25): butiker med en KÖPBAR offer —
  // i lager, direktlänk, > 0 kr. Samma köpbarhet som rubrikpriset.
  const inStockCount = new Set(
    item.product.offers
      .filter((o) => o.stockStatus === "IN_STOCK" && o.price != null && o.price > 0 && isDirectOfferUrl(o.url))
      .map((o) => o.retailerId ?? o.url)
  ).size;
  const { offers: _offers, ...product } = item.product;
  return { ...item, product: { ...product, lowestPrice, inStockCount } };
}

export async function listWatchlist(userId: string) {
  const items = await prisma.watchlistItem.findMany({
    where: { userId },
    include: WATCHLIST_INCLUDE,
    orderBy: { createdAt: "desc" },
  });
  return items.map(withLowestPrice);
}

export interface AddWatchlistInput {
  productId: string;
  targetPrice?: number;
  maxPrice?: number;
  restockAlert?: boolean;
  priceAlert?: boolean;
  channels?: string[];
}

export async function addWatchlistItem(
  userId: string,
  planTier: PlanTier,
  input: AddWatchlistInput
) {
  const product = await prisma.product.findUnique({
    where: { id: input.productId },
    select: { id: true },
  });
  if (!product) throw new ServiceError(404, "Produkten hittades inte.");

  const existing = await prisma.watchlistItem.findUnique({
    where: { userId_productId: { userId, productId: input.productId } },
  });
  if (existing) {
    throw new ServiceError(409, "Produkten finns redan i din bevakningslista.");
  }

  if (planTier === "FREE") {
    const count = await prisma.watchlistItem.count({ where: { userId } });
    if (count >= FREE_PLAN_WATCHLIST_LIMIT) {
      throw new ServiceError(
        403,
        // Talet står i meddelandet: en spärr som inte säger VAR gränsen går
        // lämnar användaren att gissa hur mycket som måste bort.
        `Gratiskontot rymmer ${FREE_PLAN_WATCHLIST_LIMIT} bevakningar. Ta bort en eller uppgradera till Pro för obegränsat.`
      );
    }
  }

  // GRATISKONTOTS ENDA RESTOCK-LARM (lib/free-restock-alert.ts): finns redan ett
  // objekt med larmet på svarar vi `restockAlertDenied` så paywallen öppnas — men
  // VALET SPARAS som det gjordes. ⛔ Skriv aldrig om det till false (2026-10-25):
  // då låg alla utom första bevakningen utan larm även efter köpt Pro/provperiod,
  // och ingen slog på dem igen. Taket dömer vid larmtillfället (`restockWatchersFor`
  // tar bara det äldsta för Free), så Pro slår på resten utan att något skrivs om.
  const restockAlert = input.restockAlert ?? true;
  let restockAlertDenied = false;
  if (planTier === "FREE" && restockAlert) {
    const withAlert = await prisma.watchlistItem.count({ where: { userId, restockAlert: true } });
    restockAlertDenied = withAlert >= FREE_RESTOCK_ALERT_LIMIT;
  }

  const item = await prisma.watchlistItem.create({
    data: {
      userId,
      productId: input.productId,
      targetPrice: input.targetPrice,
      maxPrice: input.maxPrice,
      restockAlert,
      priceAlert: input.priceAlert ?? true,
      ...(input.channels ? { channels: input.channels } : {}),
    },
    include: WATCHLIST_INCLUDE,
  });
  return { ...withLowestPrice(item), restockAlertDenied };
}

export interface UpdateWatchlistInput {
  targetPrice?: number | null;
  maxPrice?: number | null;
  restockAlert?: boolean;
  priceAlert?: boolean;
  isPaused?: boolean;
  channels?: string[];
}

export async function updateWatchlistItem(
  userId: string,
  itemId: string,
  input: UpdateWatchlistInput,
  // Planen behövs bara för restock-spärren; utelämnad = ingen spärr (interna anrop).
  planTier: PlanTier = "PREMIUM"
) {
  const item = await prisma.watchlistItem.findUnique({ where: { id: itemId } });
  if (!item || item.userId !== userId) {
    throw new ServiceError(404, "Bevakningen hittades inte.");
  }
  // Gratiskontot slår PÅ larmet på ett andra objekt → sparas ändå (samma skäl som
  // i addWatchlistItem) och svaret bär `restockAlertDenied`, klienten öppnar
  // paywall-arket. Felkoden FREE_RESTOCK_ALERT_LIMIT kastas inte längre men ligger
  // kvar i klienterna för äldre svar.
  let restockAlertDenied = false;
  if (planTier === "FREE" && input.restockAlert === true && !item.restockAlert) {
    const others = await prisma.watchlistItem.count({
      where: { userId, restockAlert: true, id: { not: itemId } },
    });
    restockAlertDenied = others >= FREE_RESTOCK_ALERT_LIMIT;
  }
  const updated = await prisma.watchlistItem.update({
    where: { id: itemId },
    data: {
      targetPrice: input.targetPrice,
      maxPrice: input.maxPrice,
      restockAlert: input.restockAlert,
      priceAlert: input.priceAlert,
      isPaused: input.isPaused,
      ...(input.channels ? { channels: input.channels } : {}),
    },
    include: WATCHLIST_INCLUDE,
  });
  return { ...withLowestPrice(updated), restockAlertDenied };
}

/** Bara produkt-id:na — det klockan i produktkortet behöver för att rita rätt läge. */
export async function listWatchedProductIds(userId: string): Promise<string[]> {
  const rows = await prisma.watchlistItem.findMany({
    where: { userId },
    select: { productId: true },
  });
  return rows.map((r) => r.productId);
}

/**
 * Ta bort nycklad på PRODUKT, inte på bevakningsradens id.
 *
 * Klockan i produktkortet känner produkten men aldrig radens id, och att slå upp
 * id:t först vore en extra rundtur för en rad vi kan peka ut unikt ändå
 * (`@@unique([userId, productId])`). Samma skäl som `removeSetWatch`.
 */
export async function removeWatchlistItemByProduct(userId: string, productId: string) {
  const { count } = await prisma.watchlistItem.deleteMany({ where: { userId, productId } });
  if (count === 0) throw new ServiceError(404, "Bevakningen hittades inte.");
  return { deleted: true };
}

export async function removeWatchlistItem(userId: string, itemId: string) {
  const item = await prisma.watchlistItem.findUnique({ where: { id: itemId } });
  if (!item || item.userId !== userId) {
    throw new ServiceError(404, "Bevakningen hittades inte.");
  }
  await prisma.watchlistItem.delete({ where: { id: itemId } });
  return { deleted: true };
}
