/**
 * Registrerar Wave 6-butikerna (2026-08-17) som ScrapeSources. Idempotent.
 *
 *   npx tsx scripts/setup-wave6-sources.ts              # torrkörning (visar bara)
 *   npx tsx scripts/setup-wave6-sources.ts --apply      # skriver källorna
 *   npx tsx scripts/setup-wave6-sources.ts --apply --restock   # + restock-bevakning
 *
 * Bakgrund: ägaren såg 2026-08-17 en Storm Emeralda-restock hos **TCG Picks** i en
 * KONKURRENTS Discord men inte i vår — butiken fanns inte som källa alls. Probad
 * samma dag: Shopify, SEK, `/products.json` svarar (888 produkter = 4 hämtningar),
 * robots.txt tillåter (`Allow: /`, inga regler som rör products.json), 55 sealed
 * varav "Storm Emeralda Booster Box" och "Storm Emeralda Booster Pack".
 * ⛔ Bas-URL:en är `.com`: `tcgpicks.se` 301:ar dit, och en 301 är gratis bara för
 *    webbläsare — adaptern bygger sina egna feed-URL:er.
 *
 * ⛔ `name` MÅSTE vara exakt samma sträng som nyckeln i SCRAPER_ADAPTERS och adapterns
 *    egen `name` — getAdapter slår upp på källans namn. adapter-registry.test.ts vaktar
 *    (den läser den här listan).
 * ⛔ Butiker vars adapter inte finns än HOPPAS med varning — adaptrarna byggs i
 *    omgångar och de färdiga ska inte vänta på den sista.
 * ⛔ KÄLLISTAN ÄR DISKCACHAD I 24 h i 10-min-lanen — full effekt inom ett dygn.
 *    Discord-lanen läser sin lista ur ruttabellsfilen, som skrivs av scrape-all.
 */
import { PrismaClient, SourceType } from "@prisma/client";
import { getAdapter } from "../src/scrapers/runner";

const prisma = new PrismaClient();

/** Butik → bas-URL. Plattformen står i kommentaren; adaptern avgör resten. */
const WAVE6: { name: string; baseUrl: string }[] = [
  // ---- Shopify ----
  { name: "TCG Picks", baseUrl: "https://tcgpicks.com" },
  // ⛔ EJ REGISTRERADE (omprobade 2026-08-17, samma dag):
  //  · arcadedreams.se — robots.txt listar tillåtna bottar och SLUTAR med
  //    `# Block all other unknown bots` + `User-agent: * / Disallow: /`. Noteringen
  //    2026-08-13 om att blanket-spärren var borta är FEL (hela filen läst nu).
  //  · playoteket.com — samma spärr, oförändrad.
  //  · cardhaven.se, toyspace.se, sweetnerds.se, spelochsant.se — riktiga
  //    Pokémon-sortiment och robots tillåter, men var sin egen plattform
  //    (Next.js / Magento 2 / "Ny Ehandel" / jQuery-SPA) = en adapter var.
  //  · kortbutiken.se — Quickbutik, men det är en VYKORTSbutik. Ingen TCG.
  //  · tcgshop.se, pokestore.se — Loopia-parkeringssidor, inga butiker.
];

async function main() {
  const apply = process.argv.includes("--apply");
  const restock = process.argv.includes("--restock");

  // Vakta per butik: en källa utan adapter hoppas, en källa MED adapter registreras.
  // Registrera aldrig något getAdapter inte kan slå upp — det blir "Ingen
  // scraper-adapter för …" mitt i en nattkörning.
  const ready = WAVE6.filter((s) => {
    try {
      getAdapter(SourceType.SCRAPER, s.name);
      return true;
    } catch {
      console.warn(`HOPPAR   ${s.name.padEnd(22)} — ingen adapter registrerad än`);
      return false;
    }
  });

  for (const s of ready) {
    const existing = await prisma.scrapeSource.findFirst({ where: { name: s.name } });
    if (!apply) {
      console.log(
        `${existing ? "uppdateras" : "SKAPAS   "}  ${s.name.padEnd(22)} ${s.baseUrl}${restock ? "  + restockWatch" : ""}`
      );
      continue;
    }
    // Befintlig config bevaras; `--restock` SLÅR BARA PÅ, aldrig av (samma regel som wave 4/5).
    const config = { ...((existing?.config as object) ?? {}), ...(restock ? { restockWatch: true } : {}) };
    if (existing) {
      await prisma.scrapeSource.update({
        where: { id: existing.id },
        data: { baseUrl: s.baseUrl, type: SourceType.SCRAPER, isActive: true, config },
      });
      console.log(`uppdaterad: ${s.name}`);
    } else {
      await prisma.scrapeSource.create({
        data: { name: s.name, baseUrl: s.baseUrl, type: SourceType.SCRAPER, isActive: true, config },
      });
      console.log(`skapad:     ${s.name}`);
    }
  }

  if (!apply) {
    console.log(`\nTorrkörning — inget skrevs. Kör med --apply.`);
    return;
  }
  const all = await prisma.scrapeSource.findMany({
    where: { isActive: true, type: SourceType.SCRAPER },
    select: { name: true, config: true },
  });
  const watched = all.filter((s) => (s.config as { restockWatch?: boolean } | null)?.restockWatch === true);
  console.log(`\nAktiva SCRAPER-källor totalt: ${all.length}`);
  console.log(`Restock-bevakade: ${watched.length}`);
  console.log(`\nOBS: 10-min-lanen läser källistan ur en 24-timmarscache. Full effekt inom ett dygn.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
