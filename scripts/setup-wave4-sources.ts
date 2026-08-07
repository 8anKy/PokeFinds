/**
 * Registrerar Wave 4-butikerna (2026-08-07) som ScrapeSources så att den dagliga
 * `scrape-all` hämtar dem. Idempotent — kör om den hur många gånger som helst.
 *
 *   npx tsx scripts/setup-wave4-sources.ts            # torrkörning (visar bara)
 *   npx tsx scripts/setup-wave4-sources.ts --apply    # skriver
 *
 * ⛔ restockWatch sätts INTE här, med flit. Den snabba lanen kör var 10:e minut (och
 *    Manatörsk-filen var 2:a), och Neon debiteras per VAKEN TID: varje väckning köper
 *    minst 300 s. 23 nya butiker i den lanen är ett KOSTNADSBESLUT, inte en teknisk
 *    detalj — de dagliga körningarna ger pris och lager ändå. Vill man slå på det för
 *    en butik är det en rad: `config.restockWatch = true` (se setup-restock-sources.ts).
 *
 * ⛔ `name` MÅSTE vara exakt samma sträng som nyckeln i SCRAPER_ADAPTERS och adapterns
 *    egen `name` — getAdapter slår upp på källans namn. Glider de isär kastar körningen
 *    "Ingen scraper-adapter för …" mitt i natten. adapter-registry.test.ts vaktar det.
 */
import { PrismaClient, SourceType } from "@prisma/client";
import { getAdapter } from "../src/scrapers/runner";

const prisma = new PrismaClient();

/** Butik → bas-URL. Plattformen står i kommentaren; adaptern avgör resten. */
const WAVE4: { name: string; baseUrl: string }[] = [
  // ---- Shopify ----
  { name: "TCG Store", baseUrl: "https://tcgstore.se" },
  { name: "Beam Cardshop", baseUrl: "https://beamcardshop.com" },
  { name: "Hobbykort", baseUrl: "https://hobbykort.se" },
  { name: "Pokétalk", baseUrl: "https://www.poketalk.se" },
  { name: "Kanto Vault", baseUrl: "https://kantovault.se" },
  { name: "Pokemurre", baseUrl: "https://pokemurre.se" },
  { name: "AuroraDex", baseUrl: "https://auroradex.se" },
  { name: "Tiny Misters", baseUrl: "https://tinymisters.com" },
  { name: "Cardlevels", baseUrl: "https://cardlevels.se" },
  { name: "Kortarkivet", baseUrl: "https://www.kortarkivet.se" },
  { name: "RahTech", baseUrl: "https://rahtech.se" },
  { name: "Card Club", baseUrl: "https://cardclub.se" },
  { name: "Blindbox", baseUrl: "https://blindbox.se" },
  { name: "RGB Kingz", baseUrl: "https://rgbkingz.com" },
  { name: "Miniature Metropolis", baseUrl: "https://miniaturemetropolis.se" },
  { name: "Pokexclusive", baseUrl: "https://pokexclusive.se" },
  { name: "Spelgalaxen", baseUrl: "https://spelgalaxen.se" },
  // ---- Quickbutik ----
  { name: "CardGame", baseUrl: "https://cardgame.se" },
  { name: "Mystery Shack", baseUrl: "https://mysteryshack.se" },
  { name: "Packs on Packs", baseUrl: "https://packsonpacks.se" },
  // ---- WooCommerce ----
  { name: "Fantasia North", baseUrl: "https://fantasianorth.com" },
  { name: "The Swedish Fish", baseUrl: "https://theswedishfish.se" },
  { name: "Pocketmonsters", baseUrl: "https://pocketmonsters.se" },
];

async function main() {
  const apply = process.argv.includes("--apply");

  // Vakt FÖRST: en källa utan adapter blir ett rött jobb, inte ett tyst hopp.
  const missing = WAVE4.filter((s) => {
    try {
      getAdapter(SourceType.SCRAPER, s.name);
      return false;
    } catch {
      return true;
    }
  });
  if (missing.length) {
    console.error(`AVBRYTER — saknar adapter för: ${missing.map((m) => m.name).join(", ")}`);
    process.exit(1);
  }

  for (const s of WAVE4) {
    const existing = await prisma.scrapeSource.findFirst({ where: { name: s.name } });
    if (!apply) {
      console.log(`${existing ? "uppdateras" : "SKAPAS   "}  ${s.name.padEnd(22)} ${s.baseUrl}`);
      continue;
    }
    // Befintlig config bevaras — en butik som någon redan flaggat för restockWatch
    // ska inte tappa flaggan för att det här skriptet körs om.
    const config = { ...((existing?.config as object) ?? {}) };
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
  const active = await prisma.scrapeSource.count({ where: { isActive: true, type: SourceType.SCRAPER } });
  console.log(`\nAktiva SCRAPER-källor totalt: ${active}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
