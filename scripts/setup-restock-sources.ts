/**
 * Skapar/aktiverar ScrapeSources för restock-bevakning (Wave 1: Shopify-butiker)
 * och flaggar dem + befintliga butiker med config.restockWatch=true så att den
 * frekventa restock-watch-jobbet kör dem. Idempotent.
 */
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

// Nya restock-källor (adaptrar finns i runner SCRAPER_ADAPTERS)
const NEW_SHOPIFY = [
  { name: "Speltrollet", baseUrl: "https://speltrollet.se" }, // Shopify
  { name: "Samlarhobby", baseUrl: "https://samlarhobby.se" }, // Shopify
  { name: "Goblinen", baseUrl: "https://goblinen.com" }, // Shopify
  { name: "Swepoke", baseUrl: "https://www.swepoke.se" }, // Quickbutik
  { name: "Shinycards", baseUrl: "https://www.shinycards.se" }, // Quickbutik
];
// Befintliga butiker som ska med i den frekventa restock-bevakningen
const EXISTING_WATCH = ["Webhallen", "Spelexperten", "Alphaspel"];

async function main() {
  for (const s of NEW_SHOPIFY) {
    const existing = await prisma.scrapeSource.findFirst({ where: { name: s.name } });
    const config = { ...(existing?.config as object ?? {}), restockWatch: true };
    if (existing) {
      await prisma.scrapeSource.update({ where: { id: existing.id }, data: { baseUrl: s.baseUrl, type: "SCRAPER", isActive: true, config } });
      console.log(`uppdaterad: ${s.name}`);
    } else {
      await prisma.scrapeSource.create({ data: { name: s.name, baseUrl: s.baseUrl, type: "SCRAPER", isActive: true, config } });
      console.log(`skapad:     ${s.name}`);
    }
  }
  for (const name of EXISTING_WATCH) {
    const src = await prisma.scrapeSource.findFirst({ where: { name } });
    if (!src) { console.log(`SAKNAS:     ${name} (hoppar)`); continue; }
    const config = { ...(src.config as object ?? {}), restockWatch: true };
    await prisma.scrapeSource.update({ where: { id: src.id }, data: { isActive: true, config } });
    console.log(`flaggad:    ${name} (restockWatch)`);
  }
  const watched = await prisma.scrapeSource.findMany({ where: { isActive: true }, select: { name: true, config: true } });
  console.log("\nRestock-watch-källor:", watched.filter((w) => (w.config as any)?.restockWatch).map((w) => w.name).join(", "));
}
main().finally(() => prisma.$disconnect());
