/**
 * Bygger om ALLA singelkorts Cardmarket-offers korrekt — pris OCH länk — utan
 * att förlita sig på den falska namn-matchningen som tidigare gav fel kort
 * (CM-katalogen saknar kortnummer; ~80 "Zekrom" med identiska attacknamn).
 *
 * Källa (per kort, nyckel = tcgExternalId — ingen variant-förväxling):
 *  - PRIS = pokemontcg.io cardmarket.prices.trendPrice (Cardmarket-MARKNADSPRIS)
 *    ur senaste PriceObservation.rawData (redan hämtat av importen — säkert,
 *    ingen rate-limit-risk). Vi använder TREND, inte lowPrice: lowPrice är
 *    Cardmarkets all-språk/all-skick-golv (en utländsk/skadad kopia) och
 *    underskattar grovt det engelska priset användaren ser (€1 vs €4 "From").
 *    Inget trendPrice → INGEN CM-mappning (t.ex. Celebrations-reprints) →
 *    CM-offern RADERAS (hellre ingen offer än fel pris/länk).
 *  - LÄNK = cachad exakt CM-slug (.cache/cm-resolved-urls.json, ?language=1).
 *    Saknas slug skrivs ALDRIG en bar redirect (den kan inte bära language=1):
 *    har produkten redan en offer uppdateras bara priset (länken lämnas åt
 *    resolver-jobbet att uppgradera), annars skippas den tills slug finns. Så
 *    visas aldrig en oengelsk CM-länk.
 *
 * Kör därför `npx tsx scripts/resolve-cm-urls.ts` (resumerbar, cachad) FÖRST så
 * att slug-cachen är komplett — då får ~alla singlar en exakt engelsk länk här.
 *
 * Kurs: live EUR→SEK via src/lib/exchange-rate (Frankfurter). EUR_SEK pinnar.
 *
 * Körs:  npx tsx scripts/rebuild-cm-singles.ts            (dry-run)
 *        APPLY=1 npx tsx scripts/rebuild-cm-singles.ts    (skriv)
 */
import { PrismaClient } from "@prisma/client";
import * as fs from "fs";
import * as path from "path";
import { getRatesOre } from "../src/lib/exchange-rate";

const prisma = new PrismaClient();
const APPLY = process.env.APPLY === "1";
const REDIRECT_CACHE = path.join(process.cwd(), ".cache", "cm-resolved-urls.json");

async function main() {
  const slugCache: Record<string, string> = (() => {
    try {
      return JSON.parse(fs.readFileSync(REDIRECT_CACHE, "utf8"));
    } catch {
      return {};
    }
  })();
  console.log(`Slug-cache: ${Object.keys(slugCache).length} exakta CM-länkar`);

  const { eurToOre } = await getRatesOre();
  console.log(`💱 Kurs: 1 EUR = ${(eurToOre / 100).toFixed(3)} SEK`);

  const cm = await prisma.retailer.findFirstOrThrow({ where: { name: "Cardmarket" }, select: { id: true } });

  // 1) trendPrice (öre) per produkt ur senaste rawData med cardmarket.trendPrice.
  const rows = await prisma.$queryRawUnsafe<{ productId: string; lowOre: number }[]>(`
    SELECT DISTINCT ON (po."productId")
      po."productId",
      ROUND((po."rawData"->'cardmarket'->'prices'->>'trendPrice')::numeric * ${eurToOre})::int AS "lowOre"
    FROM "PriceObservation" po
    WHERE po."rawData"->'cardmarket'->'prices'->>'trendPrice' IS NOT NULL
    ORDER BY po."productId", po."observedAt" DESC
  `);
  const lowByProduct = new Map(rows.map((r) => [r.productId, r.lowOre]));
  console.log(`Produkter med pokemontcg trendPrice (mappbara): ${lowByProduct.size}`);

  // 2) Alla singel-produkter med kort + ev. CM-offer.
  const products = await prisma.product.findMany({
    where: { category: "SINGLE_CARD", card: { tcgExternalId: { not: null } } },
    select: {
      id: true,
      card: { select: { tcgExternalId: true } },
      offers: { where: { retailerId: cm.id }, select: { id: true } },
    },
  });
  console.log(`Singlar med kort: ${products.length}`);

  // En offer SKRIVS bara med en exakt engelsk slug-länk (?language=1). Saknas
  // slug i cachen lägger vi ALDRIG en bar redirect (den kan inte bära
  // language=1) — har produkten redan en offer uppdaterar vi bara priset och
  // låter länken vara (resolver-jobbet uppgraderar den senare); saknas offer
  // skippar vi tills slug finns. Då visas aldrig en oengelsk CM-länk.
  let slugUpserts = 0;
  let priceOnly = 0;
  let skippedNoSlug = 0;
  let toDelete = 0;
  const upserts: { productId: string; offerId?: string; url: string; price: number }[] = [];
  const priceUpdates: { offerId: string; price: number }[] = [];
  const deletes: string[] = [];

  for (const p of products) {
    const tcgId = p.card!.tcgExternalId!;
    const low = lowByProduct.get(p.id);
    const existing = p.offers[0]?.id;

    if (low != null && low > 0) {
      const slug = slugCache[tcgId];
      if (slug) {
        upserts.push({ productId: p.id, offerId: existing, url: slug, price: low });
        slugUpserts++;
      } else if (existing) {
        priceUpdates.push({ offerId: existing, price: low });
        priceOnly++;
      } else {
        skippedNoSlug++;
      }
    } else if (existing) {
      deletes.push(existing);
      toDelete++;
    }
  }

  console.log(`\nPlan: ${slugUpserts} offers med exakt engelsk slug-länk (pris + länk)`);
  console.log(`      ${priceOnly} befintliga offers får bara nytt pris (slug saknas än — länk orörd)`);
  console.log(`      ${skippedNoSlug} skippade (varken slug eller befintlig offer — väntar på resolver)`);
  console.log(`      ${toDelete} falska/omappbara CM-offers raderas.`);

  if (!APPLY) {
    console.log("\nDry-run. Kör med APPLY=1 för att skriva.");
    return;
  }

  let done = 0;
  for (const u of upserts) {
    if (u.offerId) {
      await prisma.offer.update({
        where: { id: u.offerId },
        data: { url: u.url, price: u.price, stockStatus: "IN_STOCK", lastSeenAt: new Date() },
      });
    } else {
      await prisma.offer.create({
        data: {
          productId: u.productId,
          retailerId: cm.id,
          url: u.url,
          price: u.price,
          currency: "SEK",
          condition: "NEAR_MINT",
          language: "EN",
          stockStatus: "IN_STOCK",
        },
      });
    }
    if (++done % 2000 === 0) console.log(`  upsertade ${done}/${upserts.length}`);
  }
  for (const pu of priceUpdates) {
    await prisma.offer.update({
      where: { id: pu.offerId },
      data: { price: pu.price, lastSeenAt: new Date() },
    });
  }
  for (let i = 0; i < deletes.length; i += 500) {
    await prisma.offer.deleteMany({ where: { id: { in: deletes.slice(i, i + 500) } } });
  }
  console.log(`\nKlart: ${done} slug-offers, ${priceUpdates.length} prisuppdaterade, ${deletes.length} raderade.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
