/**
 * Hämtar RIKTIGA Cardmarket-priser från TCGdex API (https://api.tcgdex.net)
 * för singelkort som saknar pris — pokemontcg.io saknar prisdata för de
 * nyaste seten (me2pt5/me3/me4 m.fl.) men TCGdex har färska Cardmarket-
 * trend-priser (EUR) för dem.
 *
 * - Matchar set via namn (TCGdex har andra set-id:n, t.ex. me02.5 ≠ me2pt5)
 *   och kort via lokalt nummer.
 * - Pris: cardmarket trend (EUR→öre @ 1150), fallback avg30/avg/low,
 *   sista utväg TCGplayer marketPrice (USD→öre @ 1050). Aldrig fabricerat.
 * - Skapar PriceObservation (källa "TCGdex API", rådata = pricing-objektet)
 *   och sätter priset på produktens Cardmarket-offer.
 *
 * Körs med: npx tsx scripts/import-tcgdex-prices.ts
 */
import { PrismaClient, type Prisma } from "@prisma/client";
import { getRatesOre, EUR_FALLBACK_ORE, USD_FALLBACK_ORE } from "../src/lib/exchange-rate";

const prisma = new PrismaClient();

// Sätts till live-kurs i main() innan priceOreFromPricing() används.
let EUR_TO_ORE = EUR_FALLBACK_ORE;
let USD_TO_ORE = USD_FALLBACK_ORE;
const DELAY_MS = 120;
const UA = "Foilio/1.0 (prisjamforelse; hej@foilio.se)";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** pokemontcg.io set-id → TCGdex set-id där namnen inte matchar. */
const SET_ID_ALIASES: Record<string, string> = {
  tk1a: "tk-ex-latia",
  tk1b: "tk-ex-latio",
  tk2a: "tk-ex-p",
  tk2b: "tk-ex-m",
  sve: "sve", // "Scarlet & Violet Energies" heter "Scarlet & Violet Energy" hos TCGdex
};

interface TcgdexPricing {
  cardmarket?: {
    unit?: string;
    trend?: number | null;
    avg30?: number | null;
    avg?: number | null;
    low?: number | null;
  } | null;
  tcgplayer?: {
    unit?: string;
    [variant: string]: unknown;
  } | null;
}

function priceOreFromPricing(pricing: TcgdexPricing | undefined): number | null {
  const cm = pricing?.cardmarket;
  const eur = cm?.trend ?? cm?.avg30 ?? cm?.avg ?? cm?.low ?? null;
  if (eur != null && eur > 0) return Math.round(eur * EUR_TO_ORE);
  // Fallback: TCGplayer marketPrice (första variant med pris)
  const tp = pricing?.tcgplayer;
  if (tp) {
    for (const key of Object.keys(tp)) {
      const v = tp[key];
      if (v && typeof v === "object" && "marketPrice" in v) {
        const usd = (v as { marketPrice?: number | null }).marketPrice;
        if (usd != null && usd > 0) return Math.round(usd * USD_TO_ORE);
      }
    }
  }
  return null;
}

async function fetchJson<T>(url: string): Promise<T | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { headers: { "user-agent": UA } });
      if (res.status === 404) return null;
      if (!res.ok) {
        await sleep(1000 * (attempt + 1));
        continue;
      }
      return (await res.json()) as T;
    } catch {
      await sleep(1000 * (attempt + 1));
    }
  }
  return null;
}

async function main() {
  ({ eurToOre: EUR_TO_ORE, usdToOre: USD_TO_ORE } = await getRatesOre());
  console.log(`💱 Kurs: 1 EUR = ${(EUR_TO_ORE / 100).toFixed(3)} SEK, 1 USD = ${(USD_TO_ORE / 100).toFixed(3)} SEK`);

  const cardmarket = await prisma.retailer.findFirstOrThrow({ where: { name: "Cardmarket" } });

  const source = await prisma.scrapeSource.upsert({
    where: { name: "TCGdex API" },
    update: { isActive: true, lastRunAt: new Date() },
    create: {
      name: "TCGdex API",
      baseUrl: "https://api.tcgdex.net/v2",
      type: "API",
      isActive: true,
      config: {
        note: "Officiellt gratis API med Cardmarket/TCGplayer-prisdata. Ingen scraping.",
        eurToOre: EUR_TO_ORE,
        usdToOre: USD_TO_ORE,
      },
    },
  });

  // TCGdex set-id:n matchas via namn (deras id:n skiljer sig från pokemontcg.io)
  const tcgdexSets = await fetchJson<{ id: string; name: string }[]>(
    "https://api.tcgdex.net/v2/en/sets"
  );
  if (!tcgdexSets) throw new Error("Kunde inte hämta TCGdex set-lista");
  const setIdByName = new Map<string, string>();
  for (const s of tcgdexSets) setIdByName.set(s.name.toLowerCase(), s.id);
  console.log(`📡 TCGdex: ${tcgdexSets.length} set i katalogen`);

  // Alla singelkort vars Cardmarket-offer saknar pris
  const products = await prisma.product.findMany({
    where: {
      category: "SINGLE_CARD",
      offers: { some: { retailerId: cardmarket.id, price: null } },
    },
    select: {
      id: true,
      title: true,
      card: { select: { number: true } },
      set: { select: { name: true, externalId: true } },
      offers: {
        where: { retailerId: cardmarket.id },
        select: { id: true },
      },
    },
  });
  console.log(`🔍 ${products.length} singelkort utan Cardmarket-pris`);

  let priced = 0;
  let noTcgdexSet = 0;
  let noCard = 0;
  let noPrice = 0;

  for (const p of products) {
    if (!p.card || !p.set) continue;
    const tcgdexSetId =
      (p.set.externalId ? SET_ID_ALIASES[p.set.externalId] : undefined) ??
      setIdByName.get(p.set.name.toLowerCase());
    if (!tcgdexSetId) {
      noTcgdexSet++;
      continue;
    }

    // Vissa set zero-paddar localId (001–099) — prova båda formaten
    let card = await fetchJson<{ pricing?: TcgdexPricing }>(
      `https://api.tcgdex.net/v2/en/cards/${tcgdexSetId}-${p.card.number}`
    );
    await sleep(DELAY_MS);
    if (!card && /^\d{1,2}$/.test(p.card.number)) {
      card = await fetchJson<{ pricing?: TcgdexPricing }>(
        `https://api.tcgdex.net/v2/en/cards/${tcgdexSetId}-${p.card.number.padStart(3, "0")}`
      );
      await sleep(DELAY_MS);
    }
    if (!card) {
      noCard++;
      continue;
    }

    const priceOre = priceOreFromPricing(card.pricing);
    if (priceOre == null) {
      noPrice++;
      continue;
    }

    await prisma.priceObservation.create({
      data: {
        productId: p.id,
        sourceId: source.id,
        price: priceOre,
        currency: "SEK",
        condition: "NEAR_MINT",
        rawData: { tcgdexId: `${tcgdexSetId}-${p.card.number}`, pricing: card.pricing ?? null } as Prisma.InputJsonValue,
      },
    });
    await prisma.offer.update({
      where: { id: p.offers[0].id },
      data: { price: priceOre, stockStatus: "IN_STOCK", shippingPrice: 4500 },
    });
    priced++;
    if (priced % 50 === 0) console.log(`   ${priced} prissatta...`);
  }

  console.log("🎉 Klart!");
  console.log(`   Prissatta:            ${priced}`);
  console.log(`   Set saknas i TCGdex:  ${noTcgdexSet}`);
  console.log(`   Kort saknas:          ${noCard}`);
  console.log(`   Pris saknas:          ${noPrice}`);
}

main()
  .catch((e) => {
    console.error("Misslyckades:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
