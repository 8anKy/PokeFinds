/**
 * Mergar en EXPLICIT, MÄNSKLIGT GODKÄND lista dubblettpar. Ingen fuzzy-matchning:
 * paren nedan är verifierade mot butikssidorna av agenter och godkända av ägaren
 * (2026-07-14). Varje par bär sitt bevis — det är hela poängen med filen.
 *
 * Kör:  node scripts/with-prod-db.mjs npx tsx scripts/merge-approved-dupes.ts          (dry-run)
 *       node scripts/with-prod-db.mjs npx tsx scripts/merge-approved-dupes.ts --apply
 */
import { PrismaClient } from "@prisma/client";
import { mergeStubInto } from "../src/jobs/dedupe-stubs";
import { recomputeProductPriceCache } from "../src/services/products";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");

/** stub = raden som FÖRSVINNER. canonical = raden som ÖVERLEVER (har CM-graf/setId). */
const PAIRS: { stub: string; canonical: string; why: string }[] = [
  {
    stub: "cmqdy7mwa00159rw4i78lzup0", // Mega Evolution: Mega Lucario Mini Tin
    canonical: "cmqdy7mxt001p9rw4gtpocsxn", // Mega Heroes: Mega Lucario Mini Tin
    why: "Samma bild-asset byte för byte (…/32040/mega-heroes-mega-lucario-mini-tin.png). Två CM-SKU:er delar aldrig en bild. 'Mega Evolution' vs 'Mega Heroes' = samma serie, olika namnsättning.",
  },
  {
    stub: "cmr88kbfc00lr29yw5kogkszn", // Pokemon Ancient Roar Booster Box Deluxe (sv4k)(Japansk)
    canonical: "cmr87yr29002poi5xc6jg943n", // Pokémon, S&V: Ancient Roar - sv4K, Display / Booster Box (Japansk)
    why: "Speltrollets sida beskriver en STANDARD japansk sv4K-display: 30 boosterpack, 5 kort/pack. 'Deluxe' står bara i butikens titel, inget i innehållet. Samma set-kod, samma språk, samma antal.",
  },
  {
    stub: "cmq9ja5vy0010k9tz139c8mmo", // Pokemon Day Collection Blister 30 år
    canonical: "cmqdy88ip006p11jhau6aufr5", // Pokémon Day 2026 Collection
    why: "Stubbens egen butiks-URL är spelexperten '/pokemon-tcg-pokemon-day-2026.html' och sidtiteln lyder 'Pokémon TCG: Pokémon Day 2026 Collection'. '30 år' är butikens frasering av 30-årsjubileet.",
  },
  {
    stub: "cmrakmmjr000b5so1uw2dtihb", // Pokémon, Summer Tin 2025 - Koraidon ex
    canonical: "cmqdy7nfw00999rw4za4utpoh", // Slashing Legends Tins: Koraidon ex Tin
    why: "Samlarhobbys sida marknadsför tinnen som del av 'Slashing Legends Tin'-kollektionen för sommaren 2025, Koraidon ex + 4 boosters. OBS: INTE 'Paldea Legends Tins: Koraidon ex Tin' — det är 2023 års tin och en egen SKU.",
  },

  // ── OMSLAGSKONST ÄR INTE EN EGEN SKU ─────────────────────────────────────────
  // Samlarhobby säljer vintage-boosters på PACKETS BILD ("Charizard X Artwork").
  // Cardmarket modellerar INTE omslagskonst som separata SKU:er — det finns en
  // "<Set> Booster Pack" per set. Kortantalet måste dock stämma: "(5 Cards)" och
  // "(3 Cards)"-raderna ÄR egna SKU:er och får aldrig tas emot här.
  // Godkända av ägaren 2026-07-14 efter genomgång.
  {
    stub: "cmr880efk005soi5xw61k139x", // Pokémon, XY: Flashfire, 1 Booster (Charizard X Artwork)
    canonical: "cmqa3f21u007leesw1ekn8hm9", // Flashfire Booster Pack
    why: "Samlarhobby säljer EN sealed XY Flashfire-booster, särskild bara av Charizard X-omslaget. Standardpacket = 10 kort. Kandidaterna 'Flashfire Booster (5 Cards)' och 'Dollar Tree Booster (3 Cards)' är andra kortantal = egna SKU:er.",
  },
  {
    stub: "cmrjzxp12000dmjuuexn9ylnf", // Pokémon, Generations, 1 Booster (Venusaur Artwork)
    canonical: "cmqa3f20k006feeswlwlq2ucs", // Generations Booster Pack
    why: "Ett sealed Generations-booster, särskilt bara av Venusaur-omslaget. Katalogens 'Generations Booster Pack' bär redan en Samlarhobby-offer till samma pris. INTE '(6 Cards)'-raden.",
  },
  {
    stub: "cmr9uw0l2000y27gpmvt3dxvd", // Pokémon, Generations, 1 Booster (Charizard Artwork)
    canonical: "cmqa3f20k006feeswlwlq2ucs", // Generations Booster Pack
    why: "Samma set, samma SKU, annat omslag (Charizard). Går till samma kanoniska rad som Venusaur-varianten ovan.",
  },
  {
    stub: "cmr8805yl005aoi5xlpib2myp", // Pokémon, Sun & Moon: Cosmic Eclipse, 1 Booster (Blastoise Artwork)
    canonical: "cmqa3f1wu0033eeswbn28a7tr", // Cosmic Eclipse Booster Pack
    why: "Ett sealed Cosmic Eclipse-booster (SM12), 10 kort, särskilt bara av Blastoise-omslaget. INTE 3-korts Dollar Tree-boostern.",
  },
  {
    stub: "cmr9v8xvv00118vlosuacdb27", // Pokémon TCG: S&V - Paldean Fates Tin Shiny Charizard ex
    canonical: "cmqdy7n3s004h9rw4l3hcpj3d", // Paldean Fates: Tera Charizard ex Tin
    why: "Dragon's Lair: tin med Shiny Charizard ex-promo + 4 boosters. I Paldean Fates ÄR den shiny Charizard ex:en Tera Charizard ex. Avgörande: DL har en SEPARAT annons '…(USA ed med 5 Boosters)' som är '(US Version)'-SKU:n — den här 4-booster-annonsen är alltså EU-raden, inte US-raden.",
  },
  {
    stub: "cmrij4r2d002k3f11hfnrl4if", // Scarlet & Violet 7 Stellar Crown Checklane Blister - Porygon 2
    canonical: "cmqdy88sa00ef11jh3mnoezwc", // Stellar Crown: Porygon2 1-Pack Blister
    why: "DL: en icke-slumpad Porygon 2-blister med EN booster + holo-promo + mynt. En checklane ÄR en 1-pack-blister (samma SKU, olika ord) — se blisterMismatch. Samma set, samma karaktär, samma antal.",
  },
];

async function main() {
  console.log(APPLY ? "APPLY — skriver till DB.\n" : "DRY-RUN — inget skrivs. Kör med --apply.\n");

  for (const { stub, canonical, why } of PAIRS) {
    const [s, c] = await Promise.all([
      prisma.product.findUnique({
        where: { id: stub },
        select: { id: true, title: true, slug: true, setId: true, lowestPriceOre: true,
          _count: { select: { offers: true, watchlistItems: true, collectionItems: true, priceSnapshots: true } } },
      }),
      prisma.product.findUnique({
        where: { id: canonical },
        select: { id: true, title: true, slug: true, setId: true, lowestPriceOre: true,
          _count: { select: { offers: true, watchlistItems: true, collectionItems: true, priceSnapshots: true } } },
      }),
    ]);
    if (!s || !c) {
      console.error(`✗ HOPPAR ÖVER: ${!s ? `stub ${stub}` : `canonical ${canonical}`} finns inte längre.\n`);
      continue;
    }
    const fmt = (p: typeof s) =>
      `${p!.title}\n       ${p!._count.offers} offers, ${p!._count.priceSnapshots} snapshots, ` +
      `bevak ${p!._count.watchlistItems}, saml ${p!._count.collectionItems}, setId=${p!.setId ?? "–"}, ` +
      `pris=${p!.lowestPriceOre != null ? (p!.lowestPriceOre / 100).toFixed(2) + " kr" : "–"}`;

    console.log(`BORT: ${fmt(s)}`);
    console.log(`KVAR: ${fmt(c)}`);
    console.log(`   ↳ ${why}`);

    if (APPLY) {
      await mergeStubInto(s.id, c.id, (m) => console.log(`      ${m}`));
      await recomputeProductPriceCache([c.id]);
      console.log("   ✔ mergad.");
    }
    console.log("");
  }

  if (!APPLY) console.log(`${PAIRS.length} par redo. Kör med --apply för att skriva.`);
}
main().finally(() => prisma.$disconnect());
