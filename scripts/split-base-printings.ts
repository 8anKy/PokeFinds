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
 *    2022-produkten är dyrare i CM:s egen prisguide. Kort där de inte är ense
 *    DELAS INTE. Hellre ett odelat kort än tre produkter med fel länkar.
 *  - 1st Edition-länken bär `isFirstEd=Y`. Utan filtret pekar Shadowless och 1st
 *    Edition på exakt samma osorterade CM-sida, fast bara den ena tryckningens
 *    annonser gav priset vi publicerar (se withFirstEd i lib/marketplace-urls).
 *
 * DATUMBATCHEN ÄR HELA EXPANSIONEN, INTE ETT ANTAL PRODUKTER (2026-07-28):
 * regeln var först "exakt två CM-produkter med det namnet", vilket hoppade över
 * kort som har en TREDJE produkt av helt andra skäl. CM-expansionen (1523) har
 * 104 produkter daterade "0000-00-00" (ordinarie), 103 daterade 2022-05-24
 * (shadowless/1st Ed) och fyra udda: tre starters som fick en extra produkt
 * 2021-03-04 (prissatta som Unlimited i guiden — alltså varken Shadowless eller
 * 1st Edition) och en Pikachu från 2018. Paret är därför den ENDA produkten i
 * 0000-batchen och den ENDA i 2022-batchen; produkter i andra batchar är något
 * tredje som vi inte modellerar. Kort med flera produkter i SAMMA batch delas
 * fortfarande inte — Base-Pikachu har sex CM-produkter (V1–V6) där röda/gula
 * kinder korsar tryckningarna, och där finns inget entydigt par att peka på.
 *
 * Priserna sätts INTE här: `runCardmarketRefresh` routar varje feed-rad till
 * produkten för precis dess `version` (src/lib/print-variant.ts). Kör den efteråt.
 */
import { prisma } from "../src/lib/db";
import { normalizeTitle } from "../src/lib/utils";
import { cardmarketProductUrl, withFirstEd } from "../src/lib/marketplace-urls";
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
/** Datumbatchen där CM la shadowless/1st Edition-produkterna (se filhuvudet). */
const SHADOW_BATCH = process.env.SPLIT_CM_SHADOW_BATCH ?? "2022-05-24";
/** Ordinarie produkter saknar datum i CM:s katalog ("0000-00-00 00:00:00"). */
const ORDINARY_BATCH = "0000";

const CM_SINGLES = "https://downloads.s3.cardmarket.com/productCatalog/productList/products_singles_6.json";
const CM_GUIDE = "https://downloads.s3.cardmarket.com/productCatalog/priceGuide/price_guide_6.json";

/** Tryckningar som ska FINNAS som egna produkter, i visningsordning. */
const NEW_PRINTS: PrintVariantLabel[] = [PRINT_SHADOWLESS, PRINT_FIRST_EDITION];

/**
 * Länken för en tryckning. Shadowless och 1st Edition delar CM-produkt, så det är
 * BARA filtret som skiljer sidorna åt — utan det visar 1st Edition-produkten en
 * lista där de billigaste annonserna är Shadowless, alltså inte det pris vi
 * publicerar för den.
 */
const printUrl = (idProduct: number, label: PrintVariantLabel) =>
  cardmarketProductUrl(idProduct, { nearMint: true, firstEd: label === PRINT_FIRST_EDITION });

const slugify = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/**
 * CM stavar några kortnamn annorlunda än pokemontcg.io. Tabellen är EXPLICIT med
 * flit: en fuzzy namnmatchning hade fällt ihop "Professor Oak" (#88) med
 * "Imposter Professor Oak" (#73) — två olika kort i samma set.
 */
const CM_NAME_ALIASES: Record<string, string> = {
  "impostor professor oak": "imposter professor oak", // CM: "Imposter"
};

/**
 * Jämförnyckel ur ett CM-namn: "Bulbasaur [Leech Seed]" → "bulbasaur",
 * "Nidoran [M] [Horn Hazard]" → "nidoran m".
 *
 * Attacknamnen i hakparenteser är brus, men KÖNSMARKÖREN är identitet — släpper
 * man alla parenteser faller Nidoran ♂ och ♀ ihop till samma nyckel (i Base
 * finns bara hanen, men skriptet körs set för set).
 */
function cmNameKey(name: string): string {
  const groups = [...name.matchAll(/\[([^\]]+)\]/g)].map((m) => m[1].trim().toLowerCase());
  const gender = groups.find((g) => g === "m" || g === "f");
  const base = name.split("[")[0].trim().toLowerCase();
  return gender ? `${base} ${gender}` : base;
}

/** Samma nyckel ur VÅRT kortnamn: "Nidoran ♂" → "nidoran m". */
function ourNameKey(name: string): string {
  const gender = /♂/.test(name) ? "m" : /♀/.test(name) ? "f" : "";
  const base = name.replace(/[♂♀]/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
  const aliased = CM_NAME_ALIASES[base] ?? base;
  return gender ? `${aliased} ${gender}` : aliased;
}

type GuideRow = { trend: number | null; low?: number | null; avg?: number | null };

/**
 * Är den nyare CM-produkten dyrare — mätt så att ETT korrupt guide-fält inte
 * avgör ensamt?
 *
 * VARFÖR MAJORITET: guiden har mätbart trasiga enstaka fält. Drowzee och Machop
 * har `trend` = 0,02 € på 2022-produkten (dvs "inget data"-golvet) medan `avg`
 * (3,48 / 15,35 €) och `low` (1 / 0,30 €) säger tvärtom — och Jynx ordinarie har
 * en trend på 12,09 € mot sitt eget avg på 1,37 €. Ett enfältstest läste därför
 * fyra kort som "signalerna är oense" och hoppade över dem.
 * Marginalen finns för att basenergier har en ärligt LITEN premie (Psychic
 * Energy 0,37 → 0,46 €): kravet är riktning med marginal, inte en faktor 1,5.
 */
const DEARER_MARGIN = 1.15;
function newerIsDearer(older: GuideRow | undefined, newer: GuideRow | undefined) {
  let up = 0, down = 0, compared = 0;
  for (const f of ["trend", "avg", "low"] as const) {
    const a = older?.[f] ?? 0, b = newer?.[f] ?? 0;
    if (!(a > 0) || !(b > 0)) continue;
    compared++;
    if (b > a * DEARER_MARGIN) up++;
    else if (a > b * DEARER_MARGIN) down++;
  }
  return { ok: compared >= 2 && up >= 2 && up > down, up, down, compared };
}

async function main() {
  console.log(`${APPLY ? "SKARP KÖRNING" : "TORRKÖRNING (lägg till --apply för att skriva)"} — set "${SET_NAME}"\n`);

  // ── CM:s katalog: para ihop de två produkterna per kortnamn ─────────────────
  const [cat, guide] = await Promise.all([
    fetch(CM_SINGLES).then((r) => r.json() as Promise<{ products: { idProduct: number; name: string; idExpansion: number; dateAdded: string }[] }>),
    fetch(CM_GUIDE).then((r) => r.json() as Promise<{ priceGuides: ({ idProduct: number } & GuideRow)[] }>),
  ]);
  const guideById = new Map(guide.priceGuides.map((e) => [e.idProduct, e]));
  // Nyckeln är kortets IDENTITET (namn + ev. könsmarkör), inte CM:s hela sträng:
  // attacknamnen inom hakparenteser skiljer sig ibland mellan de två produkterna.
  const byCmName = new Map<string, { idProduct: number; dateAdded: string }[]>();
  for (const p of cat.products) {
    if (p.idExpansion !== CM_EXPANSION) continue;
    const key = cmNameKey(p.name);
    if (!byCmName.has(key)) byCmName.set(key, []);
    byCmName.get(key)!.push({ idProduct: p.idProduct, dateAdded: p.dateAdded });
  }
  /** kortnamn (CM) → { ordinarie, shadowless }. Saknas nyckeln var signalerna oense. */
  const pairs = new Map<string, { ordinary: number; shadow: number }>();
  const pairRejects: string[] = [];
  for (const [name, ps] of byCmName) {
    // Paret = den ENDA produkten i vardera tryckningsbatchen. Produkter i andra
    // batchar är något tredje (se filhuvudet) och ignoreras; flera i samma batch
    // betyder att vi inte vet vilken som är vilken → inget par.
    const ordinaries = ps.filter((p) => p.dateAdded.startsWith(ORDINARY_BATCH));
    const shadows = ps.filter((p) => p.dateAdded.startsWith(SHADOW_BATCH));
    if (ordinaries.length !== 1 || shadows.length !== 1) {
      pairRejects.push(`${name} — ${ordinaries.length} i ordinarie batch, ${shadows.length} i ${SHADOW_BATCH} (av ${ps.length} produkter)`);
      continue;
    }
    const older = ordinaries[0], newer = shadows[0];
    const price = newerIsDearer(guideById.get(older.idProduct), guideById.get(newer.idProduct));
    if (!price.ok) {
      pairRejects.push(`${name} — prissignalen oense (${price.up} upp / ${price.down} ner av ${price.compared} fält)`);
      continue;
    }
    pairs.set(name, { ordinary: older.idProduct, shadow: newer.idProduct });
  }
  console.log(`CM-expansion ${CM_EXPANSION}: ${byCmName.size} kortnamn, ${pairs.size} med entydigt tryckningspar`);
  if (pairRejects.length) {
    console.log(`${pairRejects.length} utan par:`);
    for (const r of pairRejects) console.log(`  ${r}`);
  }
  console.log("");

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

  let willSplit = 0, skippedNoPair = 0, alreadySplit = 0;
  const plan: { product: (typeof products)[number]; ordinary: number; shadow: number }[] = [];
  const skipped: string[] = [];

  for (const p of products) {
    if (p.variantLabel) { alreadySplit++; continue; }
    const cardName = p.card?.name?.trim();
    if (!cardName) { skipped.push(`${p.title} — ingen Card-relation`); skippedNoPair++; continue; }
    const pair = pairs.get(ourNameKey(cardName));
    if (!pair) { skipped.push(`${p.card?.name} ${p.card?.number} — inget entydigt CM-par`); skippedNoPair++; continue; }
    plan.push({ product: p, ...pair });
    willSplit++;
  }

  console.log(`Delas: ${willSplit} kort → ${willSplit * 3} produkter`);
  console.log(`Redan uppdelade (hoppas över): ${alreadySplit}`);
  console.log(`Hoppas över, inget entydigt par: ${skippedNoPair}\n`);
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
      console.log(`    NY       ${p.slug}-${slugify(label)}  "${p.title} · ${label}"  CM-länk → ${printUrl(shadow, label)}`);
  }
  console.log("");

  // ── Länkfilter på REDAN uppdelade 1st Edition-produkter ─────────────────────
  // Idempotent självläkning: de första 92 korten delades innan isFirstEd=Y fanns,
  // och deras länk pekar därför på samma osorterade sida som Shadowless.
  const firstEdOffers = await prisma.offer.findMany({
    where: {
      retailerId: cm.id,
      product: { setId: set.id, category: "SINGLE_CARD", variantLabel: PRINT_FIRST_EDITION },
    },
    select: { id: true, url: true, product: { select: { title: true } } },
  });
  const needsFilter = firstEdOffers.filter((o) => o.url && !/[?&]isFirstEd=/i.test(o.url));
  console.log(`1st Edition-offers: ${firstEdOffers.length}, varav ${needsFilter.length} saknar isFirstEd=Y\n`);

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
      // flagga på annonsen där, inte en egen produkt) → samma produkt, men 1st
      // Edition-länken bär isFirstEd=Y så sidan visar de annonser priset kom ur.
      await prisma.offer.create({
        data: {
          productId: np.id, retailerId: cm.id, condition: "NEAR_MINT", language: "EN",
          price: null, currency: "SEK", stockStatus: "OUT_OF_STOCK",
          url: printUrl(shadow, label),
        },
      });
      created++;
    }
  }

  let relinked = 0;
  for (const o of needsFilter) {
    await prisma.offer.update({ where: { id: o.id }, data: { url: withFirstEd(o.url) } });
    relinked++;
  }

  console.log(`KLART: ${updated} produkter märkta ${PRINT_UNLIMITED}, ${created} nya tryckningsprodukter, ${relinked} 1st Edition-länkar fick isFirstEd=Y.`);
  console.log(`Kör nu: CM_ONLY_EPISODES=171 … cardmarket-refresh-run.ts --singles  (sätter priserna)`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
