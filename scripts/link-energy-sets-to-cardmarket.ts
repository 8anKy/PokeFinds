/**
 * KOPPLA BAS-ENERGI-SETEN TILL CARDMARKET (2026-10-05, ägarbeslut: "fyll dem korrekt,
 * annars behövs inga tomma set").
 *
 * "Scarlet & Violet Energies" (sve) och "Mega Evolution Energy" (mee) kommer från
 * pokemontcg.io, men prisleverantörens episod för dem är TOM (0 kort) — korten fick
 * därför aldrig någon CM-offer, aldrig något pris, och katalogen gömmer singlar utan pris.
 * Setsidan såg alltså tom ut fast korten fanns.
 *
 * Kedjan är samma som recover-cm-idproduct.ts, och kräver TVÅ oberoende bevis:
 *   vårt kort (set + nummer) → CardTraders blueprint på samma samlarnummer →
 *   `card_market_ids` (exakt ett) → CM:s EGEN singelkatalog måste ge samma kortnamn.
 * Ingen träff ⇒ ingen länk (mee 9–16 finns inte hos CardTrader och lämnas).
 * Tryckningar (reverse holo m.fl.) rörs aldrig — se recover-cm-idproduct.ts.
 *
 * Efter länken sköter den nattliga guide-reserven i cardmarket-refresh priset (CM:s egen
 * prisguide via vårt idProduct ⇒ uppskattning, brickan "Uppskattat"). Skriptet sätter
 * dagens värde direkt så korten syns utan att vänta en natt.
 *
 *   node scripts/with-prod-db.mjs npx tsx scripts/link-energy-sets-to-cardmarket.ts          # torrkörning
 *   node scripts/with-prod-db.mjs npx tsx scripts/link-energy-sets-to-cardmarket.ts --apply
 */
import { prisma } from "../src/lib/db";
import { fetchCmGuide, fetchCmSingleNames, guideReserveEur, cmCardNameAgrees } from "../src/jobs/cardmarket-refresh";
import { ctBlueprints, ctExpansions, ctNumberKey } from "../src/lib/cardtrader";
import { cardmarketProductUrl, withNearMint } from "../src/lib/marketplace-urls";
import { getRatesOre, priceOreFromEur } from "../src/lib/exchange-rate";

const APPLY = process.argv.includes("--apply");
// vårt externalId → CardTraders expansionskod
const SETS: Record<string, string> = { sve: "sveen", mee: "mee" };

async function main() {
  const cm = await prisma.retailer.findFirst({ where: { name: "Cardmarket" }, select: { id: true } });
  if (!cm) throw new Error("Ingen Cardmarket-retailer");
  const [cmNames, guide, rates, ctEx] = await Promise.all([fetchCmSingleNames(), fetchCmGuide(), getRatesOre(), ctExpansions()]);
  if (cmNames.size === 0) throw new Error("CM:s singelkatalog kunde inte laddas — avbryter (ingen identitetsvakt)");

  // Ett idProduct får ägas av exakt en produkt.
  const owned = new Set(
    (await prisma.offer.findMany({ where: { retailerId: cm.id, url: { contains: "idProduct=" } }, select: { url: true } }))
      .map((o) => Number(o.url.match(/idProduct=(\d+)/)?.[1])),
  );

  let linked = 0;
  for (const [ext, ctCode] of Object.entries(SETS)) {
    const exp = ctEx.find((e) => e.code === ctCode);
    if (!exp) { console.log(`⛔ ${ext}: CardTrader-expansionen ${ctCode} saknas`); continue; }
    const byNumber = new Map<string, number[]>();
    for (const b of await ctBlueprints(exp.id)) {
      const key = ctNumberKey((b as { fixed_properties?: { collector_number?: string } }).fixed_properties?.collector_number);
      const ids = (b as { card_market_ids?: number[] }).card_market_ids ?? [];
      const version = String((b as { version?: string }).version ?? "");
      if (!key || ids.length !== 1 || /reverse/i.test(version)) continue;
      byNumber.set(key, [...(byNumber.get(key) ?? []), ids[0]]);
    }
    const products = await prisma.product.findMany({
      where: { category: "SINGLE_CARD", set: { externalId: ext } },
      select: { id: true, title: true, variantLabel: true, card: { select: { name: true, number: true } },
        offers: { where: { retailerId: cm.id }, select: { id: true, url: true } } },
    });
    for (const p of products) {
      // Bara ordinarie kort: alla variantprodukter (reverse holo m.fl.) rörs aldrig.
      if (p.variantLabel != null || !p.card) continue;
      if (p.offers.some((o) => /idProduct=\d+/.test(o.url))) { console.log(`  = ${p.title}: har redan CM-länk`); continue; }
      const cands = byNumber.get(ctNumberKey(p.card.number) ?? "") ?? [];
      if (cands.length !== 1) { console.log(`  – ${p.title}: ${cands.length} CardTrader-kandidater, ingen länk`); continue; }
      const idProduct = cands[0];
      const cmName = cmNames.get(idProduct);
      // pokemontcg.io skriver "Grass Energy" där CM skriver "Basic Grass Energy" — samma kort
      // (nummer + CardTrader är redan eniga); prefixet är det enda som skiljer.
      const noBasic = (n: string | null | undefined) => n?.replace(/^basic\s+/i, "");
      if (!cmCardNameAgrees(noBasic(p.card.name), noBasic(cmName))) { console.log(`  ⛔ ${p.title}: CM ${idProduct} heter "${cmName ?? "?"}"`); continue; }
      if (owned.has(idProduct)) { console.log(`  ⛔ ${p.title}: CM ${idProduct} ägs redan av en annan produkt`); continue; }
      const verdict = guideReserveEur({ cardName: p.card.name, idProduct }, guide.get(idProduct), cmNames);
      const priceOre = "eur" in verdict ? priceOreFromEur(verdict.eur, rates) : null;
      const url = withNearMint(cardmarketProductUrl(idProduct));
      console.log(`  ✔ ${p.title} → CM ${idProduct} "${cmName}" ${priceOre != null ? (priceOre / 100).toFixed(2) + " kr" : "(inget guidepris)"}`);
      owned.add(idProduct);
      linked++;
      if (!APPLY) continue;
      await prisma.offer.upsert({
        where: { productId_retailerId_condition_language: { productId: p.id, retailerId: cm.id, condition: "NEAR_MINT", language: "EN" } },
        update: { url, price: priceOre, stockStatus: "OUT_OF_STOCK", lastSeenAt: new Date() },
        create: { productId: p.id, retailerId: cm.id, condition: "NEAR_MINT", language: "EN", url, price: priceOre, currency: "SEK", stockStatus: "OUT_OF_STOCK" },
      });
      if (priceOre != null) await prisma.product.update({ where: { id: p.id }, data: { lowestPriceOre: priceOre } });
    }
  }
  console.log(APPLY ? `\nLänkade: ${linked}` : `\nTORRKÖRNING (${linked} länkar) — kör med --apply`);
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
