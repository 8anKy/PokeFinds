/**
 * Registrerar Wave 5-butikerna (2026-08-13) som ScrapeSources. Idempotent.
 *
 *   npx tsx scripts/setup-wave5-sources.ts              # torrkörning (visar bara)
 *   npx tsx scripts/setup-wave5-sources.ts --apply      # skriver källorna
 *   npx tsx scripts/setup-wave5-sources.ts --apply --restock   # + restock-bevakning
 *
 * Bakgrund: ägaren pekade 2026-08-13 ut två konkurrentlistors butiker + Carsmästaren.
 * Wave 5 = de som gick att verifiera mot riktiga feedar samma dag (probe-rapporten i
 * sessionen): 4 Shopify (Aquitaz, Rogerz, Yonko TCG, Firegames — Rogerz/Yonko är
 * utländska men Shopify Markets ger verifierat SEK via localization=SE-cookien),
 * 1 Quickbutik (Spelkortsbutiken), 3 PrestaShop (Playoteket, Leksaksaffären,
 * NordicTCG), 1 Starweb (Coolcard) och 1 Abicart (Carsmästaren).
 *
 * ⛔ `name` MÅSTE vara exakt samma sträng som nyckeln i SCRAPER_ADAPTERS och adapterns
 *    egen `name` — getAdapter slår upp på källans namn. adapter-registry.test.ts vaktar.
 * ⛔ Butiker vars adapter inte finns än HOPPAS med varning (inte abort som wave 4):
 *    adaptrarna byggs i omgångar och de färdiga ska inte vänta på den sista.
 * ⛔ KÄLLISTAN ÄR DISKCACHAD I 24 h i 10-min-lanen — full effekt inom ett dygn.
 */
import { PrismaClient, SourceType } from "@prisma/client";
import { getAdapter } from "../src/scrapers/runner";

const prisma = new PrismaClient();

/** Butik → bas-URL. Plattformen står i kommentaren; adaptern avgör resten. */
const WAVE5: { name: string; baseUrl: string }[] = [
  // ---- Shopify ----
  { name: "Aquitaz", baseUrl: "https://aquitaz.se" },
  { name: "Rogerz", baseUrl: "https://rogerz.dk" },
  { name: "Yonko TCG", baseUrl: "https://yonko-tcg.de" },
  { name: "Firegames", baseUrl: "https://firegames.se" },
  // ---- Quickbutik ----
  { name: "Spelkortsbutiken", baseUrl: "https://www.spelkortsbutiken.se" },
  // ---- PrestaShop (delad adapter) ----
  { name: "Leksaksaffären", baseUrl: "https://leksaksaffaren.com" },
  { name: "NordicTCG", baseUrl: "https://nordictcg.se" },
  // ---- Starweb ----
  { name: "Coolcard", baseUrl: "https://coolcard.se" },
  // ⛔ PLAYOTEKET ÄR ROBOTS-BLOCKERAD (omverifierat 2026-08-13): robots.txt SLUTAR med
  //    ett andra `User-agent: *`-block med `Disallow: /` (bara Googlebot/Slurp/msnbot
  //    släpps in) — läs alltid HELA filen, toppen ser ut som standard-PrestaShop.
  //    Samma dom som 2026-07-03. Adaptern finns (delade PrestaShop-basen) men butiken
  //    får inte registreras utan att robots ändras på riktigt.
  // ⛔ CARSMÄSTAREN EJ REGISTRERAD: datat bor i Abicarts JSON-RPC (webshop 89109,
  //    verifierad fungerande) men VARJE värd som serverar den har `Disallow: /backend`
  //    i robots.txt. Dokumenterat publikt API vs robots-protokoll = ÄGARBESLUT.
];

async function main() {
  const apply = process.argv.includes("--apply");
  const restock = process.argv.includes("--restock");

  // Vakta per butik: en källa utan adapter hoppas (kommer i nästa omgång), en källa
  // MED adapter registreras. Registrera aldrig något getAdapter inte kan slå upp —
  // det blir "Ingen scraper-adapter för …" mitt i en nattkörning.
  const ready = WAVE5.filter((s) => {
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
    // Befintlig config bevaras; `--restock` SLÅR BARA PÅ, aldrig av (samma regel som wave 4).
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
  console.log(`Restock-bevakade: ${watched.length} — ${watched.map((w) => w.name).join(", ")}`);
  console.log(`\nOBS: 10-min-lanen läser källistan ur en 24-timmarscache. Full effekt inom ett dygn.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
