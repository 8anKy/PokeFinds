/**
 * Importerar RIKTIG kortdata från officiella Pokémon TCG API:t
 * (https://api.pokemontcg.io/v2) till databasen.
 *
 * Körs med:  npm run import:tcg          (kräver internet)
 * Valfritt:  POKEMONTCG_API_KEY i .env   (gratis nyckel → högre rate limit)
 *            TCG_SET_LIMIT=18            (antal senaste set)
 *            TCG_CARDS_PER_SET=250       (max kort per set, API-max 250)
 *            TCG_NEW_ONLY=1              (bara set som SAKNAS i DB — automationens
 *                                         läge: nytt set → CardSet + alla kort +
 *                                         produkter; 0 nya = snabb no-op. Priser/
 *                                         CM-länkar fylls av dagliga cardmarket-
 *                                         refresh som upsertar offers på alla
 *                                         singlar med tcgExternalId.)
 *
 * Vad den gör:
 *  1. Hämtar de senaste seten → upsertar CardSet (namn, serie, datum, logo/symbol)
 *  2. Hämtar kort per set (paginering, pageSize 250, backoff vid 429/5xx)
 *     → upsertar Card med riktiga bild-URL:er (images.pokemontcg.io)
 *  3. Skapar/uppdaterar Product (SINGLE_CARD) för kort med marknadspris och
 *     loggar en PriceObservation per kort (källa "Pokémon TCG API", rådata
 *     från cardmarket/tcgplayer sparas i rawData)
 *  4. Sätter set-loggan som bild på sealed-produkter som saknar bild
 *
 * Priser: Cardmarket EUR → öre och TCGplayer USD → öre via live kurs
 * (getRatesOre). Se src/scrapers/adapters/pokemontcg-adapter.ts.
 *
 * Etik: officiellt API, ingen scraping, tydlig user-agent, backoff. Seeden
 * (prisma/seed.ts) fungerar helt offline — detta script BERIKAR efteråt.
 */
import { PrismaClient, type Prisma } from "@prisma/client";
import {
  fetchTcgSets,
  fetchTcgCardsForSet,
  cardMarketPriceOre,
  parseTcgDate,
  TCG_PAGE_SIZE,
} from "../src/scrapers/adapters/pokemontcg-adapter";
import { getRatesOre } from "../src/lib/exchange-rate";
import { normalizeTitle, slugify } from "../src/lib/utils";

const prisma = new PrismaClient();

// 0 = alla set (ingen begränsning). Sätts till 0 som standard för att hämta hela katalogen.
const SET_LIMIT = Number(process.env.TCG_SET_LIMIT ?? 0);
// 0 = inget tak per set (paginerar tills alla kort hämtats, även set >250 kort)
const CARDS_PER_SET = Number(process.env.TCG_CARDS_PER_SET ?? 0) || Number.MAX_SAFE_INTEGER;
// Valfritt: begränsa till specifika set, t.ex. TCG_SET_IDS=sv10,sm5,swsh8
const SET_IDS = (process.env.TCG_SET_IDS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
// Automationens läge: bara set vars externalId saknas i DB (nya släpp).
const NEW_ONLY = process.env.TCG_NEW_ONLY === "1";

async function main() {
  // Färsk EUR/USD-kurs (öre) en gång → cardMarketPriceOre() läser den synkront.
  const rates = await getRatesOre();
  console.log(`💱 Kurs: 1 EUR = ${(rates.eurToOre / 100).toFixed(3)} SEK, 1 USD = ${(rates.usdToOre / 100).toFixed(3)} SEK`);

  const setLabel =
    SET_IDS.length > 0 ? `set: ${SET_IDS.join(", ")}` : SET_LIMIT > 0 ? `${SET_LIMIT} set` : "ALLA set";
  const cardsLabel = CARDS_PER_SET === Number.MAX_SAFE_INTEGER ? "alla" : `max ${CARDS_PER_SET}`;
  console.log(
    `📡 Importerar från Pokémon TCG API (${setLabel}, ${cardsLabel} kort/set)` +
      (process.env.POKEMONTCG_API_KEY ? " — med API-nyckel" : " — utan API-nyckel (lägre rate limit)")
  );

  // Källa för prisobservationer
  const source = await prisma.scrapeSource.upsert({
    where: { name: "Pokémon TCG API" },
    update: { isActive: true, lastRunAt: new Date() },
    create: {
      name: "Pokémon TCG API",
      baseUrl: "https://api.pokemontcg.io/v2",
      type: "API",
      isActive: true,
      config: {
        note: "Officiellt gratis API — ingen scraping. Nyckel via https://dev.pokemontcg.io",
        eurToOre: rates.eurToOre,
        usdToOre: rates.usdToOre,
      },
    },
  });

  let sets = await fetchTcgSets(SET_LIMIT);
  if (SET_IDS.length > 0) {
    sets = sets.filter((s) => SET_IDS.includes(s.id));
  }
  if (NEW_ONLY) {
    const have = new Set(
      (await prisma.cardSet.findMany({ select: { externalId: true } })).map((s) => s.externalId)
    );
    sets = sets.filter((s) => !have.has(s.id));
    console.log(`🆕 TCG_NEW_ONLY: ${sets.length} set saknas i DB${sets.length ? ` — ${sets.map((s) => `${s.id} (${s.name})`).join(", ")}` : ""}`);
    if (sets.length === 0) {
      console.log("Inget nytt set — klart.");
      return;
    }
  }
  console.log(`✅ Hämtade ${sets.length} set från API:t`);

  let cardCount = 0;
  let productCount = 0;
  let observationCount = 0;

  let skippedSets = 0;

  for (let si = 0; si < sets.length; si++) {
    const tcgSet = sets[si];
    let set;
    try {
      set = await prisma.cardSet.upsert({
        where: { externalId: tcgSet.id },
        update: {
          name: tcgSet.name,
          series: tcgSet.series,
          releaseDate: parseTcgDate(tcgSet.releaseDate),
          logoUrl: tcgSet.images?.logo ?? null,
          symbolUrl: tcgSet.images?.symbol ?? null,
          totalCards: tcgSet.printedTotal || tcgSet.total,
        },
        create: {
          externalId: tcgSet.id,
          name: tcgSet.name,
          series: tcgSet.series,
          releaseDate: parseTcgDate(tcgSet.releaseDate),
          logoUrl: tcgSet.images?.logo ?? null,
          symbolUrl: tcgSet.images?.symbol ?? null,
          totalCards: tcgSet.printedTotal || tcgSet.total,
        },
      });
    } catch (err) {
      console.warn(`   ⚠️ Kunde inte spara set ${tcgSet.name} (${tcgSet.id}): ${err instanceof Error ? err.message : err}`);
      skippedSets++;
      continue;
    }

    let cards;
    try {
      cards = await fetchTcgCardsForSet(tcgSet.id, CARDS_PER_SET);
    } catch (err) {
      console.warn(`   ⚠️ Kunde inte hämta kort för ${tcgSet.name} (${tcgSet.id}): ${err instanceof Error ? err.message : err}`);
      skippedSets++;
      continue;
    }
    console.log(`   [${si + 1}/${sets.length}] ${tcgSet.name} (${tcgSet.id}): ${cards.length} kort`);

    for (const tcgCard of cards) {
      const imageUrl = tcgCard.images?.large ?? tcgCard.images?.small ?? null;
      // Identitet via globalt unikt API-id (tcgExternalId). Kortnummer är inte
      // unikt inom ett set, så composite-nyckeln skulle kollapsa varianter
      // (t.ex. Celebrations Classic Collections fyra kort med nummer 15).
      const card = await prisma.card.upsert({
        where: { tcgExternalId: tcgCard.id },
        update: {
          name: tcgCard.name,
          rarity: tcgCard.rarity ?? "Unknown",
          imageUrl,
          tcgExternalId: tcgCard.id,
          supertype: tcgCard.supertype ?? null,
          subtype: tcgCard.subtypes?.[0] ?? null,
          artist: tcgCard.artist ?? null,
        },
        create: {
          setId: set.id,
          number: tcgCard.number,
          language: "EN",
          name: tcgCard.name,
          rarity: tcgCard.rarity ?? "Unknown",
          imageUrl,
          tcgExternalId: tcgCard.id,
          supertype: tcgCard.supertype ?? null,
          subtype: tcgCard.subtypes?.[0] ?? null,
          artist: tcgCard.artist ?? null,
        },
      });
      cardCount++;

      // Produkt skapas för ALLA kort — prisobservation endast där marknadspris finns
      const priceOre = cardMarketPriceOre(tcgCard);

      const title = `${tcgCard.name} · ${tcgSet.name} ${tcgCard.number}/${tcgSet.printedTotal || tcgSet.total}`;
      // Matcha i första hand på cardId — seedade produkter kan ha annan slug
      // (set-NAMN istället för set-id) och får inte dubbletter.
      const existing = await prisma.product.findFirst({
        where: { cardId: card.id, category: "SINGLE_CARD" },
        select: { id: true },
      });
      let product;
      if (existing) {
        product = await prisma.product.update({
          where: { id: existing.id },
          data: {
            title,
            normalizedTitle: normalizeTitle(title),
            imageUrl,
            setId: set.id,
          },
        });
      } else {
        // Slug måste vara unik. Kort med samma nummer i ett set (varianter med
        // identiskt namn skulle annars krocka) får ett suffix från det globalt
        // unika tcgExternalId.
        const baseSlug = slugify(`${tcgCard.name}-${tcgSet.id}-${tcgCard.number}`);
        let slug = baseSlug;
        const idSuffix = slugify(tcgCard.id);
        if (await prisma.product.findUnique({ where: { slug }, select: { id: true } })) {
          slug = `${baseSlug}-${idSuffix}`;
        }
        product = await prisma.product.create({
          data: {
            title,
            normalizedTitle: normalizeTitle(title),
            slug,
            category: "SINGLE_CARD",
            cardId: card.id,
            setId: set.id,
            imageUrl,
            language: "EN",
          },
        });
      }
      productCount++;

      if (!priceOre) continue;

      await prisma.priceObservation.create({
        data: {
          productId: product.id,
          sourceId: source.id,
          price: priceOre,
          currency: "SEK",
          condition: "NEAR_MINT",
          rawData: {
            cardId: tcgCard.id,
            cardmarket: tcgCard.cardmarket ?? null,
            tcgplayer: tcgCard.tcgplayer ?? null,
          } as Prisma.InputJsonValue,
        },
      });
      observationCount++;
    }
  }

  // Sätt set-loggan som bild på sealed-produkter som saknar bild
  const sealed = await prisma.product.findMany({
    where: { imageUrl: null, setId: { not: null }, category: { not: "SINGLE_CARD" } },
    include: { set: true },
  });
  let sealedUpdated = 0;
  for (const p of sealed) {
    if (p.set?.logoUrl) {
      await prisma.product.update({
        where: { id: p.id },
        data: { imageUrl: p.set.logoUrl },
      });
      sealedUpdated++;
    }
  }

  console.log("🎉 Import klar!");
  console.log(`   Set:               ${sets.length}${skippedSets > 0 ? ` (${skippedSets} misslyckade)` : ""}`);
  console.log(`   Kort upsertade:    ${cardCount}`);
  console.log(`   Produkter:         ${productCount}`);
  console.log(`   Prisobservationer: ${observationCount}`);
  console.log(`   Sealed-bilder:     ${sealedUpdated}`);
}

main()
  .catch((e) => {
    console.error("Import misslyckades:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
