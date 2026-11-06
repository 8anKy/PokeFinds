/**
 * KOPPLA ETT NYTT SETS SINGLAR TILL CARDMARKET FÖRE LEVERANTÖREN (2026-11-06).
 *
 * På släppdagen har Cardmarket redan alla kort (Delta Reign: 141 singlar i CM:s
 * katalog sedan 2026-10-24, med prisguide), men prisleverantören ger
 * `cardmarket_id: null` på varenda rad i flera dygn. Utan id får korten ingen
 * CM-offer, nattens guide-reserv har ingen länk att gå på, och hela setet står "–".
 *
 * Samma kedja och samma vakter som `recover-cm-idproduct.ts`, men för kort som
 * SAKNAR CM-offer helt:
 *   vårt set → CardTrader-expansion → blueprint på samlarnummer → card_market_ids
 *   ⛔ två oberoende namn måste hålla med (CT:s blueprint + CM:s singelkatalog),
 *   ⛔ id:t måste vara en singel hos CM och får inte ägas av någon annan produkt,
 *   ⛔ tryckningar (variantLabel) rörs aldrig.
 *
 * RESERVVÄG NÄR CARDTRADER INTE HAR SETET ÄN (Delta Reign: expansionen fanns, 0
 * blueprints): CM:s egen singelkatalog för setets `cmExpansionId`. Inom en
 * expansion ligger CM:s idProduct i SAMLARNUMMERORDNING (samma fynd som JP-länkningen;
 * mätt på Delta Reign: 134 av 141 namn eniga i ren id-ordning, de 7 andra är tränare
 * CM översatt annorlunda — "Delicious Onigiri" mot "Tasty Rice Ball"). ⛔ Kräver att
 * antalet är EXAKT lika och att alla nummer är heltal; ⛔ varje par måste ändå klara
 * namnvakten — ett par som bara stöds av positionen kopplas inte.
 *
 * Skriver: `Card.cardmarketId` (bara om null) + en CM-offer med `?idProduct=`-länk.
 * Priset = guide-reserven (`guideReserveEur`, samma dom som nattkörningen) som
 * UPPSKATTNING (OUT_OF_STOCK ⇒ "Uppskattat"). Nattens cardmarket-refresh tar över
 * därefter: ger leverantören en äkta From vinner den, annars förnyas reserven.
 *
 *   node scripts/with-prod-db.mjs npx tsx scripts/link-new-set-to-cardmarket.ts --set delta-reign          # torrkörning
 *   node scripts/with-prod-db.mjs npx tsx scripts/link-new-set-to-cardmarket.ts --set delta-reign --apply  # skriver
 */
import { prisma } from "../src/lib/db";
import {
  cmCardNameAgrees,
  fetchCmGuide,
  fetchCmSingleNames,
  guideReserveEur,
  guideRowIsSingle,
} from "../src/jobs/cardmarket-refresh";
import { getRatesOre, priceOreFromEur } from "../src/lib/exchange-rate";
import { ctBlueprints, ctExpansions, ctNumberKey, isSingleBlueprint, matchExpansion, type CtBlueprint } from "../src/lib/cardtrader";
import { cardmarketProductUrl } from "../src/lib/marketplace-urls";
import { recomputeProductPriceCache } from "../src/services/products";

const APPLY = process.argv.includes("--apply");
const setArg = process.argv[process.argv.indexOf("--set") + 1];

async function main() {
  if (!process.argv.includes("--set") || !setArg) throw new Error("--set <slug|id> krävs");
  const cm = await prisma.retailer.findFirst({ where: { name: "Cardmarket" }, select: { id: true } });
  if (!cm) throw new Error("Ingen Cardmarket-retailer");
  const set = await prisma.cardSet.findFirst({
    where: { OR: [{ slug: setArg }, { id: setArg }], language: "EN" },
    select: { id: true, name: true, series: true, cmExpansionId: true },
  });
  if (!set) throw new Error(`Inget EN-set "${setArg}"`);

  const products = await prisma.product.findMany({
    where: {
      category: "SINGLE_CARD",
      variantLabel: null,
      card: { setId: set.id },
      offers: { none: { retailerId: cm.id } },
    },
    select: { id: true, title: true, card: { select: { id: true, name: true, number: true, cardmarketId: true } } },
  });
  console.log(`"${set.name}": ${products.length} ordinarie singlar utan CM-offer`);
  if (products.length === 0) return;

  const cmNames = await fetchCmSingleNames();
  if (cmNames.size === 0) throw new Error("CM:s singelkatalog gick inte att hämta — avbryter");

  const owned = new Set<number>();
  for (const row of await prisma.$queryRaw<{ id: string }[]>`
    SELECT substring(url from 'idProduct=([0-9]+)') AS id
    FROM "Offer" WHERE "retailerId" = ${cm.id} AND url LIKE '%idProduct=%'
  `)
    if (row.id) owned.add(Number(row.id));

  // Kandidat per produkt: idProduct + det namn källan gav (för vakt 1).
  const cand = new Map<string, { idProduct: number; srcName: string } | string>();
  const exp = matchExpansion(set.name, set.series, await ctExpansions());
  const byNumber = new Map<string, CtBlueprint[]>();
  if (exp)
    for (const b of (await ctBlueprints(exp.id)).filter(isSingleBlueprint)) {
      const k = ctNumberKey(b.fixed_properties?.collector_number as string);
      if (!k) continue;
      byNumber.set(k, [...(byNumber.get(k) ?? []), b]);
    }
  console.log(`CardTrader: ${exp ? `expansion ${exp.id}, ${byNumber.size} nummer` : "ingen entydig expansion"}`);

  if (byNumber.size > 0) {
    for (const p of products) {
      const k = ctNumberKey(p.card!.number);
      const cands = (k ? byNumber.get(k) : undefined) ?? [];
      if (cands.length !== 1) { cand.set(p.id, "inget entydigt CT-nummer"); continue; }
      const ids = cands[0].card_market_ids ?? [];
      if (ids.length !== 1) { cand.set(p.id, "blueprint utan ett card_market_id"); continue; }
      cand.set(p.id, { idProduct: ids[0], srcName: cands[0].name });
    }
  } else if (set.cmExpansionId != null) {
    const r = await fetch("https://downloads.s3.cardmarket.com/productCatalog/productList/products_singles_6.json");
    if (!r.ok) throw new Error(`CM:s singelkatalog: HTTP ${r.status}`);
    const rows = ((await r.json()) as { products: { idProduct: number; name: string; idExpansion: number }[] }).products
      .filter((x) => x.idExpansion === set.cmExpansionId)
      .sort((a, b) => a.idProduct - b.idProduct);
    const allCards = (await prisma.card.findMany({ where: { setId: set.id }, select: { id: true, number: true } }))
      .sort((a, b) => Number(a.number) - Number(b.number));
    const numeric = allCards.every((c) => /^\d+$/.test(c.number ?? ""));
    console.log(`CM-katalogen, expansion ${set.cmExpansionId}: ${rows.length} singlar mot våra ${allCards.length} kort${numeric ? "" : " (icke-numeriska nummer)"}`);
    if (rows.length !== allCards.length || !numeric) throw new Error("Antalet skiljer eller numren är inte heltal — id-ordningen bevisar ingenting, avbryter");
    const idx = new Map(allCards.map((c, i) => [c.id, i]));
    for (const p of products) {
      const row = rows[idx.get(p.card!.id)!];
      cand.set(p.id, { idProduct: row.idProduct, srcName: row.name });
    }
  } else {
    throw new Error("Varken CardTrader-blueprints eller cmExpansionId — inget att gå på");
  }

  const guide = await fetchCmGuide();
  const rates = await getRatesOre();
  const plan: { productId: string; cardId: string; setCardId: boolean; idProduct: number; priceOre: number | null; title: string }[] = [];
  const skips: Record<string, number> = {};
  const skip = (k: string) => (skips[k] = (skips[k] ?? 0) + 1);

  for (const p of products) {
    const c = p.card!;
    const hit = cand.get(p.id);
    if (hit == null || typeof hit === "string") { skip(hit ?? "ingen kandidat"); continue; }
    const { idProduct, srcName } = hit;
    if (!cmCardNameAgrees(c.name, srcName)) { skip("källans namn höll inte med"); continue; }
    const cmName = cmNames.get(idProduct);
    if (!cmName) { skip("id ej i CM:s singelkatalog"); continue; }
    if (!cmCardNameAgrees(c.name, cmName)) { skip("CM-namnet höll inte med"); continue; }
    if (!guideRowIsSingle(idProduct, cmNames)) { skip("id är inte en singel"); continue; }
    if (owned.has(idProduct)) { skip("id ägs av en annan produkt"); continue; }
    if (c.cardmarketId != null && c.cardmarketId !== idProduct) { skip("kortet bär redan ett annat cardmarketId"); continue; }
    owned.add(idProduct);
    const v = guideReserveEur({ cardName: c.name, idProduct }, guide.get(idProduct), cmNames);
    const priceOre = "eur" in v ? priceOreFromEur(v.eur, rates) : null;
    plan.push({ productId: p.id, cardId: c.id, setCardId: c.cardmarketId == null, idProduct, priceOre, title: p.title });
  }

  console.log(`\nKan kopplas: ${plan.length} av ${products.length}`, skips);
  console.log(`  med uppskattat pris: ${plan.filter((x) => x.priceOre != null).length}`);
  for (const x of [...plan].sort((a, b) => (b.priceOre ?? 0) - (a.priceOre ?? 0)).slice(0, 15))
    console.log("  ", x.title.slice(0, 44).padEnd(44), String(x.idProduct).padEnd(8), x.priceOre != null ? `${(x.priceOre / 100).toFixed(2)} kr` : "–");
  if (!APPLY) {
    console.log(`\nTORRKÖRNING — inget skrivet. --apply skriver ${plan.length} kopplingar.`);
    return;
  }

  for (const x of plan) {
    if (x.setCardId) await prisma.card.update({ where: { id: x.cardId }, data: { cardmarketId: x.idProduct } });
    const url = cardmarketProductUrl(x.idProduct, { nearMint: true, firstEd: "exclude" });
    await prisma.offer.upsert({
      where: { productId_retailerId_condition_language: { productId: x.productId, retailerId: cm.id, condition: "NEAR_MINT", language: "EN" } },
      update: { url, price: x.priceOre, stockStatus: "OUT_OF_STOCK", lastSeenAt: new Date() },
      create: { productId: x.productId, retailerId: cm.id, condition: "NEAR_MINT", language: "EN", price: x.priceOre, currency: "SEK", stockStatus: "OUT_OF_STOCK", url },
    });
  }
  await recomputeProductPriceCache();
  console.log(`\n✅ ${plan.length} kort kopplade till Cardmarket; produktpriserna omräknade.`);
}

main()
  .catch((e) => {
    console.error("FEL:", (e as Error).message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
