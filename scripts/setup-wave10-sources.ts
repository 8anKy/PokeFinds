/**
 * Registrerar Wave 10-butiken (2026-10-15: Spel & Sånt) som ScrapeSource. Idempotent.
 *
 *   npx tsx scripts/setup-wave10-sources.ts              # torrkörning (visar bara)
 *   npx tsx scripts/setup-wave10-sources.ts --apply      # skriver källan
 *   npx tsx scripts/setup-wave10-sources.ts --apply --restock   # + restock-bevakning
 *
 * Samma regler som wave 4–9 (se setup-wave7-sources.ts för hela resonemanget):
 * ⛔ `name` MÅSTE vara exakt samma sträng som nyckeln i SCRAPER_ADAPTERS och adapterns
 *    egen `name` — adapter-registry.test.ts läser den här listan och vaktar det.
 * ⛔ KÄLLISTAN ÄR DISKCACHAD I 24 h i restock-lanen — full effekt inom ett dygn.
 * ⛔ FÖRSTA KÖRNINGEN SEEDAS TYST av `restock-feed-events` (en källa utan tidigare
 *    lagerläge är NY) — annars hade butikens hela sortiment postats som "ny i lager".
 */
import { PrismaClient, SourceType } from "@prisma/client";
import { getAdapter } from "../src/scrapers/runner";

const prisma = new PrismaClient();

/** Butik → bas-URL. Plattformen står i kommentaren; adaptern avgör resten. */
const WAVE10: { name: string; baseUrl: string }[] = [
  // Probad 2026-10-15. Egen PHP-butik + Vue-listning; POST /products/json, kategori 192
  // ("Pokemon Kort"), 50/anrop. robots.txt tom = allt tillåtet. Knappen dömer
  // (buy/booking/subscribe). Namnet MÅSTE vara retailerns befintliga "Spel & Sånt".
  { name: "Spel & Sånt", baseUrl: "https://www.spelochsant.se" },
];

async function main() {
  const apply = process.argv.includes("--apply");
  const restock = process.argv.includes("--restock");

  const ready = WAVE10.filter((s) => {
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
    // Befintlig config bevaras; `--restock` SLÅR BARA PÅ, aldrig av (samma regel som wave 4–7).
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
  console.log(`\nOBS: restock-lanen läser källistan ur en 24-timmarscache. Full effekt inom ett dygn.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
