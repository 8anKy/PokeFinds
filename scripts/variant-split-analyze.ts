/**
 * Hittar SINGLE_CARD-produkter som ska delas i common + specialvariant (Option C).
 *
 * Två steg (billigt → dyrt):
 *  1) DB-filter: CM-offer med versionerad slug (-V\d-), en dyr snapshot FÖRE
 *     18 juni (>= MIN_VARIANT öre) och nuvarande From <= 1/10 av den (kollaps).
 *  2) Källdivergens: hämta pokemontcg.io-trend för kortet. Dela BARA om
 *     trend >= From*10 OCH trend >= MIN_VARIANT — då pekar källorna på OLIKA
 *     CM-produkter (= äkta common/variant). Utesluter enskilt dyra kort
 *     (Charizard-GX m.fl.) där trend ≈ From (gammal data var bara skräp).
 *
 * Default = torrkörning (listar). APPLY=1 → delar på riktigt (se variant-split-apply).
 */
import { PrismaClient } from "@prisma/client";
import { fetchTcgCardById, cardMarketPriceOre } from "../src/scrapers/adapters/pokemontcg-adapter";
import { getRatesOre } from "../src/lib/exchange-rate";

const db = new PrismaClient();
const MIN_VARIANT = 5000; // 50 kr — varianten ska vara genuint värdefull
const CUTOFF = new Date("2026-06-18T00:00:00Z");

export interface Candidate {
  productId: string;
  slug: string;
  title: string;
  setName: string | null;
  tcgId: string;
  cmOfferId: string;
  cmUrl: string;
  fromOre: number;
  trendOre: number;
}

export async function findCandidates(): Promise<Candidate[]> {
  await getRatesOre();
  const cm = await db.retailer.findFirst({ where: { name: "Cardmarket" }, select: { id: true } });
  if (!cm) return [];

  // Steg 1 — DB.
  const products = await db.product.findMany({
    where: {
      category: "SINGLE_CARD",
      variantLabel: null,
      card: { tcgExternalId: { not: null } },
      offers: { some: { retailerId: cm.id, url: { contains: "-V" } } },
    },
    select: {
      id: true, slug: true, title: true,
      set: { select: { name: true } },
      card: { select: { tcgExternalId: true } },
      offers: { where: { retailerId: cm.id }, select: { id: true, price: true, url: true } },
    },
  });

  const stage1: { p: (typeof products)[number]; from: number; cmOffer: { id: string; url: string } }[] = [];
  for (const p of products) {
    const cmOffer = p.offers.find((o) => /-V\d-/.test(o.url ?? ""));
    if (!cmOffer?.url || cmOffer.price == null) continue;
    const oldMax = await db.priceSnapshot.findFirst({
      where: { productId: p.id, date: { lt: CUTOFF } },
      orderBy: { avgPrice: "desc" }, select: { avgPrice: true },
    });
    const oldAvg = oldMax?.avgPrice ?? 0;
    if (oldAvg >= MIN_VARIANT && cmOffer.price > 0 && oldAvg >= cmOffer.price * 10) {
      stage1.push({ p, from: cmOffer.price, cmOffer: { id: cmOffer.id, url: cmOffer.url } });
    }
  }

  // Steg 2 — källdivergens via pokemontcg.io.
  const out: Candidate[] = [];
  for (const { p, from, cmOffer } of stage1) {
    const card = await fetchTcgCardById(p.card!.tcgExternalId!);
    const trend = card ? cardMarketPriceOre(card) : null;
    if (trend == null || trend < MIN_VARIANT || trend < from * 10) continue;
    out.push({
      productId: p.id, slug: p.slug, title: p.title, setName: p.set?.name ?? null,
      tcgId: p.card!.tcgExternalId!, cmOfferId: cmOffer.id, cmUrl: cmOffer.url,
      fromOre: from, trendOre: trend,
    });
  }
  return out;
}

if (process.env.APPLY !== "1") {
  findCandidates()
    .then((c) => {
      console.log(`\n${c.length} äkta common/variant-kandidater (källorna divergerar):\n`);
      for (const x of c.sort((a, b) => b.trendOre - a.trendOre)) {
        console.log(`  ${(x.trendOre / 100).toFixed(0)}kr (trend) vs ${(x.fromOre / 100).toFixed(2)}kr (From) | ${x.setName} · ${x.title}`);
      }
    })
    .finally(() => db.$disconnect());
}
