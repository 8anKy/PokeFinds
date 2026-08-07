/**
 * Registrerar Wave 4-butikerna (2026-08-07) som ScrapeSources så att den dagliga
 * `scrape-all` hämtar dem. Idempotent — kör om den hur många gånger som helst.
 *
 *   npx tsx scripts/setup-wave4-sources.ts              # torrkörning (visar bara)
 *   npx tsx scripts/setup-wave4-sources.ts --apply      # skriver källorna
 *   npx tsx scripts/setup-wave4-sources.ts --apply --restock   # + restock-bevakning
 *
 * RESTOCK-BEVAKNING = ÄGARBESLUT 2026-08-08, taget PÅ MÄTNING. Lanen kör var 10:e minut
 * och Neon debiteras per VAKEN TID (varje väckning köper minst 300 s), så frågan var hur
 * många fler VÄCKNINGAR 23 butiker ger — inte hur många rader.
 *
 * Underlaget (14 dygn, 11 bevakade butiker): 75,2 lagerflippar/dygn, varav **Dragon's
 * Lair ensam står för 63,1 (84 %)**. Flipparna faller i 33,7 distinkta 10-minutersfönster
 * per dygn av 144 möjliga. Per offer, UTAN Dragon's Lair: 1,27 flippar per 100 offers och
 * dygn. Wave 4 har 1 610 offers ⇒ ~20 extra flippar/dygn ⇒ ~11 extra väckningar/dygn
 * (Neon är redan vaken 41 % av dygnet) ⇒ ~13 CU-h/mån ⇒ **~1,50 $/mån** ovanpå ~14 $.
 * Pessimistiskt (alla flappar som DL): ~5 $/mån. Absolut tak (Neon somnar aldrig): +20 $.
 *
 * ⛔ **EN ENDA BUTIK KAN DOMINERA NOTAN.** Dragon's Lair är 84 % av all churn med 22 % av
 *    offersen. Vilken av de 23 som blir nästa DL går inte att veta i förväg — mät om
 *    efter några dygn (samma fråga: flippar/dygn per butik, och distinkta 10-min-fönster)
 *    innan slutsatsen "det blev billigt" dras.
 * ⛔ **KÄLLISTAN ÄR DISKCACHAD I 24 h** (`<grindfil>.sources.json`, SOURCES_TTL_MS i
 *    scripts/restock-watch-run.ts). En ändring här slår alltså igenom först inom ett
 *    dygn — det är inte ett fel, och lanen ska INTE göra ett DB-uppslag per körning för
 *    att slippa väntan (det var precis det som höll computen vaken dygnet runt).
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
  const restock = process.argv.includes("--restock");

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
      console.log(
        `${existing ? "uppdateras" : "SKAPAS   "}  ${s.name.padEnd(22)} ${s.baseUrl}${restock ? "  + restockWatch" : ""}`
      );
      continue;
    }
    // Befintlig config bevaras — en butik som någon redan flaggat för restockWatch
    // ska inte tappa flaggan för att det här skriptet körs om.
    // ⛔ `--restock` SLÅR BARA PÅ, aldrig av: att köra skriptet utan flaggan får inte
    //    tyst avaktivera bevakningen för butiker någon medvetet slagit på.
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
