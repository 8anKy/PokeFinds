/**
 * Verkställer ägarens handgranskade kataloglista 2026-08-08 ("Duplicates.txt"):
 * sealed-dubbletter slås in i den korrekta produkten, och felaktiga/icke-katalog-
 * poster raderas. Källan är ägarens egen genomgång — varje rad nedan är ETT beslut
 * ur den filen, aldrig en regel.
 *
 *   node scripts/with-prod-db.mjs npx tsx scripts/apply-owner-catalog-cleanup-2026-08-08.ts
 *   node scripts/with-prod-db.mjs npx tsx scripts/apply-owner-catalog-cleanup-2026-08-08.ts --apply
 *
 * Ägarens direktiv i filen:
 *  - Dubblettens CARDMARKET-länk ska HOPPAS ÖVER (målet bär redan rätt CM-länk)
 *    → dubblettens CM-offer raderas FÖRE mergen så den aldrig kan flytta med.
 *  - Jet Black Spirit-dubbletten har BÄTTRE BILD än målet → takeImage kopierar den.
 *  - Black Bolt & White Flare-kombon raderas och dess butikslänkar är FEL → alla
 *    raderade produkters butiks-URL:er skrivs ut för import-denylist.ts (radering
 *    utan denylist återskapas av nästa import — se purge-non-catalog-products.ts).
 *
 * mergeStubInto flyttar offers/bevakningar/samlingsposter och raderar dubbletten;
 * krockande offers (samma butik+skick+språk på målet) raderas — deras URL:er skrivs
 * ut som "släppt URL" så de kan denylistas om de visar sig återuppstå som stubbar.
 */
import { prisma } from "../src/lib/db";
import { mergeStubInto } from "../src/jobs/dedupe-stubs";
import { recomputeProductPriceCache } from "../src/services/products";

const APPLY = process.argv.includes("--apply");

interface MergeGroup {
  dups: string[];
  target: string;
  /** Kopiera dubblettens bild till målet ÄVEN om målet redan har en (ägarens ord). */
  takeImage?: boolean;
  note?: string;
}

const MERGES: MergeGroup[] = [
  { dups: ["pokemon-munikis-zero-booster-box-m3-jp"], target: "pokemon-mega-nihil-zero-m3-display-booster-box-japansk" },
  { dups: ["boosterbox-med-japansk-lera"], target: "pokemon-scarlet-violet-clay-burst-booster-box-japansk" },
  { dups: ["pokemon-vmax-climax-s8b-sealed-booster-box-japansk"], target: "pokemon-sword-shield-vmax-climax-display-booster-box-japansk" },
  { dups: ["mega-evolution-base-set-booster-box"], target: "pokemon-tcg-mega-evolution-booster-box" },
  {
    dups: ["pokemon-sword-shield-jet-black-spirit-booster-box"],
    target: "pokemon-jet-black-spirit-poltergeist-booster-box-s6k-japansk",
    takeImage: true,
    note: "ägaren: dubblettens bild är bättre — ta den",
  },
  {
    dups: ["storm-emerald-booster-box-forbestallning"],
    target: "pokemon-mega-storm-emeralda-booster-box-japansk",
    note: "ägaren: fokusera på storm emeralda",
  },
  { dups: ["pokemon-mega-mega-evolution-booster-pack-engelska"], target: "pokemon-tcg-mega-evolution-booster-max-6-per-kund" },
  { dups: ["pokemon-sv10-destined-rivals-booster-pack"], target: "pokemon-tcg-scarlet-violet-destined-rivals-booster-pack-iphwl" },
  {
    dups: [
      "pokemon-mega-nullifying-zero-nihil-zero-booster-pack-m3-japansk",
      "pokemon-mega-nihil-zero-booster-pack-japansk",
      "pokemon-munikis-zero-booster-pack-m3-jp",
    ],
    target: "pokemon-tcg-nihil-munekis-zero-booster-pack-japansk-m3",
  },
  { dups: ["pokemon-sv8-surging-sparks-3-pack-booster-blister"], target: "surging-sparks-quagsire-3-pack-blister" },
  { dups: ["surging-sparks-3p-blister"], target: "surging-sparks-zapdos-3-pack-blister" },
  { dups: ["pokemon-mega-inferno-x-booster-pack-japanese"], target: "pokemon-tcg-inferno-x-booster-japansk" },
  {
    // "add these ones together" — inget mål utpekat. Målet är den CM-seedade
    // 30th Celebration-produkten (setet skapades ur CM-episod 431); riktningen
    // verifieras i torrkörningen (målet ska vara rikare).
    dups: ["forbokning-pokemon-30th-anniversary-celebration-m6-mega-booster-pack-japansk"],
    target: "pokemon-30th-celebration-booster-pack-japansk",
  },
  {
    dups: ["pokemon-vstar-universe-booster-pack-s12a-japanese", "vstar-universe-booster-pack-japansk"],
    target: "pokemon-tcg-sword-shield-high-class-pack-vstar-universe-booster-japansk",
  },
  { dups: ["25th-anniversary-celebrations-booster-pack"], target: "celebrations-cel25-booster-pack" },
  { dups: ["pokemon-sv6-5-shrouded-fable-3-pack-booster-pack-blister"], target: "shrouded-fable-pecharunt-3-pack-blister" },
  { dups: ["pokemon-scarlet-violet-black-bolt-booster-pack-japansk"], target: "pokemon-scarlet-violet-black-bolt-sv11b-1-booster-pack-japansk" },
  { dups: ["pokemon-sv3-3-pack-booster-pack-blister"], target: "scarlet-violet-arcanine-3-pack-blister" },
  { dups: ["pokemon-shiny-treasure-ex-sv4a-booster-pack-japanese"], target: "shiny-treasure-ex-booster-pack-japansk" },
  { dups: ["packbattle-mega-evolution-booster-pack"], target: "pokemon-tcg-mega-evolution-booster-max-6-per-kund" },
  { dups: ["all-night-pack-battle-crown-zenith-booster-pack-2026-07-31-tills-stream-avslutas"], target: "pokemon-tcg-crown-zenith-booster-pack" },
  { dups: ["fusion-strike-checklane-blister-1-booster"], target: "fusion-strike-blitzle-1-pack-blister" },
  { dups: ["pokemon-mega-evolution-2-5-ascend-heroes-elite-trainer-box"], target: "ascended-heroes-me2pt5-elite-trainer-box" },
  {
    dups: [
      "pokemon-mega-evolution-pokemon-center-chaos-rising-elite-trainer-box",
      "pokemon-chaos-rising-pokemon-center-elite-trainer-box",
    ],
    target: "chaos-rising-pokemon-center-elite-trainer-box",
  },
  { dups: ["prismatic-elite-trainer-box-samlarskick"], target: "pokemon-tcg-prismatic-evolutions-elite-trainer-box" },
  { dups: ["mega-evolution-etb-pokemon-center-gardevoir"], target: "mega-evolution-mega-gardevoir-pokemon-center-elite-trainer-box" },
  {
    dups: ["pokemon-phantasmal-flames-pokemon-center-elite-trainer-box", "phantasmal-flames-etb-pokemon-center"],
    target: "phantasmal-flames-pokemon-center-elite-trainer-box",
  },
  { dups: ["pokemon-sword-shield-10-5-pokemon-go-elite-trainer-box"], target: "pokemon-go-pgo-elite-trainer-box" },
  { dups: ["xy-evolutions-elite-trainer-box-lite-reva-plasten"], target: "evolutions-elite-trainer-box-charizard" },
  { dups: ["hidden-fates-elite-trainer-box-litet-slapp-framtill-hel-i-plasten"], target: "hidden-fates-sm115-elite-trainer-box" },
  { dups: ["perfect-order-etb-pokemon-center"], target: "perfect-order-pokemon-center-elite-trainer-box" },
  { dups: ["phantsmal-flames-etb"], target: "pokemon-tcg-phantasmal-flames-elite-trainer-box" },
  { dups: ["pokemon-mega-charizard-x-ex-tin-spring-2026-blue"], target: "mega-charizard-x-ex-tin" },
  { dups: ["pokemon-mega-gengar-ex-tin-summer-2026"], target: "mega-moonlit-tins-mega-gengar-ex-tin" },
  { dups: ["pokemon-mega-charizard-y-ex-tin-spring-2026-red"], target: "mega-charizard-y-ex-tin" },
  { dups: ["summer-tin-2026-mega-clefable-ex"], target: "mega-moonlit-tins-mega-clefable-ex-tin" },
  { dups: ["pokemon-scarlet-violet-4-5-paldean-fates-tin-shiny-charizard-ex"], target: "paldean-fates-tera-charizard-ex-tin" },
  { dups: ["pokemon-scarlet-violet-4-5-paldean-fates-special-tin-shiny-charizard-ex"], target: "paldean-fates-tera-charizard-ex-tin-us-version" },
  { dups: ["pokemon-scarlet-violet-4-5-paldean-fates-tin-shiny-great-tusk-ex"], target: "paldean-fates-great-tusk-ex-tin" },
  { dups: ["pokemon-scarlet-violet-4-5-paldean-fates-special-tin-shiny-great-tusk-ex"], target: "paldean-fates-great-tusk-ex-tin-us-version" },
  { dups: ["pokemon-scarlet-violet-4-5-paldean-fates-tin-shiny-iron-treads-ex"], target: "paldean-fates-iron-treads-ex-tin" },
  { dups: ["pokemon-scarlet-violet-4-5-paldean-fates-special-tin-shiny-iron-treads-ex"], target: "paldean-fates-iron-treads-ex-tin-us-version" },
  { dups: ["pokemon-sv10-5-black-bolt-white-flare-unova-mini-tin"], target: "black-bolt-white-flare-unova-mienshao-mini-tin" },
  { dups: ["pokemon-me01-mega-evolution-mini-tin"], target: "mega-evolution-mega-venusaur-mini-tin" },
  { dups: ["pokemon-sv6-twilight-masquerade-premium-checklane-blister"], target: "twilight-masquerade-kingdra-premium-checklane-blister" },
  { dups: ["pokemon-sv6-twilight-masquerade-blister-3-pack"], target: "twilight-masquerade-snorlax-3-pack-blister" },
  { dups: ["pokemon-sv6-twilight-masquerade-checklane-blister"], target: "twilight-masquerade-pupitar-1-pack-blister" },
  { dups: ["pokemon-swsh12-silver-tempest-premium-checklane-blister-pack"], target: "silver-tempest-magnezone-premium-checklane-blister" },
  { dups: ["pokemon-swsh12-silver-tempest-checklane-blister-pack"], target: "silver-tempest-cranidos-1-pack-blister" },
  { dups: ["pokemon-scarlet-violet-4-5-paldean-fates-tech-sticker-collection-blister-shiny-greavard"], target: "paldean-fates-greavard-tech-sticker-collection" },
  { dups: ["pokemon-scarlet-violet-4-5-paldean-fates-tech-sticker-collection-blister-shiny-maschiff"], target: "paldean-fates-maschiff-tech-sticker-collection" },
  {
    dups: [
      "pokemon-scarlet-violet-4-5-paldean-fates-tech-sticker-collection-blister-shiny-fidough",
      "paldean-fates-3-pack-blister-tech-sticker",
    ],
    target: "paldean-fates-fidough-tech-sticker-collection",
  },
  { dups: ["pokemon-ascend-heroes-3-pack-blister-gastly"], target: "ascended-heroes-gastly-tech-sticker-collection" },
  { dups: ["pokemon-ascend-heroes-3-pack-blister-charmander"], target: "ascended-heroes-charmander-tech-sticker-collection" },
  { dups: ["pokemon-sv4-paradox-rift-checklane-blister-pack"], target: "paradox-rift-sinistea-1-pack-blister" },
  { dups: ["paradox-rift-premium-checklane-blister-tinkatink"], target: "paradox-rift-tinkaton-premium-checklane-blister" },
  { dups: ["paradox-rift-premium-checklane-blister-deino"], target: "paradox-rift-hydreigon-premium-checklane-blister" },
  { dups: ["pokemon-sv3-obsidian-flames-checklane-blister-pack"], target: "obsidian-flames-pawmi-1-pack-blister" },
  { dups: ["pokemon-sv9-journey-together-blister-3-pack"], target: "journey-together-yanmega-3-pack-blister" },
  { dups: ["pokemon-scarlet-violet-7-stellar-crown-premium-checklane-blister-roaring-moon"], target: "stellar-crown-ancient-premium-checklane-blister" },
  { dups: ["pokemon-sv7-stellar-crown-3-pack-blister"], target: "stellar-crown-latias-3-pack-blister" },
  { dups: ["pokemon-sv5-temporal-forces-blister-3-pack"], target: "temporal-forces-cyclizar-3-pack-blister" },
  { dups: ["pokemon-sv8-surging-sparks-checklane-blister-pack"], target: "surging-sparks-wooper-1-pack-blister" },
  { dups: ["pokemon-sv8-surging-sparks-premium-checklane-blister"], target: "surging-sparks-alakazam-premium-checklane-blister" },
  {
    dups: [
      "mega-evolution-chaos-rising-blister-3-pack",
      "pokemon-mega-evolutions-chaos-rising-3-pack-blister",
      "pokemon-mega-evolution-8211-chaos-rising-3-pack-blister",
      "pokemon-mega-evolution-chaos-rising-3-pack-blister-me04",
    ],
    target: "chaos-rising-charmeleon-3-pack-blister",
  },
  { dups: ["pokemon-scarlet-violet-mew-151-booster-bundle"], target: "151-booster-bundle" },
];

const DELETES: { slug: string; why: string }[] = [
  { slug: "pokemon-scarlet-violet-black-bolt-och-white-flare-booster-boxes-japansk", why: "ägaren: butikslänkarna är FEL — radera och denylista dem" },
  { slug: "delta-species-ex11-booster-box", why: "ägaren: radera" },
  { slug: "journey-together-booster-pack-mini-portfolio", why: "tillbehör (mini-portfolio) med booster" },
  { slug: "pokemon-sv1-base-set-sleeved-booster-pack", why: "ägaren: radera" },
  { slug: "2026-spring-mini-album-with-booster", why: "tillbehör (mini-album)" },
  { slug: "pokemon-scarlet-violet-151-ultra-premium-collection-jumbo-mynt", why: "tillbehör (jumbo-mynt)" },
  { slug: "naruto-mythos-tcg-first-set-special-pack-collection-box-skavanker", why: "icke-Pokémon (Naruto)" },
  // Hittade av vaktmätningen (measure-guards-2026-08-08.ts): fyra Naruto-produkter
  // till som ägarens fil inte fångade — samma regel, bara Pokémon i katalogen.
  { slug: "naruto-mythos-tcg-konoha-shido-2nd-edition-booster-box", why: "icke-Pokémon (Naruto)" },
  { slug: "naruto-mythos-tcg-konoha-shido-1st-edition-booster-box", why: "icke-Pokémon (Naruto)" },
  { slug: "naruto-mythos-tcg-konoha-shido-2nd-edition-booster-pack", why: "icke-Pokémon (Naruto)" },
  { slug: "naruto-mythos-tcg-konoha-shido-1st-edition-booster-pack", why: "icke-Pokémon (Naruto)" },
  { slug: "pokemon-lumiose-city-mini-tin-1st-random-tin", why: "generiskt sortiment (1st random tin)" },
  { slug: "pokemon-scarlet-violet-151-mini-tin-art-card-coin-boosters-ingar-ej-kadabra-hitmonlee", why: "tom tin (boosters ingår ej)" },
  { slug: "pokemon-scarlet-violet-151-mini-tin-art-card-coin-boosters-ingar-ej-slowpoke-sandshrew", why: "tom tin (boosters ingår ej)" },
  { slug: "pokemon-scarlet-violet-151-mini-tin-art-card-coin-boosters-ingar-ej-meowth-hitmonchan", why: "tom tin (boosters ingår ej)" },
  { slug: "pokemon-scarlet-violet-151-mini-tin-art-card-coin-boosters-ingar-ej-machamp-cubone", why: "tom tin (boosters ingår ej)" },
  { slug: "pokemon-scarlet-violet-151-mini-tin-art-card-coin-boosters-ingar-ej-dragonite-vileplume", why: "tom tin (boosters ingår ej)" },
  { slug: "pokemon-scarlet-violet-151-mini-tin-art-card-coin-boosters-ingar-ej-magneton-ekans", why: "tom tin (boosters ingår ej)" },
  { slug: "pokemon-scarlet-violet-151-mini-tin-art-card-coin-boosters-ingar-ej-electabuzz-magnemite", why: "tom tin (boosters ingår ej)" },
  { slug: "pokemon-scarlet-violet-151-mini-tin-art-card-coin-boosters-ingar-ej-scyther-weezing", why: "tom tin (boosters ingår ej)" },
  { slug: "pokemon-scarlet-violet-151-mini-tin-art-card-coin-boosters-ingar-ej-arcanine-omanyte", why: "tom tin (boosters ingår ej)" },
  { slug: "pokemon-scarlet-violet-151-mini-tin-art-card-coin-boosters-ingar-ej-gengar-poliwhirl", why: "tom tin (boosters ingår ej)" },
  { slug: "pokemon-collector-s-chest-tin-2025-mega-evolutions-gardevoir-lucario", why: "ägaren: radera" },
  { slug: "pokemon-scarlet-violet-8-5-prismatic-evolutions-mini-tin-assorted", why: "generiskt sortiment (assorted)" },
  { slug: "prismatic-evolutions-mini-tin", why: "generiskt sortiment" },
];

const productPick = {
  id: true,
  title: true,
  slug: true,
  setId: true,
  imageUrl: true,
  category: true,
  offers: { select: { id: true, url: true, condition: true, language: true, retailerId: true, retailer: { select: { name: true } } } },
  _count: { select: { watchlistItems: true, collectionItems: true, priceSnapshots: true } },
} as const;

async function bySlug(slug: string) {
  return prisma.product.findUnique({ where: { slug }, select: productPick });
}

async function main() {
  console.log(APPLY ? "APPLY — skriver.\n" : "DRY-RUN — inget skrivs. Kör med --apply.\n");
  const denylistUrls: string[] = [];
  const releasedUrls: string[] = [];
  let merged = 0;
  let deleted = 0;
  let problems = 0;

  console.log("════════ MERGES ════════");
  for (const g of MERGES) {
    const target = await bySlug(g.target);
    if (!target) {
      console.log(`\n⛔ MÅL SAKNAS: ${g.target} — hela gruppen hoppas över (${g.dups.join(", ")})`);
      problems++;
      continue;
    }
    for (const dupSlug of [...new Set(g.dups)]) {
      if (dupSlug === g.target) continue;
      const dup = await bySlug(dupSlug);
      if (!dup) {
        console.log(`\n  · redan borta: ${dupSlug}`);
        continue;
      }
      const dupCm = dup.offers.filter((o) => o.retailer.name === "Cardmarket");
      const targetKeys = new Set(target.offers.map((o) => `${o.retailerId}|${o.condition}|${o.language}`));
      const willDrop = dup.offers.filter(
        (o) => o.retailer.name !== "Cardmarket" && targetKeys.has(`${o.retailerId}|${o.condition}|${o.language}`)
      );
      console.log(`\n  "${dup.title}"  [${dup.category}${dup.setId ? ", set-märkt" : ""}, ${dup._count.priceSnapshots} snapshots]`);
      console.log(`   → "${target.title}"  [${target.category}${target.setId ? ", set-märkt" : ""}, ${target._count.priceSnapshots} snapshots, ${target.offers.length} offers]`);
      if (g.note) console.log(`     not: ${g.note}`);
      if (dupCm.length) console.log(`     CM-offer på dubbletten RADERAS (flyttas aldrig): ${dupCm.map((o) => o.url).join(" · ")}`);
      for (const o of dup.offers.filter((x) => x.retailer.name !== "Cardmarket")) {
        const dropped = willDrop.some((w) => w.id === o.id);
        console.log(`     ${dropped ? "✂ SLÄPPS (målet har butiken)" : "→ flyttas"}: ${o.retailer.name}: ${o.url}`);
        if (dropped && o.url) releasedUrls.push(o.url);
      }
      if (dup._count.watchlistItems || dup._count.collectionItems) {
        console.log(`     flyttar ${dup._count.watchlistItems} bevakningar, ${dup._count.collectionItems} samlingsposter`);
      }
      if (dup._count.priceSnapshots > target._count.priceSnapshots) {
        console.log(`     ⚠️ dubbletten har MER historik än målet (${dup._count.priceSnapshots} > ${target._count.priceSnapshots}) — historiken raderas med dubbletten`);
      }
      if (!APPLY) continue;

      const dupImage = dup.imageUrl;
      if (dupCm.length) {
        await prisma.offer.deleteMany({ where: { id: { in: dupCm.map((o) => o.id) } } });
      }
      await mergeStubInto(dup.id, target.id, () => {});
      if (g.takeImage && dupImage) {
        await prisma.product.update({ where: { id: target.id }, data: { imageUrl: dupImage } });
        console.log("     🖼 målets bild ersatt med dubblettens");
      }
      merged++;
      console.log("     ✓ hopslagen");
    }
  }

  console.log("\n════════ DELETES ════════");
  for (const d of DELETES) {
    const prod = await bySlug(d.slug);
    if (!prod) {
      console.log(`\n  · redan borta: ${d.slug}`);
      continue;
    }
    console.log(`\n  [${prod.category}] ${prod.title}\n     skäl: ${d.why}`);
    console.log(`     offers: ${prod.offers.length}, bevakningar: ${prod._count.watchlistItems}, samlingar: ${prod._count.collectionItems}, snapshots: ${prod._count.priceSnapshots}`);
    for (const o of prod.offers) {
      console.log(`       ${o.retailer.name}: ${o.url}`);
      if (o.url && o.retailer.name !== "Cardmarket") denylistUrls.push(o.url);
    }
    if (prod._count.collectionItems > 0) {
      console.log("     ⚠️ NÅGON ÄGER DEN I SIN SAMLING — hoppas över, be ägaren avgöra.");
      problems++;
      continue;
    }
    if (!APPLY) continue;
    await prisma.traderaMatch.deleteMany({ where: { productId: prod.id } });
    await prisma.dedupeVerdict.deleteMany({ where: { OR: [{ productAId: prod.id }, { productBId: prod.id }] } });
    await prisma.product.delete({ where: { id: prod.id } }); // offers/snapshots/observations/restock kaskadar
    deleted++;
    console.log("     ✓ raderad");
  }

  console.log("\n════════ SAMMANFATTNING ════════");
  console.log(`${APPLY ? "Utfört" : "Skulle utföras"}: ${merged} mergade dubbletter, ${deleted} raderade produkter, ${problems} problem.`);
  if (denylistUrls.length) {
    console.log("\n── Lägg till i import-denylist.ts (annars återskapas de raderade) ──");
    for (const u of denylistUrls) console.log(`    "${u}",`);
  }
  if (releasedUrls.length) {
    console.log("\n── SLÄPPTA URL:er (målet hade redan butiken — kan återuppstå som stub, denylista vid behov) ──");
    for (const u of releasedUrls) console.log(`    "${u}",`);
  }
  if (APPLY && (merged > 0 || deleted > 0)) {
    await recomputeProductPriceCache();
    console.log("\nPrisscachen omräknad.");
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
