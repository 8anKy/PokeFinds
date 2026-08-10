/**
 * Verkställer ägarens kataloggenomgång 2026-08-10: dubbletter in i rätt produkt,
 * felaktiga poster bort, platshållarpriser (1 kr-presale) nollade, en falsk
 * Tradera-annons purgad och Astonishing Volt Tackle CM-länkad. Varje rad är ETT
 * ägarbeslut (chattgenomgång med skärmdumpar), aldrig en regel.
 *
 *   node scripts/with-prod-db.mjs npx tsx scripts/apply-owner-catalog-cleanup-2026-08-10.ts
 *   node scripts/with-prod-db.mjs npx tsx scripts/apply-owner-catalog-cleanup-2026-08-10.ts --apply
 *
 * Ägarens direktiv:
 *  - Dubbletternas CARDMARKET-länkar följer ALDRIG med (målen bär redan rätt CM-länk).
 *    Tre stubbar bär dessutom BEVISAT FEL CM-identitet (Cardmarkets KINESISKA
 *    "CSM1aC: Storming Emergence"/"Tidal Storm" — se tvillingvakten i
 *    cardmarket-refresh.ts) → offern raderas före mergen och skräp-seten städas.
 *  - Raderade produkter får aldrig komma tillbaka → URL:erna står i import-denylist.ts.
 *  - Moonlit-stubben pekar på BÅDA tinsen (ägaren: "to these two") → Beam-offern
 *    dupliceras till Clefable innan mergen flyttar originalet till Gengar.
 */
import { prisma } from "../src/lib/db";
import { mergeStubInto } from "../src/jobs/dedupe-stubs";
import { adoptCmName } from "../src/jobs/adopt-cm-name";
import { purgeMismatchedMarketplaceOffer } from "../src/services/marketplace-offers";
import { recomputeProductPriceCache } from "../src/services/products";
import { cardmarketJapaneseProductUrl } from "../src/lib/marketplace-urls";
import { isDeniedListingUrl } from "../src/scrapers/import-denylist";

const APPLY = process.argv.includes("--apply");

interface MergeGroup {
  dups: string[];
  target: string;
  /** Målets offer från denna butik raderas FÖRE mergen så stubbens flyttar in i
   *  stället (stubbens listning är den rätta — t.ex. Pokemurres FÖRSEGLADE box). */
  replaceTargetRetailer?: string;
  note?: string;
}

const MERGES: MergeGroup[] = [
  { dups: ["the-glory-of-team-rocket-booster-box-japansk"], target: "pokemon-scarlet-violet-glory-of-team-rocket-sv10-booster-box-japanese" },
  { dups: ["pokemon-mega-dream-ex-booster-box-japansk-m1ii"], target: "pokemon-mega-dream-ex-booster-box-japansk" },
  { dups: ["pokemon-mega-perfect-order-booster-pack-engelsk"], target: "pokemon-tcg-perfect-order-booster-pack" },
  { dups: ["pokemon-sword-shield-pokemon-go-booster-pack"], target: "pokemon-go-pgo-booster-pack" },
  { dups: ["pokemon-mega-evolution-base-booster-pack"], target: "pokemon-tcg-mega-evolution-booster-max-6-per-kund" },
  { dups: ["pokemon-mega-evolutions-mega-symphonia-booster-pack"], target: "pokemon-tcg-mega-symphonia-booster-pack-japansk-m1s" },
  { dups: ["pokemon-slashing-legends-ex-tin-zacian-koraidon"], target: "slashing-legends-tins-zacian-ex-tin", note: "ägaren pekade ut Zacian-tinen" },
  { dups: ["pokemon-sv10-destined-rivals-team-rocket-collectors-ex-tin"], target: "team-rocket-tins-team-rocket-s-mewtwo-ex-tin" },
  {
    dups: ["forbokning-pokemon-mega-storm-emeralda-m6-booster-box-sealed-japansk"],
    target: "pokemon-mega-storm-emeralda-booster-box-japansk",
    replaceTargetRetailer: "Pokemurre",
    note: "stubbens Pokemurre-URL är den FÖRSEGLADE listningen; målets 'ej sealed' ersätts (och är denylistad)",
  },
  { dups: ["pokemon-storm-emeralda-booster-pack-japanese"], target: "pokemon-mega-storm-emeralda-booster-pack-japansk", note: "bar Cardmarkets KINESISKA 'Tidal Storm'-identitet" },
  {
    // Hittad under genomgången: SAMMA fel som packen, fast för boxen (The Swedish
    // Fish-listningen mappad till kinesiska "Tidal Storm Booster Box", 552239).
    dups: ["pokemon-storm-emeralda-booster-box-japanese"],
    target: "pokemon-mega-storm-emeralda-booster-box-japansk",
    note: "bar Cardmarkets KINESISKA 'Tidal Storm Booster Box'-identitet",
  },
  { dups: ["paradise-dragona-booster-box-japansk"], target: "pokemon-scarlet-violet-paradise-dragona-sv7a-display-booster-box-japansk" },
  { dups: ["pokemon-future-flash-booster-box-japanese"], target: "pokemon-scarlet-violet-future-flash-sv4m-display-booster-box-japansk" },
  { dups: ["pokemon-moonlit-ex-tin"], target: "mega-moonlit-tins-mega-gengar-ex-tin", note: "Beam-offern dupliceras till Clefable-tinen först (ägaren: båda)" },
  { dups: ["mega-charizard-spring-tin-2026-mega-charizard-y"], target: "mega-charizard-y-ex-tin" },
  { dups: ["mega-charizard-spring-tin-2026-mega-charizard-x"], target: "mega-charizard-x-ex-tin" },
  {
    // Ägaren: hör inte hemma i Booster Box-filtret — Hobbykort-sidan ÄR packen
    // (…/pokemon-abyss-eye-booster-pack-m5-japanese, 55 kr) med fel rubrik.
    dups: ["pokemon-m5-abyss-eye-booster-box-jp"],
    target: "pokemon-mega-abyss-eye-booster-pack-japansk",
  },
];

const DELETES: { slug: string; why: string }[] = [
  { slug: "pokemon-evolving-skies-astral-radiance-blister-eevee", why: "ägaren: radera, aldrig tillbaka (denylistad)" },
  { slug: "pokemon-battle-academy-pikachu-vs-eevee-vs-cinderace-iphuc", why: "ägaren: tillbehör/brädspel — bort (denylistad)" },
];

/** Skräp-set skapade av de kinesiska felmappningarna — raderas när de blivit tomma. */
const JUNK_SETS = ["CSM1aC: Storming Emergence - Radiant", "Tidal Storm"];

const productPick = {
  id: true,
  title: true,
  slug: true,
  setId: true,
  imageUrl: true,
  category: true,
  offers: {
    select: {
      id: true, url: true, price: true, stockStatus: true, condition: true, language: true,
      retailerId: true, retailer: { select: { name: true } },
    },
  },
  _count: { select: { watchlistItems: true, collectionItems: true, priceSnapshots: true } },
} as const;

async function bySlug(slug: string) {
  return prisma.product.findUnique({ where: { slug }, select: productPick });
}

async function main() {
  console.log(APPLY ? "APPLY — skriver.\n" : "DRY-RUN — inget skrivs. Kör med --apply.\n");
  let problems = 0;

  // ── 0. Falsk Tradera-annons på Mega Charizard X ex Tin (FÖRE mergen av spring-tin-stubben) ──
  // Item 738310978 ("tom ask") dömdes ok=false 07-07 men skrevs tillbaka varje natt av
  // scrape-alls Tradera-adapter (fixad 2026-08-10). Riolu-receptet tar bort den och
  // lyfter nästa vettiga annons. Item 743758170 ("Mega Charizard UPC") är en ANNAN
  // produkttyp (samma dom som 732719430 sedan tidigare) → fäll + städa observationerna.
  console.log("════════ TRADERA: Mega Charizard X ex Tin ════════");
  const czX = await bySlug("mega-charizard-x-ex-tin");
  if (czX) {
    const badOffer = czX.offers.find((o) => o.retailer.name === "Tradera" && o.url.includes("/738310978/"));
    console.log(`  offer 738310978: ${badOffer ? `${(badOffer.price ?? 0) / 100} kr — purgas (Riolu-receptet)` : "redan borta"}`);
    const upcObs = await prisma.priceObservation.findMany({
      where: { productId: czX.id, source: { name: "Tradera" }, price: { in: [10000, 250000, 255000] } },
      select: { id: true, price: true, observedAt: true },
    });
    console.log(`  förgiftade observationer (100 kr tom ask + 2500/2550 kr UPC): ${upcObs.length}`);
    if (APPLY) {
      if (badOffer) {
        await purgeMismatchedMarketplaceOffer(
          {
            id: badOffer.id, productId: czX.id, price: badOffer.price, url: badOffer.url,
            retailerId: badOffer.retailerId, retailerName: "Tradera", productCategory: czX.category,
          },
          "Tom ask — annonsen säljer tinaskalet utan innehåll (ägarbeslut 2026-08-10)"
        );
      }
      await prisma.traderaMatch.upsert({
        where: { itemId_productId: { itemId: "743758170", productId: czX.id } },
        update: { ok: false, reason: "Mega Charizard UPC (Ultra-Premium Collection) är en annan produkttyp än tinen" },
        create: { itemId: "743758170", productId: czX.id, ok: false, reason: "Mega Charizard UPC (Ultra-Premium Collection) är en annan produkttyp än tinen" },
      });
      if (upcObs.length) await prisma.priceObservation.deleteMany({ where: { id: { in: upcObs.map((o) => o.id) } } });
      console.log("  ✓ purgad + UPC-dom skriven + observationer städade");
    }
  }

  // ── 0b. Kanto Vaults "MEGA Starter Set Mega Gengar ex" felländ till Moonlit-tinen ──
  // Ground truth (butikens egen Shopify-JSON 2026-08-10): sidan säljer ett STARTER SET,
  // inte tinen. Offern bort + Kanto Vault-observationerna på tinen (enda KV-URL:en var
  // den felaktiga). Ingen denylist: sim mot tinen är 0,60 (< 0,85) → nästa import går
  // via domaren, som skiljer produkttyper — sidan får bli sin EGEN produkt.
  console.log("\n════════ KANTO VAULT: starter set ≠ Moonlit-tin ════════");
  const gengar = await bySlug("mega-moonlit-tins-mega-gengar-ex-tin");
  if (gengar) {
    const kvOffer = gengar.offers.find((o) => o.retailer.name === "Kanto Vault");
    const kvObs = await prisma.priceObservation.count({ where: { productId: gengar.id, source: { name: "Kanto Vault" } } });
    console.log(`  KV-offer: ${kvOffer ? kvOffer.url : "borta"} · KV-observationer: ${kvObs}`);
    if (APPLY && kvOffer) {
      await prisma.offer.delete({ where: { id: kvOffer.id } });
      await prisma.priceObservation.deleteMany({ where: { productId: gengar.id, source: { name: "Kanto Vault" } } });
      console.log("  ✓ borttagen");
    }
  }

  // ── 0c. Moonlit-stubbens Beam-offer dupliceras till Clefable (före mergen) ──
  const moonlitStub = await bySlug("pokemon-moonlit-ex-tin");
  const clefable = await bySlug("mega-moonlit-tins-mega-clefable-ex-tin");
  if (moonlitStub && clefable) {
    const beam = moonlitStub.offers.find((o) => o.retailer.name === "Beam Cardshop");
    const already = clefable.offers.some((o) => o.retailer.name === "Beam Cardshop");
    console.log(`\n  Moonlit → Clefable: Beam-offer ${beam ? beam.url : "saknas"}${already ? " (finns redan)" : ""}`);
    if (APPLY && beam && !already) {
      await prisma.offer.create({
        data: {
          productId: clefable.id, retailerId: beam.retailerId, url: beam.url, price: beam.price,
          currency: "SEK", stockStatus: beam.stockStatus, condition: beam.condition, language: beam.language,
        },
      });
      console.log("  ✓ Beam-offer skapad på Clefable");
    }
  }

  // ── 1. MERGES ──
  console.log("\n════════ MERGES ════════");
  const releasedUrls: string[] = [];
  let merged = 0;
  for (const g of MERGES) {
    const target = await bySlug(g.target);
    if (!target) {
      console.log(`\n⛔ MÅL SAKNAS: ${g.target} — hoppas över`);
      problems++;
      continue;
    }
    for (const dupSlug of g.dups) {
      const dup = await bySlug(dupSlug);
      if (!dup) {
        console.log(`\n  · redan borta: ${dupSlug}`);
        continue;
      }
      const dupCm = dup.offers.filter((o) => o.retailer.name === "Cardmarket");
      const replaced = g.replaceTargetRetailer
        ? target.offers.filter((o) => o.retailer.name === g.replaceTargetRetailer)
        : [];
      const targetKeys = new Set(
        target.offers
          .filter((o) => !replaced.some((r) => r.id === o.id))
          .map((o) => `${o.retailerId}|${o.condition}|${o.language}`)
      );
      console.log(`\n  "${dup.title}"  [${dup.category}, ${dup._count.priceSnapshots} snapshots]`);
      console.log(`   → "${target.title}"  [${target.category}, ${target._count.priceSnapshots} snapshots, ${target.offers.length} offers]`);
      if (g.note) console.log(`     not: ${g.note}`);
      if (dupCm.length) console.log(`     CM-offer på dubbletten RADERAS (flyttas aldrig): ${dupCm.map((o) => o.url).join(" · ")}`);
      for (const o of replaced) console.log(`     ✂ målets ${g.replaceTargetRetailer}-offer ersätts: ${o.url}${isDeniedListingUrl(o.url) ? " (denylistad ✓)" : " ⚠️ EJ denylistad"}`);
      for (const o of dup.offers.filter((x) => x.retailer.name !== "Cardmarket")) {
        const dropped = targetKeys.has(`${o.retailerId}|${o.condition}|${o.language}`);
        console.log(`     ${dropped ? "✂ SLÄPPS (målet har butiken)" : "→ flyttas"}: ${o.retailer.name}: ${o.url}`);
        if (dropped && o.url && !o.url.includes("tradera.com")) releasedUrls.push(o.url);
      }
      if (dup._count.watchlistItems || dup._count.collectionItems) {
        console.log(`     flyttar ${dup._count.watchlistItems} bevakningar, ${dup._count.collectionItems} samlingsposter`);
      }
      if (dup._count.priceSnapshots > target._count.priceSnapshots) {
        console.log(`     ⚠️ dubbletten har MER historik än målet — fel riktning? HOPPAS ÖVER`);
        problems++;
        continue;
      }
      if (!APPLY) continue;
      if (dupCm.length) await prisma.offer.deleteMany({ where: { id: { in: dupCm.map((o) => o.id) } } });
      if (replaced.length) await prisma.offer.deleteMany({ where: { id: { in: replaced.map((o) => o.id) } } });
      await mergeStubInto(dup.id, target.id, () => {});
      merged++;
      console.log("     ✓ hopslagen");
    }
  }

  // ── 2. DELETES ──
  console.log("\n════════ DELETES ════════");
  let deleted = 0;
  for (const d of DELETES) {
    const prod = await bySlug(d.slug);
    if (!prod) {
      console.log(`\n  · redan borta: ${d.slug}`);
      continue;
    }
    console.log(`\n  [${prod.category}] ${prod.title}\n     skäl: ${d.why}`);
    for (const o of prod.offers) {
      const denied = o.retailer.name === "Cardmarket" || o.url.includes("tradera.com") || isDeniedListingUrl(o.url);
      console.log(`       ${o.retailer.name}: ${o.url}${denied ? "" : " ⚠️ EJ denylistad butiks-URL"}`);
    }
    if (prod._count.collectionItems > 0) {
      console.log("     ⚠️ ligger i någons samling — hoppas över, fråga ägaren.");
      problems++;
      continue;
    }
    if (!APPLY) continue;
    await prisma.traderaMatch.deleteMany({ where: { productId: prod.id } });
    await prisma.dedupeVerdict.deleteMany({ where: { OR: [{ productAId: prod.id }, { productBId: prod.id }] } });
    await prisma.product.delete({ where: { id: prod.id } });
    deleted++;
    console.log("     ✓ raderad");
  }

  // ── 3. Skräp-set från de kinesiska felmappningarna ──
  console.log("\n════════ SKRÄP-SET ════════");
  for (const name of JUNK_SETS) {
    const s = await prisma.cardSet.findFirst({
      where: { name },
      select: { id: true, _count: { select: { products: true, cards: true, watchers: true } } },
    });
    if (!s) {
      console.log(`  · finns inte: "${name}"`);
      continue;
    }
    const empty = s._count.products === 0 && s._count.cards === 0 && s._count.watchers === 0;
    console.log(`  "${name}": ${s._count.products} produkter, ${s._count.cards} kort, ${s._count.watchers} bevakare → ${empty ? "raderas" : "INTE tomt — lämnas"}`);
    if (APPLY && empty) {
      await prisma.cardSet.delete({ where: { id: s.id } });
      console.log("  ✓ raderat");
    }
  }

  // ── 4. Platshållarpriser (Kanto Vault 1 kr, Pokétalk 10 kr) ──
  console.log("\n════════ PLATSHÅLLARPRISER ════════");
  // 4a. Fel produkt OCH platshållare: KV "card-set"-sidan på engelska 30th Celebration Booster → bort.
  const en30 = await bySlug("30th-celebration-booster");
  const cardSetOffer = en30?.offers.find((o) => o.url.includes("pokemon-30th-celebration-card-set"));
  console.log(`  KV card-set-offer på "${en30?.title}": ${cardSetOffer ? "raderas (fel produkt + denylistad)" : "borta"}`);
  if (APPLY && cardSetOffer) await prisma.offer.delete({ where: { id: cardSetOffer.id } });
  // 4b. Rätt produkt, platshållarpris → priset nollas (länk + lagerstatus behålls).
  const nullPrice: { slug: string; urlPart: string }[] = [
    { slug: "pokemon-30th-celebration-booster-pack-japansk", urlPart: "kantovault.se" },
    { slug: "forbokning-pokemon-30th-anniversary-celebration-m6-mega-booster-box-japansk", urlPart: "kantovault.se" },
    { slug: "pokemon-scarlet-violet-paradise-dragona-sv7a-display-booster-box-japansk", urlPart: "poketalk.se" },
  ];
  for (const n of nullPrice) {
    const p = await bySlug(n.slug);
    const o = p?.offers.find((x) => x.url.includes(n.urlPart) && x.price != null && x.price <= 1000);
    console.log(`  ${n.slug}: ${o ? `${o.retailer.name} ${(o.price ?? 0) / 100} kr → pris null` : "inget platshållarpris kvar"}`);
    if (APPLY && o) await prisma.offer.update({ where: { id: o.id }, data: { price: null } });
  }
  // 4c. Förgiftade observationer + snapshotrad (mätt: 6 obs à 1 kr, en snapshot 2026-08-08).
  const badObs = await prisma.priceObservation.findMany({
    where: {
      price: { lt: 500 },
      product: { category: { notIn: ["SINGLE_CARD", "GRADED_CARD"] } },
      source: { name: { notIn: ["Cardmarket", "Tradera", "Tradera sålt", "Pokémon TCG API", "TCGdex API"] } },
    },
    select: { id: true, price: true, product: { select: { slug: true } }, source: { select: { name: true } } },
  });
  console.log(`  observationer < 5 kr från butikskällor: ${badObs.length}`);
  for (const o of badObs) console.log(`    · ${o.price} öre [${o.source?.name}] ${o.product.slug}`);
  if (APPLY && badObs.length) await prisma.priceObservation.deleteMany({ where: { id: { in: badObs.map((o) => o.id) } } });
  const jp30 = await bySlug("pokemon-30th-celebration-booster-pack-japansk");
  if (jp30) {
    const snaps = await prisma.priceSnapshot.findMany({ where: { productId: jp30.id, minPrice: { lt: 500 } }, select: { id: true, date: true } });
    console.log(`  1 kr-snapshots på 30th JP Booster: ${snaps.length}`);
    if (APPLY && snaps.length) await prisma.priceSnapshot.deleteMany({ where: { id: { in: snaps.map((s) => s.id) } } });
  }

  // ── 5. Kategorifix: Poké Ball Tin Display är en tin-display, ingen boosterlåda ──
  console.log("\n════════ KATEGORI ════════");
  const pokeball = await bySlug("pokemon-go-poke-ball-tin-display");
  console.log(`  ${pokeball ? `"${pokeball.title}": ${pokeball.category} → TIN` : "pokeball-display saknas"}`);
  if (APPLY && pokeball && pokeball.category !== "TIN") {
    await prisma.product.update({ where: { id: pokeball.id }, data: { category: "TIN" } });
  }

  // ── 6. Astonishing Volt Tackle → Cardmarkets "Shocking Volt Tackle Booster Box" ──
  // idProduct 494479 (verifierat i CM:s katalog 2026-08-10, oägt). Länk-offer utan pris;
  // dagliga JP-refreshen prissätter (guide-low), sätter set-etikett (exp 3479) och graf.
  console.log("\n════════ VOLT TACKLE ════════");
  const volt = await bySlug("astonishing-volt-tackle-booster-box-japansk");
  if (volt) {
    const hasCm = volt.offers.some((o) => o.retailer.name === "Cardmarket");
    console.log(`  "${volt.title}": CM-offer ${hasCm ? "finns redan" : "skapas (idProduct 494479) + namnet adopteras"}`);
    if (APPLY && !hasCm) {
      const cm = await prisma.retailer.findFirstOrThrow({ where: { name: "Cardmarket" } });
      await prisma.offer.create({
        data: {
          productId: volt.id, retailerId: cm.id, condition: "SEALED", language: "JP",
          price: null, currency: "SEK", stockStatus: "UNKNOWN", url: cardmarketJapaneseProductUrl(494479),
        },
      });
      await adoptCmName(volt.id, "Shocking Volt Tackle Booster Box");
      console.log("  ✓ CM-länkad + omdöpt");
    }
  }

  // ── 7. Saknade bilder (exakt idProduct — aldrig fuzzy) ──
  console.log("\n════════ BILDER ════════");
  for (const b of [
    { slug: "chaos-rising-booster-bundle", img: "/api/cm-image/877284" },
    { slug: "zarude-2-pack-blister-version-2", img: "/api/cm-image/899366" },
  ]) {
    const p = await bySlug(b.slug);
    console.log(`  ${b.slug}: ${p ? (p.imageUrl ? "har redan bild" : `→ ${b.img}`) : "saknas"}`);
    if (APPLY && p && !p.imageUrl) await prisma.product.update({ where: { id: p.id }, data: { imageUrl: b.img } });
  }

  // ── 8. Priscache ──
  if (APPLY) {
    await recomputeProductPriceCache();
    console.log("\n✓ recomputeProductPriceCache körd");
  }

  console.log("\n════════ SAMMANFATTNING ════════");
  console.log(`${APPLY ? "Utfört" : "Skulle utföras"}: ${merged} merges, ${deleted} raderingar, ${problems} problem.`);
  if (releasedUrls.length) {
    console.log("\n── Släppta butiks-URL:er (bevaka — denylista om de återuppstår som stubbar) ──");
    for (const u of releasedUrls) console.log(`    "${u}",${isDeniedListingUrl(u) ? "  // denylistad ✓" : ""}`);
  }
}

main().finally(() => prisma.$disconnect());
