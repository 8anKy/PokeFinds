/**
 * Registrerar Wave 7-butikerna (2026-09-06) som ScrapeSources. Idempotent.
 *
 *   npx tsx scripts/setup-wave7-sources.ts              # torrkörning (visar bara)
 *   npx tsx scripts/setup-wave7-sources.ts --apply      # skriver källorna
 *   npx tsx scripts/setup-wave7-sources.ts --apply --restock   # + restock-bevakning
 *
 * Bakgrund: efter wave 4–6 är VARJE svensk Pokémon-butik på en återanvändbar plattform
 * (Shopify, Quickbutik, WooCommerce, PrestaShop, Starweb) redan inne. Det som återstod
 * var svansen — en egen plattform per butik, alltså ingen hävstång alls. Wave 7 betar
 * av den en butik i taget.
 *
 * ⛔ `name` MÅSTE vara exakt samma sträng som nyckeln i SCRAPER_ADAPTERS och adapterns
 *    egen `name` — getAdapter slår upp på källans namn. adapter-registry.test.ts vaktar
 *    (den läser den här listan).
 * ⛔ Butiker vars adapter inte finns än HOPPAS med varning — adaptrarna byggs i
 *    omgångar och de färdiga ska inte vänta på den sista.
 * ⛔ KÄLLISTAN ÄR DISKCACHAD I 24 h i 10-min-lanen — full effekt inom ett dygn.
 *    Discord-lanen läser sin lista ur ruttabellsfilen, som skrivs av scrape-all.
 * ⛔ FÖRSTA KÖRNINGEN SEEDAS TYST av `restock-feed-events` (källor utan en enda nyckel
 *    i förra lagerläget är NYA) — annars hade butikens hela befintliga sortiment postats
 *    som "ny i lager", precis som när MaxGaming lades till 2026-08-12.
 */
import { PrismaClient, SourceType } from "@prisma/client";
import { getAdapter } from "../src/scrapers/runner";

const prisma = new PrismaClient();

/** Butik → bas-URL. Plattformen står i kommentaren; adaptern avgör resten. */
const WAVE7: { name: string; baseUrl: string }[] = [
  // ---- Nyehandel (ny basadapter, nyehandel-adapter.ts) ----
  // Probad 2026-09-06: 206 produkter i /sv/categories/pokemon-tcg (9 sidor à 25),
  // server-renderad HTML, robots tillåter kategorisidor + ?page=N.
  { name: "Sweet Nerds", baseUrl: "https://sweetnerds.se" },
  // ---- Magento 2 (ny basadapter, magento-adapter.ts) ----
  // Allmän leksaksaffär; TCG:n bor i EN kategori med 14 varor som ryms på en sida.
  // ⛔ robots.txt förbjuder frågesträngar ⇒ ingen paginering. Adaptern varnar själv
  //    om butikens egen räknare överstiger antalet parsade kort.
  { name: "Toyspace", baseUrl: "https://toyspace.se" },
  // ---- Next.js, egen markup (cardhaven-adapter.ts) ----
  // 24 sealed i /shop/pokemon + /shop/pokemon-jp. Singlar och graderat hämtas INTE.
  { name: "Card Haven", baseUrl: "https://cardhaven.se" },
  // ⛔ EJ REGISTRERADE (omprobade 2026-09-06):
  //  · playoteket.com, arcadedreams.se — robots.txt avslutas med
  //    `User-agent: * / Disallow: /`. Vi FÅR inte hämta dem. Öppna inte frågan igen.
  //  · cgpremium — riktigt JSON-API, men `stock` är en förvrängd sträng ⇒ lagerstatus
  //    blir alltid UNKNOWN. Kräver ägarbeslut om vi vill visa pris utan lager.
  //  · Cees Cards (EUR), Kelz0r (DKK), Poromagia (EUR) — pipelinen antar SEK.
  //  · PokéBooster (bot-vägg), CS Megastore (Cloudflare-utmaning), EvoKort (JS-skal
  //    utan data) — ingen adapter kan laga någon av dem.
];

async function main() {
  const apply = process.argv.includes("--apply");
  const restock = process.argv.includes("--restock");

  // Vakta per butik: en källa utan adapter hoppas, en källa MED adapter registreras.
  // Registrera aldrig något getAdapter inte kan slå upp — det blir "Ingen
  // scraper-adapter för …" mitt i en nattkörning.
  const ready = WAVE7.filter((s) => {
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
    // Befintlig config bevaras; `--restock` SLÅR BARA PÅ, aldrig av (samma regel som wave 4/5/6).
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
