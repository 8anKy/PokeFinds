/**
 * ENGÅNGSSKRIPT: ta Leksaksaffären ur restock-bevakningen — butiken spärrar vår IP.
 *
 * ⛔ BUTIKEN ÄR INTE TRASIG OCH ADAPTERN ÄR OSKYLDIG. leksaksaffaren.com svarar
 * HTTP 403 mot GitHub Actions egress-IP, men **HTTP 200 från en vanlig IP med vår egen
 * FoilioBot-UA** (verifierat 2026-08-25 mot sex riktiga offer-URL:er). Deras robots.txt
 * tillåter oss, och `parsePrestaShopListing` läser samma HTML utan problem. Det går
 * alltså inte att laga i koden: en omskriven adapter skulle få exakt samma 403.
 *
 * ÄGARBESLUT 2026-08-25: acceptera bortfallet och tysta larmet.
 *   • `restockWatch=false` + `isActive=false` på KÄLLAN → hälsokollen slutar rapportera
 *     butiken varje måndag, och nattkedjan slutar bränna tid på anrop som ändå 403:ar.
 *   • Retailern lämnas AKTIV och offers rörs INTE → de 9 befintliga köplänkarna
 *     fungerar för användare (de surfar från vanliga IP:n) och ligger kvar på
 *     produktsidorna. Det är hela poängen med beslutet. (9, inte 102: hundratalet i
 *     wave 5-noteringen var storleken på butikens FEED, inte på det vi lagrat.)
 *
 * FÖLJD: inga nya produkter, inga prisuppdateringar och ingen lagerstatus från
 * Leksaksaffären. Länkarna fryser på den data de har.
 *
 * ÅNGRA: kör med `--enable` (t.ex. om butiken vitlistar oss).
 *
 * Torrkörning som default. Skriv med `--apply`.
 *   node scripts/with-prod-db.mjs npx tsx scripts/retire-leksaksaffaren-watch.ts --apply
 */
import { prisma } from "../src/lib/db";

const STORE = "Leksaksaffären";
const APPLY = process.argv.includes("--apply");
const ENABLE = process.argv.includes("--enable");

async function main() {
  console.log(APPLY ? "🔧 APPLY — skriver till databasen." : "🔍 TORRKÖRNING — inget skrivs. Kör med --apply.");

  const source = await prisma.scrapeSource.findFirst({ where: { name: STORE } });
  const retailer = await prisma.retailer.findFirst({ where: { name: STORE } });
  if (!source) {
    console.log(`Ingen ScrapeSource heter "${STORE}".`);
    return;
  }

  const offers = retailer ? await prisma.offer.count({ where: { retailerId: retailer.id } }) : 0;
  console.log(`\nKälla:    isActive=${source.isActive} config=${JSON.stringify(source.config)}`);
  console.log(`Retailer: isActive=${retailer?.isActive} (lämnas orörd)`);
  console.log(`Offers:   ${offers} — RÖRS INTE, länkarna fungerar för användare.`);
  console.log(`\nÅtgärd: restockWatch=${ENABLE} , källans isActive=${ENABLE}`);

  if (!APPLY) {
    console.log("\nTorrkörning klar — inget skrevs.");
    return;
  }

  const config = { ...((source.config as Record<string, unknown> | null) ?? {}), restockWatch: ENABLE };
  await prisma.scrapeSource.update({
    where: { id: source.id },
    data: { isActive: ENABLE, config },
  });
  console.log(
    ENABLE
      ? "▶️  Leksaksaffären är tillbaka i bevakningen."
      : "🔕 Leksaksaffären ur bevakningen. Hälsokollen slutar rapportera butiken; länkarna ligger kvar."
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
