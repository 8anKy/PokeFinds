/**
 * BIGGEST-DROPS-REVISION: reproducerar katalogens "Prisfall"-sortering (`sort=biggest_drop`)
 * och dumpar, per topp-produkt, allt man behöver för att avgöra om fallet är ÄKTA eller
 * ett datafel:
 *
 *   - 7d-snapshotserien (samma fönster/formel som `computePriceChange7d`)
 *   - varje synlig offer (butik, pris, lager, URL) — dvs det som sätter headline
 *   - kort-identitet (tcgid, cardmarketId, rarity) + senaste PriceObservation-källor
 *
 * Bakgrund: prisfalls-listan är en FELDETEKTOR. Ett fall >50 % på 7 dagar är nästan
 * alltid antingen (a) en marknadsplatsannons på ett spelat/öppnat ex som fått låtsas
 * vara NM, (b) en fellänkad CM-idProduct, eller (c) en glitchad/bulk-golvad CM-From.
 *
 * Fallet räknas i SQL över HELA katalogen (inte bara katalogens 500-kandidatfönster),
 * så systemfel syns även utanför det användaren råkar se.
 *
 *   node scripts/with-prod-db.mjs npx tsx scripts/biggest-drops-audit.ts
 *   node scripts/with-prod-db.mjs npx tsx scripts/biggest-drops-audit.ts --limit=60 --min-drop=50
 */
import { PrismaClient, type StockStatus } from "@prisma/client";

const prisma = new PrismaClient();

const arg = (name: string, def: number) => {
  const m = process.argv.find((a) => a.startsWith(`--${name}=`));
  return m ? Number(m.split("=")[1]) : def;
};
const LIMIT = arg("limit", 40);
const MIN_DROP = arg("min-drop", 30); // procent (positivt tal = fall)

const kr = (ore: number | null) => (ore === null ? "–" : `${(ore / 100).toFixed(0)} kr`);

/** Speglar isDirectOfferUrl() (src/lib/marketplace-urls.ts). */
function isDirect(url: string): boolean {
  const u = url.toLowerCase();
  return !(
    u.includes("/search") ||
    u.includes("searchstring=") ||
    u.includes("sokstr=") ||
    u.includes("funk=sok") ||
    u.includes("?query=") ||
    u.includes("&query=") ||
    u.includes("?q=") ||
    u.includes("&q=") ||
    u.includes("prices.pokemontcg.io/cardmarket")
  );
}

async function main() {
  const db = await prisma.$queryRaw<{ current_database: string }[]>`SELECT current_database()`;
  console.log(`DB: ${db[0].current_database}\n`);

  // Samma fönster/formel som computePriceChange7d: äldsta vs nyaste snapshot inom 7 dgr.
  const drops = await prisma.$queryRawUnsafe<
    { productId: string; oldDate: Date; oldPrice: number; newDate: Date; newPrice: number; pct: number; n: number }[]
  >(
    `
    WITH s AS (
      SELECT "productId", date, "avgPrice",
             ROW_NUMBER() OVER (PARTITION BY "productId" ORDER BY date ASC)  AS rn_first,
             ROW_NUMBER() OVER (PARTITION BY "productId" ORDER BY date DESC) AS rn_last,
             COUNT(*)    OVER (PARTITION BY "productId")                     AS n
      FROM "PriceSnapshot"
      WHERE date >= date_trunc('day', now() - interval '7 days')
    ),
    agg AS (
      SELECT f."productId",
             f.date AS "oldDate", f."avgPrice" AS "oldPrice",
             l.date AS "newDate", l."avgPrice" AS "newPrice",
             f.n
      FROM s f JOIN s l ON l."productId" = f."productId" AND l.rn_last = 1
      WHERE f.rn_first = 1 AND f.n >= 2 AND f."avgPrice" > 0
    )
    SELECT a.*, round(((a."newPrice" - a."oldPrice")::numeric / a."oldPrice") * 100, 2)::float AS pct
    FROM agg a
    JOIN "Product" p ON p.id = a."productId"
    WHERE p."lowestPriceOre" IS NOT NULL
      AND p.category NOT IN ('ACCESSORY','GRADED_CARD','OTHER')
      AND p.language IN ('EN','JP')
      AND a."newPrice" <= a."oldPrice" * (1 - $1::float / 100)
    ORDER BY pct ASC
    LIMIT $2::int
  `,
    MIN_DROP,
    LIMIT
  );

  console.log(`=== PRISFALL ≥${MIN_DROP}% (7 dgr, HELA katalogen) — ${drops.length} träffar ===\n`);
  if (drops.length === 0) {
    await prisma.$disconnect();
    return;
  }

  const ids = drops.map((d) => d.productId);
  const [products, series, obs] = await Promise.all([
    prisma.product.findMany({
      where: { id: { in: ids } },
      include: {
        set: { select: { name: true } },
        card: { select: { tcgExternalId: true, cardmarketId: true, rarity: true } },
        offers: {
          select: {
            id: true,
            price: true,
            stockStatus: true,
            url: true,
            updatedAt: true,
            retailer: { select: { name: true } },
          },
        },
      },
    }),
    prisma.priceSnapshot.findMany({
      where: { productId: { in: ids }, date: { gte: new Date(Date.now() - 8 * 864e5) } },
      select: { productId: true, date: true, avgPrice: true },
      orderBy: { date: "asc" },
    }),
    prisma.priceObservation.findMany({
      where: { productId: { in: ids }, observedAt: { gte: new Date(Date.now() - 8 * 864e5) } },
      select: { productId: true, observedAt: true, price: true, source: true },
      orderBy: { observedAt: "desc" },
    }),
  ]);

  const byId = new Map(products.map((p) => [p.id, p]));
  const seriesById = new Map<string, typeof series>();
  for (const s of series) (seriesById.get(s.productId) ?? seriesById.set(s.productId, []).get(s.productId)!).push(s);
  const obsById = new Map<string, typeof obs>();
  for (const o of obs) (obsById.get(o.productId) ?? obsById.set(o.productId, []).get(o.productId)!).push(o);

  for (const d of drops) {
    const p = byId.get(d.productId);
    if (!p) continue;
    const visible = p.offers.filter((o) => isDirect(o.url));
    const priced = visible.filter((o) => o.price !== null && o.price > 0) as {
      id: string;
      price: number;
      stockStatus: StockStatus;
      url: string;
      updatedAt: Date;
      retailer: { name: string };
    }[];
    const inStock = priced.filter((o) => o.stockStatus === "IN_STOCK");
    const pool = inStock.length > 0 ? inStock : priced;
    const headline = pool.length ? pool.reduce((a, b) => (b.price < a.price ? b : a)) : null;

    console.log(`${d.pct.toFixed(1).padStart(7)}%  ${p.title}`);
    console.log(`          /produkter/${p.slug}   [${p.category} ${p.language}]  set=${p.set?.name ?? "–"}`);
    console.log(
      `          tcgid=${p.card?.tcgExternalId ?? "–"}  card.cardmarketId=${p.card?.cardmarketId ?? "–"}  rarity=${
        p.card?.rarity ?? "–"
      }  gtin=${p.gtin ?? "–"}  variant=${p.variantLabel ?? "–"}`
    );
    console.log(
      `          serie: ${(seriesById.get(p.id) ?? [])
        .map((s) => `${s.date.toISOString().slice(5, 10)}=${(s.avgPrice / 100).toFixed(0)}`)
        .join("  ")}`
    );
    const o7 = (obsById.get(p.id) ?? []).slice(0, 6);
    if (o7.length)
      console.log(
        `          obs:   ${o7
          .map((o) => `${o.observedAt.toISOString().slice(5, 10)} ${o.source}=${(o.price / 100).toFixed(0)}`)
          .join("  |  ")}`
      );
    console.log(`          headline: ${headline ? `${headline.retailer.name} ${kr(headline.price)}` : "–"}`);
    for (const o of priced.sort((a, b) => a.price - b.price)) {
      const mark = headline && o.id === headline.id ? "→" : " ";
      console.log(
        `          ${mark} ${o.retailer.name.padEnd(14)} ${kr(o.price).padStart(9)}  ${o.stockStatus.padEnd(
          12
        )} ${o.url.slice(0, 100)}`
      );
    }
    console.log();
  }

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
