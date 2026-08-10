/**
 * Dubblettsvepning 2026-08-11 (ägarens uppdrag: "hitta resten av dubbletterna").
 *
 *   node scripts/with-prod-db.mjs npx tsx scripts/apply-owner-catalog-cleanup-2026-08-11.ts
 *   node scripts/with-prod-db.mjs npx tsx scripts/apply-owner-catalog-cleanup-2026-08-11.ts --apply
 *
 * DETEKTORERNA (tmp-dup-sweep, se commit-meddelandet): (A) två produkter med SAMMA
 * Cardmarket-idProduct = bevisade dubbletter; (D) sealed utan CM-identitet dömda av
 * LLM mot sin CM-länkade kandidat. Varje merge nedan bär sitt bevis i `why`.
 *
 * MÖNSTRET bakom A-familjen: Beam Cardshop/TCG Store-importen 07/08 aug skapade
 * variant-namngivna ETB-stubbar ("Paradox Rift ROARING MOON ETB") som CM-matchades
 * till SAMMA idProduct som våra etablerade "generiska" ETB:er — för Cardmarkets
 * produkt PÅ det id:t ÄR variantprodukten ("Paradox Rift Roaring Moon Elite Trainer
 * Box", 728727). Stubben är alltså en dubblett, och den etablerade produkten får
 * CM:s variantnamn efter mergen (adoptCmName; ägarens namnpolicy 2026-08-09).
 */
import { prisma } from "../src/lib/db";
import { mergeStubInto } from "../src/jobs/dedupe-stubs";
import { adoptCmName } from "../src/jobs/adopt-cm-name";
import { recomputeProductPriceCache } from "../src/services/products";
import { isDeniedListingUrl } from "../src/scrapers/import-denylist";

const APPLY = process.argv.includes("--apply");

interface MergeRow {
  dup: string;
  target: string;
  /** CM:s katalognamn — adopteras av MÅLET efter mergen (kollisionen försvinner med stubben). */
  adoptName?: string;
  why: string;
}

const MERGES: MergeRow[] = [
  {
    dup: "future-flash-booster-box-japansk",
    target: "pokemon-scarlet-violet-future-flash-sv4m-display-booster-box-japansk",
    why: "ägarens exempel: tredje Future Flash-box-stubben (Kanto Vault)",
  },
  {
    dup: "celebrations-elite-trainer-box",
    target: "celebrations-25th-anniversary-elite-trainer-box-tradera-sald-ja5vf",
    adoptName: "Celebrations Elite Trainer Box",
    why: "samma CM-idProduct 570895; CM har EN vanlig Celebrations ETB",
  },
  {
    dup: "mega-evolution-mega-lucario-elite-trainer-box",
    target: "pokemon-tcg-mega-evolution-elite-trainer-box",
    adoptName: "Mega Evolution: Mega Lucario Elite Trainer Box",
    why: "samma CM-idProduct 834830 = CM:s 'Mega Evolution: Mega Lucario Elite Trainer Box' (Gardevoir är 834831 och finns som egen produkt)",
  },
  {
    dup: "paradox-rift-roaring-moon-elite-trainer-box",
    target: "pokemon-tcg-paradox-rift-elite-trainer-box",
    adoptName: "Paradox Rift Roaring Moon Elite Trainer Box",
    why: "samma CM-idProduct 728727 = CM:s Roaring Moon-ETB (Iron Valiant är 728730)",
  },
  {
    dup: "temporal-forces-iron-leaves-elite-trainer-box",
    target: "pokemon-tcg-temporal-forces-elite-trainer-box",
    adoptName: "Temporal Forces Iron Leaves Elite Trainer Box",
    why: "samma CM-idProduct 750410 = CM:s Iron Leaves-ETB (Walking Wake är 750412)",
  },
  {
    dup: "chilling-reign-ice-rider-calyrex-elite-trainer-box",
    target: "chilling-reign-swsh6-elite-trainer-box",
    adoptName: "Chilling Reign Ice Rider Calyrex Elite Trainer Box",
    why: "samma CM-idProduct 557971 = CM:s Ice Rider-ETB (Shadow Rider 557972 finns som egen produkt)",
  },
  {
    dup: "pokemon-scarlet-violet-base-koraidon-elite-trainer-box",
    target: "scarlet-violet-sv1-elite-trainer-box",
    why: "samma CM-idProduct 692101; båda säger Koraidon — målet bär redan CM-namnet",
  },
  {
    dup: "pokemon-tcg-poke-ball-tin-2025",
    target: "generic-poke-ball-tin",
    why: "identisk titel ('Generic Poké Ball Tin') + samma CM-idProduct 362931 — två synliga tvillingar i katalogen",
  },
  {
    dup: "pokemon-sun-moon-ultra-prism-elite-trainer-box-dusk-mane-necrozma",
    target: "ultra-prism-sm5-elite-trainer-box",
    why: "LLM-dom SAMMA + identisk ordmängd; målet är CM:s 'Ultra Prism Elite Trainer Box (Dusk Mane Necrozma)'",
  },
  {
    dup: "pokemon-scarlet-violet-prismatic-evolutions-booster-bundle-utan-plast",
    target: "pokemon-tcg-prismatic-evolutions-booster-bundle-iphve",
    why: "LLM-dom SAMMA; 'UTAN PLAST' är Pokétalks egen anmärkning, inte en annan SKU",
  },
  {
    dup: "pokemon-sun-moon-base-set-booster-box",
    target: "", // slås upp på titel nedan — se main()
    why: "'Sun & Moon Base Set' ÄR SM1 = CM:s 'Sun & Moon Booster Box' (domaren avvisade korrekt WOTC Base Set; tvåan var rätt svar)",
  },
];

/** DL:s karaktärslösa Destined Rivals-blistersida — offer på TVÅ karaktärsblistrar. */
const DL_BLISTER_URL = "https://dragonslair.se/products/pokemon-tcg-scarlet-violet-10-destined-rivals-3-pack-blister-pokemon";

const pick = {
  id: true, title: true, slug: true, category: true, imageUrl: true,
  offers: { select: { id: true, url: true, condition: true, language: true, retailerId: true, retailer: { select: { name: true } } } },
  _count: { select: { watchlistItems: true, collectionItems: true, priceSnapshots: true } },
} as const;

async function main() {
  console.log(APPLY ? "APPLY — skriver.\n" : "DRY-RUN — inget skrivs. Kör med --apply.\n");
  let merged = 0, problems = 0;

  console.log("════════ MERGES ════════");
  for (const m of MERGES) {
    const dup = await prisma.product.findUnique({ where: { slug: m.dup }, select: pick });
    if (!dup) { console.log(`\n  · redan borta: ${m.dup}`); continue; }
    const target = m.target
      ? await prisma.product.findUnique({ where: { slug: m.target }, select: pick })
      : await prisma.product.findFirst({ where: { title: "Sun & Moon Booster Box", language: "EN", category: "BOOSTER_BOX" }, select: pick });
    if (!target) { console.log(`\n⛔ MÅL SAKNAS för ${m.dup}`); problems++; continue; }

    const dupCm = dup.offers.filter((o) => o.retailer.name === "Cardmarket");
    const targetKeys = new Set(target.offers.map((o) => `${o.retailerId}|${o.condition}|${o.language}`));
    console.log(`\n  "${dup.title}" (${dup.slug}) [${dup._count.priceSnapshots} snaps]`);
    console.log(`   → "${target.title}" (${target.slug}) [${target._count.priceSnapshots} snaps, ${target.offers.length} offers]`);
    console.log(`     bevis: ${m.why}`);
    if (dupCm.length) console.log(`     CM-offer på dubbletten raderas: ${dupCm.map((o) => o.url).join(" · ")}`);
    for (const o of dup.offers.filter((x) => x.retailer.name !== "Cardmarket")) {
      const dropped = targetKeys.has(`${o.retailerId}|${o.condition}|${o.language}`);
      console.log(`     ${dropped ? "✂ SLÄPPS (målet har butiken)" : "→ flyttas"}: ${o.retailer.name}: ${o.url.slice(0, 100)}`);
    }
    if (dup._count.priceSnapshots > target._count.priceSnapshots) {
      console.log("     ⚠️ dubbletten har MER historik än målet — fel riktning? HOPPAS ÖVER");
      problems++;
      continue;
    }
    if (!APPLY) continue;
    if (dupCm.length) await prisma.offer.deleteMany({ where: { id: { in: dupCm.map((o) => o.id) } } });
    await mergeStubInto(dup.id, target.id, () => {});
    if (m.adoptName) await adoptCmName(target.id, m.adoptName);
    merged++;
    console.log("     ✓ hopslagen" + (m.adoptName ? ` + namnet → "${m.adoptName}"` : ""));
  }

  console.log("\n════════ DL KARAKTÄRSLÖS BLISTER ════════");
  const dlOffers = await prisma.offer.findMany({
    where: { url: DL_BLISTER_URL },
    select: { id: true, price: true, product: { select: { id: true, slug: true, title: true } } },
  });
  console.log(`  ${dlOffers.length} offers på ${DL_BLISTER_URL}${isDeniedListingUrl(DL_BLISTER_URL) ? " (denylistad ✓)" : " ⚠️ EJ denylistad"}`);
  for (const o of dlOffers) {
    console.log(`   ✂ "${o.product.title}" (${o.product.slug})`);
    if (APPLY) {
      await prisma.offer.delete({ where: { id: o.id } });
      // DL-seriens observationer på blistern (exakt offerns pris) — bort ur grafen.
      if (o.price != null) {
        const src = await prisma.scrapeSource.findFirst({ where: { name: "Dragon's Lair" }, select: { id: true } });
        if (src) await prisma.priceObservation.deleteMany({ where: { productId: o.product.id, sourceId: src.id, price: o.price } });
      }
    }
  }

  if (APPLY) {
    await recomputeProductPriceCache();
    console.log("\n✓ recomputeProductPriceCache körd");
  }
  console.log(`\n${APPLY ? "Utfört" : "Skulle utföras"}: ${merged} merges, ${problems} problem.`);
}

main().finally(() => prisma.$disconnect());
