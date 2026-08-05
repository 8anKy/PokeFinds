/**
 * ÅTERSTÄLL CM-PRODUKT-ID FÖR SINGLAR VÅR PRISLEVERANTÖR TAPPAT
 *
 * Problemet: RapidAPI (TCGGO) slutar ibland leverera `cardmarket_id` för enskilda
 * kort. Kortet faller då ur den dagliga körningen helt — offern rörs inte, ingen
 * historikpunkt skrivs, och gårdagens pris står kvar som om det vore dagens.
 * MÄTT 2026-08-05: 108 singlar frusna, de äldsta sedan 2026-06-13.
 *
 * `runCardmarketRefresh` har numera en GUIDE-RESERV som räddar exakt de korten —
 * men BARA när vår egen CM-länk bär ett `idProduct`. Många länkar är lösta
 * slug-URL:er (`.../Singles/BREAKpoint/Growlithe-BKP10`) utan id, och för dem kan
 * reserven inte veta vilken CM-produkt kortet är.
 *
 * Det här skriptet återställer det id:t — utan att gissa på namn:
 *
 *   vårt set → CardTrader-expansion → blueprint på SAMLARNUMMER →
 *   `card_market_ids` (CardTraders egen koppling till Cardmarket) → idProduct
 *
 * ⛔ NUMRET ENSAMT ÄR INTE IDENTITET. Utan namnvakt gav kedjan rent skräp, mätt
 *    2026-08-05 på riktiga produkter: "Charizard ex (196)" → CardTraders "Eevee",
 *    "Xerneas ex (179)" → "Basic Psychic Energy", "Noctowl (141)" → "Sky Field".
 *    37 av 103 kandidater var sådana. Promo-set numrerar helt enkelt olika hos
 *    olika leverantörer. Därför krävs att TVÅ OBEROENDE namn håller med om kortet:
 *    CardTraders eget blueprint-namn OCH Cardmarkets egen singelkatalog. Med båda
 *    vakterna avvisades alla 37, och 0 kandidater föll på CM-ledet — dvs de två
 *    källorna var eniga varje gång de fick tala till punkt.
 *
 * ⛔ TRYCKNINGAR RÖRS ALDRIG (Unlimited/Shadowless/1st Edition/Reverse Holo m.fl.).
 *    Shadowless och 1st Edition DELAR CM-produkt, så ett id därifrån hade gett två
 *    katalogposter samma pris. Deras länkar sätts vid uppdelningen, inte här.
 *
 * ⛔ ETT idProduct FÅR ÄGAS AV EXAKT EN PRODUKT. Är id:t redan någon annans länk
 *    avstår vi — en produkt utan graf är bättre än en med FEL graf.
 *
 * Kostnad: NOLL RapidAPI-kvot. CardTrader är gratis (~1 anrop per berört set) och
 * Cardmarkets katalog + prisguide är publika nedladdningar utan nyckel.
 *
 *   node scripts/with-prod-db.mjs npx tsx scripts/recover-cm-idproduct.ts          # torrkörning
 *   node scripts/with-prod-db.mjs npx tsx scripts/recover-cm-idproduct.ts --apply  # skriver
 *
 * Env: STALE_DAYS=7   hur länge en CM-offer ska ha stått orörd för att räknas som frusen
 */
import { prisma } from "../src/lib/db";
import {
  cmCardNameAgrees,
  fetchCmGuide,
  fetchCmSingleNames,
  guideReserveEur,
  guideRowIsSingle,
} from "../src/jobs/cardmarket-refresh";
import { getRatesOre } from "../src/lib/exchange-rate";
import {
  ctBlueprints,
  ctExpansions,
  ctNumberKey,
  isSingleBlueprint,
  matchExpansion,
  type CtBlueprint,
} from "../src/lib/cardtrader";
import { cardmarketProductUrl } from "../src/lib/marketplace-urls";

const APPLY = process.argv.includes("--apply");
const STALE_DAYS = Number(process.env.STALE_DAYS) || 7;

interface Frozen {
  productId: string;
  title: string;
  cardName: string | null;
  number: string | null;
  setId: string | null;
  offerId: string;
  priceOre: number | null;
  url: string;
}

async function main() {
  const cm = await prisma.retailer.findFirst({ where: { name: "Cardmarket" }, select: { id: true } });
  if (!cm) throw new Error("Ingen Cardmarket-retailer");

  // Frusna = CM-offern har inte rörts på STALE_DAYS dygn (den dagliga körningen
  // bumpar lastSeenAt på allt den hittar, så det som är kvar är det den INTE hittade).
  // Tryckningar utesluts i SQL:en — se filhuvudet.
  const frozen = await prisma.$queryRaw<Frozen[]>`
    SELECT p.id AS "productId", p.title, c.name AS "cardName", c.number,
           p."setId" AS "setId", o.id AS "offerId", o.price AS "priceOre", o.url
    FROM "Product" p
    JOIN "Offer" o ON o."productId" = p.id AND o."retailerId" = ${cm.id}
    LEFT JOIN "Card" c ON c.id = p."cardId"
    WHERE p.category = 'SINGLE_CARD'
      AND p."variantLabel" IS NULL
      AND o.url NOT LIKE '%idProduct=%'
      AND o."lastSeenAt" < NOW() - (${STALE_DAYS} || ' days')::interval
    ORDER BY p.title
  `;
  console.log(
    `Frusna ordinarie singlar utan idProduct i länken: ${frozen.length} ` +
    `(CM-offern orörd i ≥${STALE_DAYS} dygn)\n`
  );
  if (frozen.length === 0) return;

  const cmNames = await fetchCmSingleNames();
  if (cmNames.size === 0) throw new Error("CM:s singelkatalog gick inte att hämta — avbryter");
  console.log(`CM:s singelkatalog: ${cmNames.size} produkter`);

  // Vilka idProducts ÄGS redan av en annan produkts CM-länk? Unikhetsvakten nedan.
  const owned = new Set<number>();
  for (const row of await prisma.$queryRaw<{ id: string }[]>`
    SELECT substring(url from 'idProduct=([0-9]+)') AS id
    FROM "Offer" WHERE "retailerId" = ${cm.id} AND url LIKE '%idProduct=%'
  `)
    if (row.id) owned.add(Number(row.id));
  console.log(`Redan länkade CM-produkter: ${owned.size}\n`);

  const expansions = await ctExpansions();
  const sets = await prisma.cardSet.findMany({
    where: { id: { in: [...new Set(frozen.map((f) => f.setId).filter(Boolean))] as string[] } },
    select: { id: true, name: true, series: true },
  });

  const plan: { f: Frozen; idProduct: number; cmName: string; ctName: string }[] = [];
  const skips = { noExpansion: 0, noBlueprint: 0, ctName: 0, noMkm: 0, notInCatalog: 0, cmName: 0, notSingle: 0, taken: 0 };

  for (const set of sets) {
    const mine = frozen.filter((f) => f.setId === set.id);
    const exp = matchExpansion(set.name, set.series, expansions);
    if (!exp) {
      skips.noExpansion += mine.length;
      console.log(`  – "${set.name}": ingen entydig CardTrader-expansion (${mine.length} kort)`);
      continue;
    }
    const byNumber = new Map<string, CtBlueprint[]>();
    for (const b of (await ctBlueprints(exp.id)).filter(isSingleBlueprint)) {
      const k = ctNumberKey(b.fixed_properties?.collector_number as string);
      if (!k) continue;
      if (!byNumber.has(k)) byNumber.set(k, []);
      byNumber.get(k)!.push(b);
    }
    for (const f of mine) {
      const k = ctNumberKey(f.number);
      const cands = (k ? byNumber.get(k) : undefined) ?? [];
      if (cands.length !== 1) { skips.noBlueprint++; continue; }
      const bp = cands[0];
      // VAKT 1 — CardTraders eget namn på kortet.
      if (!cmCardNameAgrees(f.cardName, bp.name)) { skips.ctName++; continue; }
      const ids = bp.card_market_ids ?? [];
      if (ids.length !== 1) { skips.noMkm++; continue; }
      const idProduct = ids[0];
      const cmName = cmNames.get(idProduct);
      if (!cmName) { skips.notInCatalog++; continue; }
      // VAKT 2 — Cardmarkets EGEN katalog. Två oberoende källor måste vara eniga.
      if (!cmCardNameAgrees(f.cardName, cmName)) { skips.cmName++; continue; }
      // VAKT 3 — raden måste vara en SINGEL hos CM (aldrig en sealed-produkt).
      if (!guideRowIsSingle(idProduct, cmNames)) { skips.notSingle++; continue; }
      // VAKT 4 — ingen annan produkt får redan äga id:t.
      if (owned.has(idProduct)) { skips.taken++; continue; }
      owned.add(idProduct);
      plan.push({ f, idProduct, cmName, ctName: bp.name });
    }
  }

  console.log(`\nKan länkas: ${plan.length} av ${frozen.length}`);
  console.log(`  – set utan entydig CT-expansion:    ${skips.noExpansion}`);
  console.log(`  – inget entydigt blueprint-nummer:  ${skips.noBlueprint}`);
  console.log(`  ⛔ CardTraders namn höll inte med:   ${skips.ctName}`);
  console.log(`  – blueprint utan card_market_ids:   ${skips.noMkm}`);
  console.log(`  – idProduct ej i CM:s singelkatalog:${skips.notInCatalog}`);
  console.log(`  ⛔ CM:s katalognamn höll inte med:   ${skips.cmName}`);
  console.log(`  ⛔ idProduct är inte en singel:      ${skips.notSingle}`);
  console.log(`  ⛔ idProduct ägs av en annan produkt:${skips.taken}\n`);

  // FÖRHANDSVISNING AV PRISET, inte bara av länken. Att länken är rätt är en sak;
  // vilket tal som hamnar på sidan i morgon är en annan, och den ska synas INNAN
  // något skrivs. Samma dom som den dagliga körningen kommer att fatta.
  const guide = await fetchCmGuide();
  const rates = await getRatesOre();
  console.log("  produkt                                          → idProduct  CT-namn / CM-namn      pris nu → guide-reserv");
  for (const p of plan) {
    const v = guideReserveEur({ cardName: p.f.cardName ?? "", idProduct: p.idProduct }, guide.get(p.idProduct), cmNames);
    const newOre = "eur" in v ? Math.round(v.eur * rates.eurToOre) : null;
    const old = p.f.priceOre;
    const factor = newOre && old ? Math.max(newOre / old, old / newOre) : null;
    console.log(
      "  ",
      p.f.title.slice(0, 46).padEnd(46),
      String(p.idProduct).padEnd(8),
      "CT=" + p.ctName.slice(0, 18).padEnd(18),
      "CM=" + p.cmName.slice(0, 26).padEnd(26),
      (old != null ? (old / 100).toFixed(2) : "–").padStart(9) + " →",
      (newOre != null ? (newOre / 100).toFixed(2) : "reject:" + ("reject" in v ? v.reject : "?")).padStart(9),
      factor != null && factor >= 5 ? `  ⚠️ ${factor.toFixed(1)}x` : ""
    );
  }

  if (!APPLY) {
    console.log(`\nTORRKÖRNING — inget skrivet. Kör om med --apply för att skriva ${plan.length} länkar.`);
    return;
  }
  for (const p of plan)
    await prisma.offer.update({
      where: { id: p.f.offerId },
      data: { url: cardmarketProductUrl(p.idProduct, { nearMint: true, firstEd: "exclude" }) },
    });
  console.log(`\n✅ ${plan.length} CM-länkar skrivna. Nästa cardmarket-refresh prissätter dem via guide-reserven.`);
}

main()
  .catch((e) => {
    console.error("FEL:", (e as Error).message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
