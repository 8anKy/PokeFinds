/**
 * Delar de kandidater findCandidates() hittar i common + specialvariant (Option C).
 * Per kort: befintlig produkt (dyr historik + variant-CM-länk) blir VARIANTEN; en
 * ny common-produkt ärver rena slug:en och prissätts av RapidAPI From. Variantens
 * pris/historik kommer från pokemontcg.io-trend (runVariantRefresh).
 *
 * Kör: APPLY=1 DATABASE_URL=$NEON_DATABASE_URL CARDMARKET_RAPIDAPI_KEY=... npx tsx scripts/variant-split-apply.ts
 */
import { PrismaClient } from "@prisma/client";
import { findCandidates } from "./variant-split-analyze";
import { cardmarketProductUrl } from "../src/lib/marketplace-urls";
import { getRatesOre } from "../src/lib/exchange-rate";
import { runVariantRefresh, runCardmarketRefresh as _r } from "../src/jobs/cardmarket-refresh";
import { recomputeProductPriceCache } from "../src/services/products";
void _r;

const db = new PrismaClient();
const LABEL = "Specialversion";
const CUTOFF = new Date("2026-06-18T00:00:00Z");
const HOST = process.env.CARDMARKET_RAPIDAPI_HOST ?? "cardmarket-api-tcg.p.rapidapi.com";
const KEY = process.env.CARDMARKET_RAPIDAPI_KEY ?? "";

async function fetchCommon(tcgid: string, eurToOre: number): Promise<{ cmId: number; fromOre: number } | null> {
  const r = await fetch(`https://${HOST}/pokemon/cards?tcgid=${encodeURIComponent(tcgid)}`, {
    headers: { "x-rapidapi-host": HOST, "x-rapidapi-key": KEY },
  });
  if (!r.ok) return null;
  const j = (await r.json()) as { data?: { cardmarket_id?: number | null; prices?: { cardmarket?: { lowest_near_mint?: number | null; "30d_average"?: number | null } } }[] };
  const c = j.data?.[0];
  const cmp = c?.prices?.cardmarket ?? {};
  const eur = cmp.lowest_near_mint ?? cmp["30d_average"];
  if (c?.cardmarket_id == null || eur == null) return null;
  return { cmId: c.cardmarket_id, fromOre: Math.round(eur * eurToOre) };
}

async function main() {
  if (process.env.APPLY !== "1") { console.log("Sätt APPLY=1 för att köra."); return; }
  const rates = await getRatesOre();
  const cm = await db.retailer.findFirst({ where: { name: "Cardmarket" }, select: { id: true } });
  if (!cm) throw new Error("Cardmarket-retailer saknas");

  const candidates = await findCandidates();
  console.log(`Delar ${candidates.length} kort...`);
  let done = 0;
  for (const cand of candidates) {
    const existing = await db.product.findUnique({
      where: { id: cand.productId },
      select: { id: true, slug: true, title: true, cardId: true, setId: true, imageUrl: true, variantLabel: true,
        offers: { select: { id: true, retailerId: true } } },
    });
    if (!existing || existing.variantLabel) continue; // redan delad
    const canonicalSlug = existing.slug;
    const baseTitle = existing.title;

    // 1) befintlig → variant
    await db.product.update({
      where: { id: existing.id },
      data: { slug: `${canonicalSlug}-variant`, title: `${baseTitle} · ${LABEL}`, variantLabel: LABEL },
    });
    // 2) ny common ärver rena slug:en
    const common = await db.product.create({
      data: { title: baseTitle, normalizedTitle: baseTitle.toLowerCase(), slug: canonicalSlug,
        category: "SINGLE_CARD", cardId: existing.cardId, setId: existing.setId, imageUrl: existing.imageUrl, variantLabel: null },
    });
    // 3) flytta råa (icke-CM) offers till commonen
    for (const o of existing.offers) {
      if (o.retailerId !== cm.id) await db.offer.update({ where: { id: o.id }, data: { productId: common.id } });
    }
    // 4) commonens CM-offer (rätt produkt-id via RapidAPI)
    const fc = await fetchCommon(cand.tcgId, rates.eurToOre);
    const fromOre = fc?.fromOre ?? cand.fromOre;
    await db.offer.upsert({
      where: { productId_retailerId_condition_language: { productId: common.id, retailerId: cm.id, condition: "NEAR_MINT", language: "EN" } },
      update: {},
      create: { productId: common.id, retailerId: cm.id, condition: "NEAR_MINT", language: "EN",
        price: fromOre, currency: "SEK", stockStatus: "IN_STOCK",
        url: fc ? cardmarketProductUrl(fc.cmId, { nearMint: true }) : cand.cmUrl },
    });
    const today = new Date(); today.setHours(0, 0, 0, 0);
    await db.priceSnapshot.upsert({
      where: { productId_date: { productId: common.id, date: today } },
      update: { minPrice: fromOre, maxPrice: fromOre, avgPrice: fromOre },
      create: { productId: common.id, date: today, minPrice: fromOre, maxPrice: fromOre, avgPrice: fromOre, volume: 1 },
    });
    // 5) rensa variantens felaktiga billiga period (efter 18 juni = common-From)
    await db.priceSnapshot.deleteMany({ where: { productId: existing.id, date: { gte: CUTOFF } } });
    done++;
  }

  // Prissätt alla varianter via pokemontcg.io-trend + skriv dagens punkt; uppdatera cache.
  const n = await runVariantRefresh();
  await recomputeProductPriceCache();
  console.log(`Klart: ${done} delade, ${n} varianter prissatta via pokemontcg.io.`);
}

main().finally(() => db.$disconnect());
