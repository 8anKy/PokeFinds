/**
 * POKÉMON CENTER-EXKLUSIVA ETB:er hade butikslänkar till den ORDINARIE asken.
 *
 *   node scripts/with-prod-db.mjs npx tsx scripts/fix-pokemon-center-links.ts           # torrkörning
 *   node scripts/with-prod-db.mjs npx tsx scripts/fix-pokemon-center-links.ts --apply
 *
 * PROBLEMET (ägargranskat 2026-08-08): butikerna säljer den vanliga Elite Trainer Boxen,
 * men annonserna satt på vår Pokémon Center-produkt. Priset avslöjade det — 699 kr mot
 * Cardmarkets 3 931 kr för PC-versionen — och `pokemonCenterMismatch` bekräftade att
 * titlarna är olika varor.
 *
 * ⛔ LÄNKEN FLYTTAS, DEN RADERAS INTE. Butiken säljer en verklig vara som hör hemma i
 *    katalogen; att bara ta bort länken hade gjort den ordinarie asken osynlig hos oss
 *    trots att sex butiker säljer den.
 *
 * ⛔ DEN ORDINARIE PRODUKTEN SAKNADES FÖR FEM AV SEX. Cardmarket har BÅDA versionerna
 *    som egna produkter (t.ex. 692101 ordinarie mot 692103 Pokémon Center), så den
 *    ordinarie skapas här ur CM:s egen katalog med rätt idProduct — inte som en stub ur
 *    en butikstitel. Då får den CM-länk, CM-bild och en trendkurva från dag ett, och
 *    dagliga `runCardmarketRefresh` prissätter den som alla andra sealed-produkter.
 *
 * ⛔ Priset sätts ur CM:s GRATIS prisguide (price_guide_6.json), inte ur RapidAPI —
 *    ingen kvot förbrukas. Sealed prissätts på `low`, samma fält som resten av flödet.
 */
import "./load-env";
import { prisma } from "../src/lib/db";
import { mergeStubInto } from "../src/jobs/dedupe-stubs";
import { recomputeProductPriceCache } from "../src/services/products";
import { getRatesOre } from "../src/lib/exchange-rate";
import { cardmarketProductUrl } from "../src/lib/marketplace-urls";
import { slugify } from "../src/lib/utils";

const APPLY = process.argv.includes("--apply");
const GUIDE_URL = "https://downloads.s3.cardmarket.com/productCatalog/priceGuide/price_guide_6.json";

/**
 * En rad = en Pokémon Center-produkt och dess ordinarie motsvarighet.
 * `wrongLinkUrls` är de butikslänkar som ska FLYTTAS från PC-produkten till den ordinarie
 * — var och en verifierad mot butikens egen sida (audit-store-links.ts).
 */
const PAIRS: {
  pcSlug: string;
  normalTitle: string;
  normalCmId: number;
  /** Finns den ordinarie redan? Annars skapas den ur CM. */
  normalSlugIfExists?: string;
  wrongLinkUrls: string[];
}[] = [
  {
    pcSlug: "scarlet-violet-koraidon-pokemon-center-elite-trainer-box",
    normalTitle: "Scarlet & Violet Koraidon Elite Trainer Box",
    normalCmId: 692101,
    normalSlugIfExists: "pokemon-scarlet-violet-base-koraidon-elite-trainer-box",
    wrongLinkUrls: [
      "shinycards.se/pokemon/scarlet-violet/97-scarlet-violet-base-set/pokemon-scarlet-violet-elite-trainer-box-koraidon",
      "tcgstore.se/products/pokemon-scarlet-violet-1-koraidon-eli",
      "rahtech.se/products/pokemon-scarlet-violet-elite-trainer-b",
    ],
  },
  {
    pcSlug: "paradox-rift-roaring-moon-pokemon-center-elite-trainer-box",
    normalTitle: "Paradox Rift Roaring Moon Elite Trainer Box",
    normalCmId: 728727,
    wrongLinkUrls: [
      "tcgstore.se/products/pokemon-scarlet-violet-4-paradox-rift",
      "beamcardshop.com/products/paradox-rift-elite-trainer-box-r",
    ],
  },
  {
    pcSlug: "temporal-forces-iron-leaves-pokemon-center-elite-trainer-box",
    normalTitle: "Temporal Forces Iron Leaves Elite Trainer Box",
    normalCmId: 750410,
    wrongLinkUrls: ["tcgstore.se/products/pokemon-scarlet-violet-5-temporal-for"],
  },
  {
    pcSlug: "chilling-reign-pokemon-center-ice-rider-calyrex-elite-trainer-box",
    normalTitle: "Chilling Reign Ice Rider Calyrex Elite Trainer Box",
    normalCmId: 557971,
    wrongLinkUrls: ["beamcardshop.com/products/chilling-reign-elite-trainer-box"],
  },
  {
    pcSlug: "mega-evolution-mega-lucario-pokemon-center-elite-trainer-box",
    normalTitle: "Mega Evolution: Mega Lucario Elite Trainer Box",
    normalCmId: 834830,
    wrongLinkUrls: [
      "beamcardshop.com/products/pokemon-mega-evolution-elite-tra",
      "tcgstore.se/products/pokemon-tcg-mega-evolution-elite-trai",
    ],
  },
  {
    pcSlug: "celebrations-pokemon-center-elite-trainer-box",
    normalTitle: "Celebrations Elite Trainer Box",
    normalCmId: 570895,
    wrongLinkUrls: ["beamcardshop.com/products/celebrations-elite-trainer"],
  },
];

/** Dubblettstubbar som ska slås ihop med rätt produkt (ägargranskade). */
const MERGE: { stubSlug: string; canonicalSlug: string; proof: string }[] = [
  {
    stubSlug: "mega-evolution-etb-pokemon-center-lucario",
    canonicalSlug: "mega-evolution-mega-lucario-pokemon-center-elite-trainer-box",
    proof: "CardGames egen titel säger POKEMON CENTER; 2 899 kr matchar PC-versionen, inte den ordinarie",
  },
];

/** Butikslänkar som bara ska BORT (ingen produkt de hör hemma på). */
const DELETE_LINKS: { urlContains: string; productSlug: string; why: string }[] = [
  { urlContains: "webhallen.com/se/product/396737", productSlug: "goodra-mini-album-2-pack-blister", why: "ägarbeslut: Webhallen-länken är fel produkt" },
  { urlContains: "maxgaming.se/sv/pokemon/pokemon-mini-album-med-booster", productSlug: "goodra-mini-album-2-pack-blister", why: "ägarbeslut: MaxGaming-länken är fel produkt" },
  { urlContains: "spelgalaxen.se/products/pokemon-plush-figure-gengar", productSlug: "mega-lucario-ex-figure-collection", why: "sidan säljer ett GOSEDJUR (Gengar 30 cm)" },
];

async function guidePrices(): Promise<Map<number, { low: number | null; trend: number | null }>> {
  const r = await fetch(GUIDE_URL);
  const j = (await r.json()) as { priceGuides: { idProduct: number; low: number | null; trend: number | null }[] };
  return new Map(j.priceGuides.map((e) => [e.idProduct, { low: e.low, trend: e.trend }]));
}

async function main() {
  console.log(APPLY ? "APPLY — skriver.\n" : "TORRKÖRNING — inget skrivs. Kör med --apply.\n");
  const guide = await guidePrices();
  const rates = await getRatesOre();
  let moved = 0, created = 0, mergedN = 0, deleted = 0;

  for (const p of PAIRS) {
    const pc = await prisma.product.findUnique({
      where: { slug: p.pcSlug },
      select: { id: true, title: true, setId: true, language: true, offers: { select: { id: true, url: true, price: true, retailer: { select: { name: true } } } } },
    });
    if (!pc) { console.log(`SAKNAS: ${p.pcSlug}`); continue; }

    // 1) Den ordinarie produkten — hitta eller skapa ur Cardmarket.
    let normal = p.normalSlugIfExists
      ? await prisma.product.findUnique({ where: { slug: p.normalSlugIfExists }, select: { id: true, title: true, offers: { select: { url: true } } } })
      : await prisma.product.findFirst({ where: { title: p.normalTitle }, select: { id: true, title: true, offers: { select: { url: true } } } });

    const cmUrl = cardmarketProductUrl(p.normalCmId);
    const g = guide.get(p.normalCmId);
    // Sealed prissätts på `low` (CM:s lägsta), samma fält som resten av sealed-flödet.
    const priceOre = g?.low != null && g.low > 0 ? Math.round(g.low * rates.eurToOre) : null;

    if (!normal) {
      console.log(`${APPLY ? "SKAPAR" : "skulle skapa"} ordinarie produkt: "${p.normalTitle}" (CM ${p.normalCmId}, ${priceOre ? (priceOre / 100).toFixed(0) + " kr" : "pris saknas"})`);
      if (APPLY) {
        const slug = slugify(p.normalTitle);
        const createdP = await prisma.product.create({
          data: {
            title: p.normalTitle,
            normalizedTitle: p.normalTitle.toLowerCase().replace(/[^a-z0-9\s/-]/g, " ").replace(/\s+/g, " ").trim(),
            slug,
            category: "ETB",
            // Samma set som PC-versionen — det ÄR samma set, bara en annan utgåva.
            setId: pc.setId,
            language: pc.language,
            imageUrl: `/api/cm-image/${p.normalCmId}`,
          },
          select: { id: true, title: true, offers: { select: { url: true } } },
        });
        normal = createdP;
        created++;
      }
    } else {
      console.log(`ordinarie finns: "${normal.title}"`);
      // Den befintliga ordinarie posten är en auto-importerad stub ur en butikstitel:
      // inget set, ingen CM-koppling. Setet är detsamma som PC-versionens — utan det
      // syns produkten varken i setfiltret eller på setsidan.
      const cur = await prisma.product.findUnique({ where: { id: normal.id }, select: { setId: true, imageUrl: true } });
      if (!cur?.setId && pc.setId) {
        console.log(`   ${APPLY ? "SÄTTER" : "skulle sätta"} setId (samma set som PC-versionen)`);
        if (APPLY) await prisma.product.update({ where: { id: normal.id }, data: { setId: pc.setId } });
      }
    }
    if (!normal) continue;

    // 2) Cardmarket-länk på den ordinarie (så prishistoriken börjar byggas).
    const hasCm = normal.offers.some((o) => o.url.includes(`idProduct=${p.normalCmId}`));
    if (!hasCm) {
      console.log(`   ${APPLY ? "LÄGGER TILL" : "skulle lägga till"} Cardmarket-länk ${p.normalCmId}${priceOre ? ` (${(priceOre / 100).toFixed(0)} kr)` : ""}`);
      if (APPLY) {
        const retailer = await prisma.retailer.findFirst({ where: { name: "Cardmarket" }, select: { id: true } });
        if (retailer) {
          await prisma.offer.create({
            data: {
              productId: normal.id, retailerId: retailer.id, condition: "SEALED", language: "EN",
              price: priceOre, currency: "SEK", stockStatus: "IN_STOCK", url: cmUrl,
            },
          });
        }
      }
    }

    // 3) Flytta de felaktiga butikslänkarna.
    for (const frag of p.wrongLinkUrls) {
      const offer = pc.offers.find((o) => o.url.includes(frag));
      if (!offer) { console.log(`   hoppar (ingen träff): ${frag}`); continue; }
      console.log(`   ${APPLY ? "FLYTTAR" : "skulle flytta"} ${offer.retailer.name} (${offer.price ? (offer.price / 100).toFixed(0) + " kr" : "-"}) → "${p.normalTitle}"`);
      if (APPLY) {
        // Har den ordinarie redan en offer från samma butik? Då är flytten en radering.
        const clash = await prisma.offer.findFirst({
          where: { productId: normal.id, retailerId: (await prisma.offer.findUnique({ where: { id: offer.id }, select: { retailerId: true } }))!.retailerId },
          select: { id: true },
        });
        if (clash) await prisma.offer.delete({ where: { id: offer.id } });
        else await prisma.offer.update({ where: { id: offer.id }, data: { productId: normal.id } });
        moved++;
      }
    }
  }

  console.log("\n── DUBBLETTSTUBBAR ───────────────────────────────────────────────────────");
  for (const m of MERGE) {
    const stub = await prisma.product.findUnique({ where: { slug: m.stubSlug }, select: { id: true, title: true } });
    const canon = await prisma.product.findUnique({ where: { slug: m.canonicalSlug }, select: { id: true, title: true } });
    if (!stub || !canon) { console.log(`  hoppar (saknas): ${m.stubSlug}`); continue; }
    console.log(`  ${APPLY ? "MERGAR" : "skulle merga"}: "${stub.title}" → "${canon.title}"\n     bevis: ${m.proof}`);
    if (APPLY) { await mergeStubInto(stub.id, canon.id, () => {}); mergedN++; }
  }

  console.log("\n── LÄNKAR SOM BARA SKA BORT ──────────────────────────────────────────────");
  for (const d of DELETE_LINKS) {
    const offers = await prisma.offer.findMany({
      where: { url: { contains: d.urlContains }, product: { slug: d.productSlug } },
      select: { id: true, retailer: { select: { name: true } }, product: { select: { title: true } } },
    });
    if (!offers.length) { console.log(`  hoppar (ingen träff): ${d.urlContains}`); continue; }
    for (const o of offers) {
      console.log(`  ${APPLY ? "TAR BORT" : "skulle ta bort"}: ${o.retailer.name} på "${o.product.title}" — ${d.why}`);
      if (APPLY) { await prisma.offer.delete({ where: { id: o.id } }); deleted++; }
    }
  }

  if (APPLY) {
    await recomputeProductPriceCache();
    console.log("\nPriscachen omräknad.");
  }
  console.log(`\n${created} skapade, ${moved} flyttade länkar, ${mergedN} sammanslagna, ${deleted} borttagna.`);
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(async () => { await prisma.$disconnect(); process.exit(process.exitCode ?? 0); });
