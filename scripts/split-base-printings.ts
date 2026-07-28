/**
 * Delar Base Set i TRE katalogposter per kort: Unlimited, Shadowless, 1st Edition.
 *
 *   node scripts/with-prod-db.mjs npx tsx scripts/split-base-printings.ts            # TORRKÖRNING
 *   node scripts/with-prod-db.mjs npx tsx scripts/split-base-printings.ts --apply
 *
 * VARFÖR: Base trycktes i tre omgångar och de är olika varor — samma Ponyta kostar
 * 26,50 €, 4,29 € eller några ören. Katalogen hade EN produkt per kort, som i
 * praktiken visade vilken tryckning som råkade ha ett pris i RapidAPI-feeden.
 *
 * HUR:
 *  - Den BEFINTLIGA produkten blir Unlimited. Den behåller id, slug, prishistorik,
 *    bevakningar och samlingsposter — den har alltid PÅSTÅTT sig vara det ordinarie
 *    kortet, så det är inte en omtolkning utan en precisering. Bara titeln får
 *    tryckningen tillagd.
 *  - Shadowless och 1st Edition skapas som nya produkter på SAMMA Card
 *    (produktsidan listar redan syskonvarianter, se services/products.ts).
 *  - Cardmarket-länk per tryckning: CM har TVÅ produkter per Base-kort — den
 *    ursprungliga (ordinarie) och en som lades till 2022-05-24 (shadowless/1st Ed,
 *    där 1st Edition är en flagga på annonsen, inte en egen produkt). Paret bestäms
 *    av TVÅ oberoende signaler som måste vara ense: datumbatchen OCH att
 *    2022-produkten är dyrare i CM:s egen prisguide. Kort där de inte är ense —
 *    eller som har fler än två CM-produkter — DELAS INTE. Hellre ett odelat kort än
 *    tre produkter med fel länkar.
 *
 * Priserna sätts INTE här: `runCardmarketRefresh` routar varje feed-rad till
 * produkten för precis dess `version` (src/lib/print-variant.ts). Kör den efteråt.
 */
import { prisma } from "../src/lib/db";
import { normalizeTitle } from "../src/lib/utils";
import { cardmarketProductUrl } from "../src/lib/marketplace-urls";
import {
  PRINT_FIRST_EDITION,
  PRINT_SHADOWLESS,
  PRINT_UNLIMITED,
  type PrintVariantLabel,
} from "../src/lib/print-variant";

const APPLY = process.argv.includes("--apply");
const SET_NAME = process.env.SPLIT_SET_NAME ?? "Base";
/** CM-expansionen för Base Set. Andra set har egna id:n → skriptet vägrar gissa. */
const CM_EXPANSION = parseInt(process.env.SPLIT_CM_EXPANSION ?? "1523", 10);

const CM_SINGLES = "https://downloads.s3.cardmarket.com/productCatalog/productList/products_singles_6.json";
const CM_GUIDE = "https://downloads.s3.cardmarket.com/productCatalog/priceGuide/price_guide_6.json";

/** Tryckningar som ska FINNAS som egna produkter, i visningsordning. */
const NEW_PRINTS: PrintVariantLabel[] = [PRINT_SHADOWLESS, PRINT_FIRST_EDITION];

const slugify = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

async function main() {
  console.log(`${APPLY ? "SKARP KÖRNING" : "TORRKÖRNING (lägg till --apply för att skriva)"} — set "${SET_NAME}"\n`);

  // ── CM:s katalog: para ihop de två produkterna per kortnamn ─────────────────
  const [cat, guide] = await Promise.all([
    fetch(CM_SINGLES).then((r) => r.json() as Promise<{ products: { idProduct: number; name: string; idExpansion: number; dateAdded: string }[] }>),
    fetch(CM_GUIDE).then((r) => r.json() as Promise<{ priceGuides: { idProduct: number; trend: number | null }[] }>),
  ]);
  const trend = new Map(guide.priceGuides.map((e) => [e.idProduct, e.trend]));
  const byCmName = new Map<string, { idProduct: number; dateAdded: string }[]>();
  for (const p of cat.products) {
    if (p.idExpansion !== CM_EXPANSION) continue;
    if (!byCmName.has(p.name)) byCmName.set(p.name, []);
    byCmName.get(p.name)!.push({ idProduct: p.idProduct, dateAdded: p.dateAdded });
  }
  /** kortnamn (CM) → { ordinarie, shadowless } eller null när signalerna inte är ense. */
  const pairs = new Map<string, { ordinary: number; shadow: number }>();
  for (const [name, ps] of byCmName) {
    if (ps.length !== 2) continue;
    const [older, newer] = [...ps].sort((a, b) => a.idProduct - b.idProduct);
    const dateOk = newer.dateAdded.startsWith("2022-05-24") && older.dateAdded.startsWith("0000");
    const tOld = trend.get(older.idProduct) ?? 0, tNew = trend.get(newer.idProduct) ?? 0;
    const priceOk = tOld > 0 && tNew > 0 && tNew > tOld * 1.5;
    if (dateOk && priceOk) pairs.set(name, { ordinary: older.idProduct, shadow: newer.idProduct });
  }
  console.log(`CM-expansion ${CM_EXPANSION}: ${byCmName.size} kortnamn, ${pairs.size} med entydigt tryckningspar\n`);

  // ── Vår katalog ─────────────────────────────────────────────────────────────
  const set = await prisma.cardSet.findFirst({ where: { name: SET_NAME }, select: { id: true, name: true, totalCards: true } });
  if (!set) throw new Error(`setet "${SET_NAME}" finns inte`);
  const products = await prisma.product.findMany({
    where: { category: "SINGLE_CARD", setId: set.id },
    select: {
      id: true, title: true, slug: true, imageUrl: true, language: true, variantLabel: true,
      cardId: true, setId: true, releaseDate: true, description: true,
      card: { select: { id: true, name: true, number: true, tcgExternalId: true } },
    },
    orderBy: { slug: "asc" },
  });
  console.log(`Vår katalog: ${products.length} produkter i "${set.name}"\n`);

  const cm = await prisma.retailer.findFirst({ where: { name: "Cardmarket" }, select: { id: true } });
  if (!cm) throw new Error("Cardmarket-retailer saknas");

  // CM-namnet är "Ponyta [Smash Kick | Flame Tail]" — vi matchar på delen FÖRE "[",
  // och bara när den delen är ENTYDIG i expansionen (annars vet vi inte vilket par).
  const cmNameByBase = new Map<string, string[]>();
  for (const name of pairs.keys()) {
    const base = name.split("[")[0].trim().toLowerCase();
    if (!cmNameByBase.has(base)) cmNameByBase.set(base, []);
    cmNameByBase.get(base)!.push(name);
  }

  let willSplit = 0, skippedNoPair = 0, skippedAmbiguous = 0, alreadySplit = 0;
  const plan: { product: (typeof products)[number]; ordinary: number; shadow: number }[] = [];
  const skipped: string[] = [];

  for (const p of products) {
    if (p.variantLabel) { alreadySplit++; continue; }
    const cardName = p.card?.name?.trim().toLowerCase();
    if (!cardName) { skipped.push(`${p.title} — ingen Card-relation`); skippedNoPair++; continue; }
    const hits = cmNameByBase.get(cardName) ?? [];
    if (hits.length === 0) { skipped.push(`${p.card?.name} ${p.card?.number} — inget entydigt CM-par`); skippedNoPair++; continue; }
    if (hits.length > 1) { skipped.push(`${p.card?.name} ${p.card?.number} — ${hits.length} CM-namn matchar`); skippedAmbiguous++; continue; }
    const pair = pairs.get(hits[0])!;
    plan.push({ product: p, ...pair });
    willSplit++;
  }

  console.log(`Delas: ${willSplit} kort → ${willSplit * 3} produkter`);
  console.log(`Redan uppdelade (hoppas över): ${alreadySplit}`);
  console.log(`Hoppas över, inget entydigt par: ${skippedNoPair}`);
  console.log(`Hoppas över, tvetydigt namn: ${skippedAmbiguous}\n`);
  if (skipped.length) {
    console.log("Överhoppade kort (behåller EN produkt):");
    for (const s of skipped) console.log(`  ${s}`);
    console.log("");
  }

  const sample = plan.slice(0, 3);
  console.log("Exempel på vad som skrivs:");
  for (const { product: p, ordinary, shadow } of sample) {
    console.log(`  ${p.card?.name} ${p.card?.number}`);
    console.log(`    BEHÅLLS  ${p.slug}`);
    console.log(`             titel "${p.title}" → "${p.title} · ${PRINT_UNLIMITED}"`);
    console.log(`             CM-länk → idProduct=${ordinary}`);
    for (const label of NEW_PRINTS)
      console.log(`    NY       ${p.slug}-${slugify(label)}  "${p.title} · ${label}"  CM idProduct=${shadow}`);
  }
  console.log("");

  if (!APPLY) {
    console.log("Torrkörning klar — inget skrevs. Kör om med --apply.");
    await prisma.$disconnect();
    return;
  }

  let updated = 0, created = 0;
  for (const { product: p, ordinary, shadow } of plan) {
    // 1) Befintlig produkt → Unlimited (behåller id/slug/historik/bevakningar).
    const unlimitedTitle = `${p.title} · ${PRINT_UNLIMITED}`;
    await prisma.product.update({
      where: { id: p.id },
      data: {
        title: unlimitedTitle,
        normalizedTitle: normalizeTitle(unlimitedTitle),
        variantLabel: PRINT_UNLIMITED,
      },
    });
    // Länken ska peka på CM:s ORDINARIE produkt. Den gamla slug-länken kom från
    // pokemontcg.io och kan lika gärna vara shadowless-produkten — slugen säger
    // inte vilket idProduct den är, så vi skriver en entydig idProduct-länk.
    await prisma.offer.upsert({
      where: {
        productId_retailerId_condition_language: {
          productId: p.id, retailerId: cm.id, condition: "NEAR_MINT", language: "EN",
        },
      },
      update: { url: cardmarketProductUrl(ordinary, { nearMint: true }) },
      create: {
        productId: p.id, retailerId: cm.id, condition: "NEAR_MINT", language: "EN",
        price: null, currency: "SEK", stockStatus: "OUT_OF_STOCK",
        url: cardmarketProductUrl(ordinary, { nearMint: true }),
      },
    });
    updated++;

    // 2) De två nya tryckningarna.
    for (const label of NEW_PRINTS) {
      const title = `${p.title} · ${label}`;
      const slug = `${p.slug}-${slugify(label)}`;
      const existing = await prisma.product.findUnique({ where: { slug }, select: { id: true } });
      if (existing) continue;
      const np = await prisma.product.create({
        data: {
          title,
          normalizedTitle: normalizeTitle(title),
          slug,
          category: "SINGLE_CARD",
          variantLabel: label,
          cardId: p.cardId,
          setId: p.setId,
          imageUrl: p.imageUrl,
          description: p.description,
          releaseDate: p.releaseDate,
          language: p.language,
        },
        select: { id: true },
      });
      // Shadowless OCH 1st Edition bor på SAMMA CM-produkt (1st Edition är en
      // flagga på annonsen där, inte en egen produkt) → samma länk, olika pris.
      await prisma.offer.create({
        data: {
          productId: np.id, retailerId: cm.id, condition: "NEAR_MINT", language: "EN",
          price: null, currency: "SEK", stockStatus: "OUT_OF_STOCK",
          url: cardmarketProductUrl(shadow, { nearMint: true }),
        },
      });
      created++;
    }
  }
  console.log(`KLART: ${updated} produkter märkta ${PRINT_UNLIMITED}, ${created} nya tryckningsprodukter.`);
  console.log(`Kör nu: CM_ONLY_EPISODES=171 … cardmarket-refresh-run.ts --singles  (sätter priserna)`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
