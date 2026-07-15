/**
 * Raderar KORRUPT sealed-prishistorik.
 *
 * VARFÖR: dagvakten var en spärrhake (se cardmarket-refresh.ts) — ett skräpvärde som
 * tagit sig in kunde aldrig läka, och varje dygn skrev jobbet TILLBAKA samma fel som
 * en ny snapshot-punkt. Historiken för de produkterna ÄR alltså korruptionen, inte en
 * marknad. Två följder:
 *   1. Marknadssidans "största upp/ned" räknar första-mot-sista snapshot i fönstret →
 *      visade -95% och +691% på priser som aldrig rört sig.
 *   2. När fixen läker priset (79 kr → 1 733 kr) blir SJÄLVA RÄTTELSEN en +2 094%-topp
 *      på listan i sju dagar. Rättar vi inte historiken byter vi bara ut ett falskt ras
 *      mot en falsk raket.
 *
 * FACIT = produktens EGET, RÄTTADE CM-pris (Offer.price efter att den fixade
 * cardmarket-refresh har kört). INTE CM:s trend.
 *
 * VARFÖR INTE TRENDEN: första versionen av det här skriptet använde CM:s trend som
 * facit och ville radera 1 742 rader. Torrkörningen avslöjade att den skulle ha
 * raderat KORREKT historik:
 *   Darkness Ablaze Booster Box   CM-trend 129 kr   historik 3 297–3 773 kr
 *   Journey Together Enh. Display CM-trend   8 kr   historik 2 764–2 830 kr
 * En Darkness Ablaze-box ÄR ~3 500 kr. Där är TRENDEN trasig, inte historiken —
 * exakt den tunndata-/felmappningssvans som prisvakten redan lärt oss att inte lita
 * på. Ett facit man inte får lita på duger inte till att radera data.
 *
 * KÖRORDNING (viktig):
 *   1. cardmarket-refresh måste ha kört MED spärrhake-fixen (annars är Offer.price
 *      fortfarande det frusna skräpet och skriptet raderar fel saker).
 *   2. Sedan detta skript.
 * Skriptet vägrar köra om det inte ser tecken på att fixen kört (se guard nedan).
 *
 * Kör:  node scripts/with-prod-db.mjs npx tsx scripts/purge-corrupt-snapshots.ts
 *       node scripts/with-prod-db.mjs npx tsx scripts/purge-corrupt-snapshots.ts --apply
 */
import { writeFileSync } from "fs";
import { PrismaClient } from "@prisma/client";
import { fetchCmGuide, cmGuideRefEur } from "../src/jobs/cardmarket-refresh";
import { getRatesOre } from "../src/lib/exchange-rate";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");
// CLEAR_ONLY=1: purga bara de SÄKRA ("clear") — håll vintage/dyra "verify"-produkter vars
// facit ser uppblåst ut och saknar butiks-korsvalidering. Samma tröskel som granskningssidan:
// facit >8000 kr, eller ETB >2000 kr (ETB:er är billiga → högt facit = fel idProduct).
const CLEAR_ONLY = process.env.CLEAR_ONLY === "1";
const isVerify = (title: string, priceOre: number) =>
  priceOre > 800_000 || (/elite trainer box/i.test(title) && priceOre > 200_000);

// Hur långt från produktens rättade pris en snapshot får ligga innan den räknas som
// korrupt. 4x är MEDVETET trubbigt — hellre lämna kvar en tveksam punkt än radera
// legitim historik.
const FACTOR = 4;

// ── PLATÅ-KRAVET: skiljer ett FRUSET pris från en ÄKTA uppgång ───────────────
// Avstånd från dagens pris räcker INTE som bevis. En produkt som genuint stigit 4x på en
// månad har en gammal, LÅG historik som ligger >4x bort — och den historiken är SANN.
// Raderar vi den förstör vi exakt det som "prishistorik byggs framåt" ska skydda.
//
// Spärrhaken har däremot ett fingeravtryck: den skrev SAMMA värde varje dygn. Great
// Encounters stod på 325 385 kr dag efter dag; Skeledirge på 79 kr. En äkta rörelse är en
// KURVA, ett fruset pris är en PLATÅ. Vi raderar därför bara när de misstänkta punkterna
// ligger still (max/min <= PLATEAU_SPREAD) — då är de inte en marknad, de är en bugg.
const PLATEAU_SPREAD = 1.2;

// ── STORE-KORSVALIDERING AV FACIT (Misstag 3, 2026-07-15) ────────────────────
// Facit = produktens CM Offer.price. Men det kan vara FEL om CM-idProduct pekar på
// PACKEN i stället för boxen: Darkness Ablaze Booster Box visade CM 130 kr medan
// Tradera hade boxen på 4179 kr. Då är HISTORIKEN (3297–3773 kr) rätt och facit fel —
// och purge hade raderat den korrekta historiken. >10x-från-trend-vakten missar det
// (fel facit ≈ fel trend). Extra vakt: skiljer en butik (in ELLER out of stock) sig
// >STORE_MULT× från CM-facit åt NÅGOT håll → facit opålitligt → SKIPPA produkten helt.
const STORE_MULT = 4;
const SEALED = ["BOOSTER_BOX", "BOOSTER_PACK", "ETB", "COLLECTION_BOX", "TIN", "BLISTER", "BUNDLE", "OTHER"] as const;

async function main() {
  console.log(APPLY ? "APPLY — raderar.\n" : "DRY-RUN — inget raderas. Kör med --apply.\n");

  const cm = await prisma.retailer.findFirst({ where: { name: "Cardmarket" } });
  const products = await prisma.product.findMany({
    where: { category: { in: [...SEALED] } },
    select: {
      id: true, title: true,
      // ALLA offers (inte bara CM) — butiks-offer behövs för facit-korsvalideringen.
      offers: { select: { retailerId: true, price: true, stockStatus: true } },
      priceSnapshots: { select: { id: true, date: true, avgPrice: true }, orderBy: { date: "asc" } },
    },
  });

  // ── VAKT: HAR SPÄRRHAKE-FIXEN FAKTISKT KÖRT? ────────────────────────────────
  // updatedAt duger INTE. En misslyckad körning rör ändå offers, så 1534/1600 såg
  // "färska" ut medan priserna fortfarande satt frusna på 79 kr. Hade vi litat på det
  // hade skriptet tagit det FRUSNA priset för facit och raderat den KORREKTA historiken.
  //
  // Riktig signal: finns det fortfarande uppenbart frusna värden kvar? Ett pris som
  // ligger >10x från CM:s trend är inte en marknad — det är spärrhaken (HS-Triumphant:
  // 496 350 kr mot en trend på ~44 000 kr). Är de kvar har fixen inte kört.
  const guide = await fetchCmGuide();
  if (guide.size === 0) throw new Error("CM-prisguiden kunde inte hämtas — avbryter hellre än att gissa.");
  const rates = await getRatesOre();

  const cmOffers = await prisma.offer.findMany({
    where: { retailerId: cm!.id, url: { contains: "idProduct=" }, price: { gt: 0 },
             product: { category: { in: [...SEALED] } } },
    select: { price: true, url: true, product: { select: { title: true } } },
  });
  const frozen = cmOffers.filter((o) => {
    const refEur = cmGuideRefEur(guide.get(Number(o.url.match(/idProduct=(\d+)/)![1])));
    if (refEur == null) return false;
    const refOre = refEur * rates.eurToOre;
    return o.price! > refOre * 10 || o.price! < refOre / 10;
  });
  const stale = frozen.length > 20;
  console.log(`sealed m. CM-pris: ${cmOffers.length} | fortfarande >10x från CM-trend: ${frozen.length}`);
  if (stale) {
    for (const o of frozen.slice(0, 5)) console.log(`   frusen? ${(o.price! / 100).toFixed(0)} kr — ${o.product.title.slice(0, 45)}`);
    // Blockera bara SKRIVNINGEN. En torrkörning är ofarlig och användbar — men säg
    // rakt ut att facit är ruttet, annars läses listan som en sanning.
    console.warn(
      `\n⚠ VARNING: ${frozen.length} priser ligger fortfarande >10x från CM:s trend — spärrhake-fixen ` +
      `har inte kört klart. FACIT ÄR DÅ DET FRUSNA PRISET och listan nedan är opålitlig.\n`,
    );
    if (APPLY) {
      throw new Error(
        "AVBRYTER --apply: vi skulle radera KORREKT historik mot ett fruset facit. " +
        "Kör cardmarket-refresh (med fixen, full RapidAPI-kvot) först.",
      );
    }
  }

  let victims = 0, rows = 0, spared = 0, suspectFacit = 0, heldVerify = 0;
  const toDelete: string[] = [];
  const report: any[] = [];
  const sparedReport: any[] = [];
  const suspectReport: any[] = [];

  for (const p of products) {
    const price = p.offers.find((o) => o.retailerId === cm!.id)?.price ?? null;
    if (price == null || price <= 0) continue;            // inget rättat pris → inget facit

    const bad = p.priceSnapshots.filter(
      (s) => s.avgPrice > price * FACTOR || s.avgPrice < price / FACTOR,
    );
    if (bad.length === 0) continue;

    // CLEAR_ONLY: håll vintage/dyra "verify"-produkter (uppblåst facit, ingen butiks-
    // korsvalidering) — de granskas separat. Purga bara de säkra "clear".
    if (CLEAR_ONLY && isVerify(p.title, price)) { heldVerify++; continue; }

    // Facit-korsvalidering: en butik som prissätter produkten långt över/under CM-facit
    // avslöjar ett opålitligt facit (felmappad idProduct). Rör INTE historiken då.
    const storePrices = p.offers
      .filter((o) => o.retailerId !== cm!.id && o.price != null && o.price > 0)
      .map((o) => o.price as number);
    if (storePrices.length) {
      const storeMax = Math.max(...storePrices);
      if (storeMax > price * STORE_MULT || price > storeMax * STORE_MULT) {
        suspectFacit++;
        suspectReport.push({
          title: p.title,
          facit: Math.round(price / 100),
          store: Math.round(storeMax / 100),
          wouldHaveDeleted: bad.length,
          span: `${(Math.min(...bad.map((s) => s.avgPrice)) / 100).toFixed(0)}–${(Math.max(...bad.map((s) => s.avgPrice)) / 100).toFixed(0)} kr`,
        });
        continue;
      }
    }

    // PLATÅ-KRAVET (se konstanten ovan): bara ett STILLASTÅENDE fel raderas. Sprider sig
    // punkterna är det en äkta kurva — lämna den i fred, även om den ligger långt bort.
    const lo = Math.min(...bad.map((s) => s.avgPrice));
    const hi = Math.max(...bad.map((s) => s.avgPrice));
    if (lo <= 0 || hi / lo > PLATEAU_SPREAD) {
      spared++;
      sparedReport.push({ title: p.title, ref: Math.round(price / 100), n: bad.length,
        span: `${(lo / 100).toFixed(0)}–${(hi / 100).toFixed(0)} kr` });
      continue;
    }

    victims++;
    rows += bad.length;
    toDelete.push(...bad.map((s) => s.id));
    report.push({
      title: p.title,
      ref: Math.round(price / 100),
      bad: bad.length,
      total: p.priceSnapshots.length,
      span: `${(lo / 100).toFixed(0)}–${(hi / 100).toFixed(0)} kr`,
    });
  }

  report.sort((a, b) => b.bad - a.bad);
  suspectReport.sort((a, b) => b.store - a.store);

  // Facit-skippade FÖRST — det är dessa som räddades från felradering.
  if (suspectFacit) {
    console.log(`\n⚠ ${suspectFacit} produkter SKIPPADES — CM-facit motsäger butikspris (>${STORE_MULT}x, trolig felmappad idProduct). Historiken RÖRS EJ:`);
    console.log("  CM-facit   butik      skulle radera   produkt");
    for (const s of suspectReport)
      console.log(`  ${String(s.facit).padStart(7)}kr ${String(s.store).padStart(7)}kr  ${String(s.wouldHaveDeleted).padStart(3)} rader (${s.span.padEnd(14)}) ${s.title.slice(0, 40)}`);
  }

  if (CLEAR_ONLY) console.log(`\nCLEAR_ONLY=1 → höll ${heldVerify} vintage/dyra "verify"-produkter (granskas separat).`);
  console.log(`\n${victims} produkter har korrupt historik (${rows} snapshot-rader utanför ±${FACTOR}x det rättade priset):\n`);
  console.log("  rader  rättat pris   korrupt spann             produkt");
  for (const r of report)
    console.log(`  ${String(r.bad).padStart(3)}/${String(r.total).padEnd(3)} ${String(r.ref).padStart(9)} kr  ${r.span.padEnd(24)} ${r.title.slice(0, 42)}`);

  if (spared) {
    console.log(`\n${spared} produkter SKONADES av platå-kravet (punkterna sprider sig = äkta kurva, inte ett fruset fel):`);
    for (const s of sparedReport)
      console.log(`   ${String(s.n).padStart(3)} punkter  ${s.span.padEnd(22)} (pris nu ${s.ref} kr)  ${s.title.slice(0, 40)}`);
  }

  if (!APPLY) {
    // Full plan till fil för granskning (ägaren vill granska INNAN --apply).
    const planPath = (process.env.TEMP ?? "/tmp") + "/purge-plan.json";
    writeFileSync(planPath, JSON.stringify({ toPurge: report, skippedSuspectFacit: suspectReport, sparedRealCurves: sparedReport, totals: { products: victims, rows, suspectFacit, spared } }, null, 2));
    console.log(`\nDry-run. ${rows} rader från ${victims} produkter skulle raderas (${suspectFacit} skippade pga opålitligt facit). Full plan → ${planPath}. Kör med --apply.`);
    return;
  }

  // Radera i klumpar — Postgres tar inte 10k parametrar i ett svep.
  let done = 0;
  for (let i = 0; i < toDelete.length; i += 500) {
    const chunk = toDelete.slice(i, i + 500);
    const { count } = await prisma.priceSnapshot.deleteMany({ where: { id: { in: chunk } } });
    done += count;
  }
  console.log(`\nRaderade ${done} korrupta snapshot-rader från ${victims} produkter.`);
  console.log("Historiken byggs om framåt från nästa cardmarket-refresh (13:00 UTC).");
}

main().finally(() => prisma.$disconnect());
