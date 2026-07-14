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
import { PrismaClient } from "@prisma/client";
import { fetchCmGuide, cmGuideRefEur } from "../src/jobs/cardmarket-refresh";
import { getRatesOre } from "../src/lib/exchange-rate";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");

// Hur långt från produktens rättade pris en snapshot får ligga innan den räknas som
// korrupt. 4x är MEDVETET trubbigt — hellre lämna kvar en tveksam punkt än radera
// legitim historik.
const FACTOR = 4;
const SEALED = ["BOOSTER_BOX", "BOOSTER_PACK", "ETB", "COLLECTION_BOX", "TIN", "BLISTER", "BUNDLE", "OTHER"] as const;

async function main() {
  console.log(APPLY ? "APPLY — raderar.\n" : "DRY-RUN — inget raderas. Kör med --apply.\n");

  const cm = await prisma.retailer.findFirst({ where: { name: "Cardmarket" } });
  const products = await prisma.product.findMany({
    where: { category: { in: [...SEALED] } },
    select: {
      id: true, title: true,
      offers: { where: { retailerId: cm!.id }, select: { price: true, updatedAt: true } },
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
  console.log(`sealed m. CM-pris: ${cmOffers.length} | fortfarande >10x från CM-trend: ${frozen.length}`);
  if (frozen.length > 20) {
    for (const o of frozen.slice(0, 5)) console.log(`   frusen? ${(o.price! / 100).toFixed(0)} kr — ${o.product.title.slice(0, 45)}`);
    throw new Error(
      `AVBRYTER: ${frozen.length} priser ligger fortfarande >10x från CM:s trend — spärrhake-fixen ` +
      `har inte kört klart. Facit vore då det FRUSNA priset och vi skulle radera KORREKT historik. ` +
      `Kör cardmarket-refresh (med fixen, full RapidAPI-kvot) först.`,
    );
  }

  let victims = 0, rows = 0;
  const toDelete: string[] = [];
  const report: any[] = [];

  for (const p of products) {
    const price = p.offers[0]?.price ?? null;
    if (price == null || price <= 0) continue;            // inget rättat pris → inget facit

    const bad = p.priceSnapshots.filter(
      (s) => s.avgPrice > price * FACTOR || s.avgPrice < price / FACTOR,
    );
    if (bad.length === 0) continue;

    victims++;
    rows += bad.length;
    toDelete.push(...bad.map((s) => s.id));
    report.push({
      title: p.title,
      ref: Math.round(price / 100),
      bad: bad.length,
      total: p.priceSnapshots.length,
      span: `${(Math.min(...bad.map((s) => s.avgPrice)) / 100).toFixed(0)}–${(Math.max(...bad.map((s) => s.avgPrice)) / 100).toFixed(0)} kr`,
    });
  }

  report.sort((a, b) => b.bad - a.bad);
  console.log(`\n${victims} produkter har korrupt historik (${rows} snapshot-rader utanför ±${FACTOR}x det rättade priset):\n`);
  console.log("  rader  rättat pris   korrupt spann             produkt");
  for (const r of report.slice(0, 30))
    console.log(`  ${String(r.bad).padStart(3)}/${String(r.total).padEnd(3)} ${String(r.ref).padStart(9)} kr  ${r.span.padEnd(24)} ${r.title.slice(0, 42)}`);
  if (report.length > 30) console.log(`  … +${report.length - 30} produkter till`);

  if (!APPLY) {
    console.log(`\nDry-run. ${rows} rader skulle raderas. Kör med --apply.`);
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
