/**
 * 1st EDITION i WOTC-seten som egna katalogposter.
 *
 * ⛔ DET HÄR OMKULLKASTAR ETT DOKUMENTERAT BESLUT — läs varför innan du rör det.
 * CLAUDE.md slog fast att de nio andra WOTC-seten "GÅR INTE att dela". Den
 * slutsatsen mättes mot **Cardmarket**, som har EN produkt per kort i de seten:
 * båda tryckningarna delar `idProduct`, så deras From blir samma tal (88 av 123
 * kort exakt identiska) och en uppdelning hade gett två katalogposter med samma
 * pris, dvs påhittad precision. Beslutets EGEN slutsats var att det krävs "en
 * källa som prissätter per tryckning".
 *
 * **CardTrader ÄR den källan.** `first_edition` sitter på ANNONSEN, inte på
 * produkten, så golvet går att räkna per tryckning. MÄTT 2026-08-03 (NM-engelska,
 * djup ≥2): Jungle 21 kort · Fossil 30 · Team Rocket 42 · Gym Heroes 56 · Gym
 * Challenge 74 · Neo Genesis 43 · Neo Discovery 27 · Neo Revelation 10 · Neo
 * Destiny 23. Medianpremien per set ligger på 1,1–5,4×.
 *
 * TVÅ OBEROENDE GRINDAR, båda mätta mot samma 15 set utan en enda avvikelse:
 *  1. **TCGdex `variants.firstEdition`** på SETNIVÅ — 62–132 kort i vart och ett
 *     av de nio seten, och **0** i Legendary Collection, Expedition, Prismatic
 *     Evolutions, Pitch Black och Paldea Evolved.
 *  2. **CardTraders eget djup** — ≥2 NM-engelska annonser med `first_edition`.
 *     Samma kontrollset gav 0 där också. Grinden behövs eftersom `first_edition`
 *     ligger bland `editable_properties` även i moderna set (Prismatic Evolutions
 *     har fältet), så egenskapens blotta existens bevisar ingenting.
 *
 * ⛔ PRODUKTERNA FÅR ALDRIG ETT CM-PRIS. Etiketten är `1st Edition`, dvs en
 * `PRINT_VARIANT_LABEL`, och cardmarket-refresh prissätter tryckningar ur feedens
 * `version`-rader. I de här seten är den raden den DELADE produktens golv — oftast
 * lägre än 1st Edition-golvet, alltså hade den vunnit rubriken och visat det
 * ordinarie kortets pris under en 1st Edition-produkt. Grinden sitter i
 * cardmarket-refresh: en tryckningsprodukt utan LÄNKAD `idProduct` routas inte dit.
 * Base påverkas inte — alla dess 303 tryckningsprodukter har en länk.
 */
import { prisma } from "../lib/db";
import { getRatesOre } from "../lib/exchange-rate";
import { cardTraderSourceId, recordCardTraderObservation } from "./cardtrader-observation";
import { normalizeTitle } from "@/lib/utils";
import { PRINT_FIRST_EDITION } from "../lib/print-variant";
import {
  CT_MAX_REVERSE_RATIO,
  CT_MIN_DEPTH,
  ctBlueprintUrl,
  ctBlueprints,
  ctExpansions,
  ctMarketplace,
  ctNumberKey,
  isBuyableNmEnListing,
  isSingleBlueprint,
  matchExpansion,
  type CtBlueprint,
} from "../lib/cardtrader";

const RETAILER_NAME = "CardTrader";
const RETAILER_URL = "https://www.cardtrader.com";

const dexNorm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

export interface FirstEditionImportResult {
  setsConsidered: number;
  setsGated: number;
  cardsConsidered: number;
  noBlueprint: number;
  rejectedThin: number;
  rejectedImplausible: number;
  productsCreated: number;
  offersUpserted: number;
  perSet: { name: string; priced: number; medianEur: number; maxEur: number }[];
}

const slugify = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

let dexSetsCache: Map<string, string> | null = null;
async function dexSetIdByName(setName: string): Promise<string | null> {
  if (!dexSetsCache) {
    try {
      const sets = (await (await fetch("https://api.tcgdex.net/v2/en/sets")).json()) as {
        id: string;
        name: string;
      }[];
      dexSetsCache = new Map(sets.map((s) => [dexNorm(s.name), s.id]));
    } catch {
      dexSetsCache = new Map();
    }
  }
  return dexSetsCache.get(dexNorm(setName)) ?? null;
}

/**
 * Säger TCGdex att setet över huvud taget HAR en 1st Edition-tryckning?
 * `null` = kunde inte svara, och OKÄNT ÄR INTE JA — ett set vi inte kan bekräfta
 * får inga produkter. Här är det extra billigt att vara försiktig: 1st Edition
 * upphörde 2002, så luckan är ändlig och känd.
 */
async function dexSetHasFirstEdition(dexSetId: string): Promise<number | null> {
  try {
    const r = await fetch(
      `https://api.tcgdex.net/v2/en/cards?variants.firstEdition=true&id=${dexSetId}-*`
    );
    if (!r.ok) return null;
    const j = (await r.json()) as unknown[];
    return Array.isArray(j) ? j.length : null;
  } catch {
    return null;
  }
}

export async function runCardTraderFirstEditionImport(opts: {
  apply: boolean;
  setLimit?: number;
  gapMs?: number;
}): Promise<FirstEditionImportResult> {
  const { apply, setLimit, gapMs = 700 } = opts;
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const { eurToOre } = await getRatesOre();

  const res: FirstEditionImportResult = {
    setsConsidered: 0,
    setsGated: 0,
    cardsConsidered: 0,
    noBlueprint: 0,
    rejectedThin: 0,
    rejectedImplausible: 0,
    productsCreated: 0,
    offersUpserted: 0,
    perSet: [],
  };

  const retailer = apply
    ? await prisma.retailer.upsert({
        where: { name: RETAILER_NAME },
        update: {},
        create: { name: RETAILER_NAME, websiteUrl: RETAILER_URL, country: "IT" },
        select: { id: true },
      })
    : null;

  const [sets, expansions] = await Promise.all([
    prisma.cardSet.findMany({
      orderBy: { releaseDate: { sort: "asc", nulls: "last" } },
      select: { id: true, name: true, series: true },
    }),
    ctExpansions(),
  ]);

  for (const set of sets.slice(0, setLimit ?? undefined)) {
    // GRIND 1 — hade setet en 1st Edition-tryckning över huvud taget?
    const dexSetId = await dexSetIdByName(set.name);
    if (!dexSetId) continue;
    const dexFe = await dexSetHasFirstEdition(dexSetId);
    if (dexFe == null || dexFe === 0) continue;
    res.setsConsidered++;

    const exp = matchExpansion(set.name, set.series, expansions);
    if (!exp) {
      console.warn(`[ct-1sted] ${set.name}: ingen CardTrader-expansion — hoppas över.`);
      continue;
    }

    let blueprints: CtBlueprint[];
    let market: Awaited<ReturnType<typeof ctMarketplace>>;
    try {
      blueprints = await ctBlueprints(exp.id);
      await sleep(gapMs);
      market = await ctMarketplace(exp.id);
      await sleep(gapMs);
    } catch (err) {
      console.warn(`[ct-1sted] ${set.name}: ${(err as Error).message.slice(0, 120)}`);
      continue;
    }

    const bpByNum = new Map<string, CtBlueprint>();
    for (const b of blueprints) {
      if (!isSingleBlueprint(b)) continue;
      const k = ctNumberKey(b.fixed_properties.collector_number);
      if (k && !bpByNum.has(k)) bpByNum.set(k, b);
    }

    const products = await prisma.product.findMany({
      where: {
        category: "SINGLE_CARD",
        card: { setId: set.id },
        OR: [{ variantLabel: null }, { variantLabel: PRINT_FIRST_EDITION }],
      },
      select: {
        id: true,
        slug: true,
        title: true,
        variantLabel: true,
        cardId: true,
        setId: true,
        imageUrl: true,
        description: true,
        releaseDate: true,
        language: true,
        card: { select: { number: true } },
      },
    });

    const baseByCard = new Map<string, (typeof products)[number]>();
    const feByCard = new Map<string, (typeof products)[number]>();
    for (const p of products) {
      if (!p.cardId) continue;
      if (p.variantLabel === PRINT_FIRST_EDITION) feByCard.set(p.cardId, p);
      else if (!baseByCard.has(p.cardId)) baseByCard.set(p.cardId, p);
    }
    // Base är redan uppdelat i tre tryckningar och har därför INGEN etikettlös
    // produkt — då finns inget att härleda en fjärde ur, och setet hoppas över
    // av sig självt. Loggas ändå så att en framtida läsare inte tror det är ett fel.
    if (baseByCard.size === 0) {
      console.log(`[ct-1sted] ${set.name}: redan uppdelat (ingen etikettlös produkt) — hoppas över.`);
      continue;
    }
    res.setsGated++;

    interface Candidate {
      cardId: string;
      base: (typeof products)[number];
      cents: number;
      url: string;
    }
    const candidates: Candidate[] = [];
    for (const [cardId, base] of baseByCard) {
      res.cardsConsidered++;
      const numKey = base.card ? ctNumberKey(base.card.number) : null;
      const bp = numKey ? bpByNum.get(numKey) : undefined;
      if (!bp) {
        res.noBlueprint++;
        continue;
      }
      const listings = (market[String(bp.id)] ?? []).filter(isBuyableNmEnListing);
      const fe = listings.filter((l) => l.properties_hash?.first_edition === true);
      // GRIND 2 — CardTraders eget djup. Egenskapens existens bevisar ingenting
      // (moderna set har fältet också); två oberoende säljare gör det.
      if (fe.length < CT_MIN_DEPTH) {
        res.rejectedThin++;
        continue;
      }
      const cents = Math.min(...fe.map((l) => l.price.cents));
      // Rimlighet mot kortets EGET ordinarie golv i samma expansion — samma
      // referens som reverse-importen, och här är den rätt: 1st Edition och
      // ordinarie är samma kort på samma marknad. Saknas ordinarie annonser
      // finns ingen referens, och då får djupkravet ensamt räcka.
      const ord = listings.filter((l) => l.properties_hash?.first_edition !== true);
      const reference = ord.length ? Math.min(...ord.map((l) => l.price.cents)) : null;
      if (reference != null && reference > 0 && cents > reference * CT_MAX_REVERSE_RATIO) {
        res.rejectedImplausible++;
        console.warn(
          `[ct-1sted] ${set.name}: ${base.title} 1st Ed ${(cents / 100).toFixed(2)} € är ${Math.round(cents / reference)}× det ordinarie golvet — hoppas över.`
        );
        continue;
      }
      candidates.push({ cardId, base, cents, url: ctBlueprintUrl(bp.id) });
    }

    res.perSet.push({
      name: set.name,
      priced: candidates.length,
      medianEur: median(candidates.map((c) => c.cents)) / 100,
      maxEur: candidates.length ? Math.max(...candidates.map((c) => c.cents)) / 100 : 0,
    });

    let created = 0;
    for (const c of candidates) {
      let product = feByCard.get(c.cardId);
      const priceOre = Math.round((c.cents / 100) * eurToOre);

      if (!product) {
        const title = `${c.base.title} · ${PRINT_FIRST_EDITION}`;
        const slug = `${c.base.slug}-${slugify(PRINT_FIRST_EDITION)}`;
        res.productsCreated++;
        created++;
        if (!apply) {
          res.offersUpserted++;
          continue;
        }
        const existing = await prisma.product.findUnique({ where: { slug }, select: { id: true } });
        product = existing
          ? ({ ...c.base, id: existing.id } as (typeof products)[number])
          : ((await prisma.product.create({
              data: {
                title,
                normalizedTitle: normalizeTitle(title),
                slug,
                category: "SINGLE_CARD",
                variantLabel: PRINT_FIRST_EDITION,
                cardId: c.base.cardId,
                setId: c.base.setId,
                imageUrl: c.base.imageUrl,
                description: c.base.description,
                releaseDate: c.base.releaseDate,
                language: c.base.language,
              },
              select: { id: true },
            })) as unknown as (typeof products)[number]);
        feByCard.set(c.cardId, product);
      }

      res.offersUpserted++;
      if (!apply || !retailer) continue;
      await prisma.offer.upsert({
        where: {
          productId_retailerId_condition_language: {
            productId: product.id,
            retailerId: retailer.id,
            condition: "NEAR_MINT",
            language: "EN",
          },
        },
        update: {
          price: priceOre,
          currency: "SEK",
          stockStatus: "IN_STOCK",
          url: c.url,
          lastSeenAt: new Date(),
        },
        create: {
          productId: product.id,
          retailerId: retailer.id,
          condition: "NEAR_MINT",
          language: "EN",
          price: priceOre,
          currency: "SEK",
          stockStatus: "IN_STOCK",
          url: c.url,
        },
      });
      // Dagens punkt till prisgrafen. Utan den är produkten historiklös för alltid.
      await recordCardTraderObservation(product.id, priceOre, await cardTraderSourceId());
    }

    console.log(
      `[ct-1sted] ${set.name.padEnd(24).slice(0, 24)} TCGdex ${String(dexFe).padStart(4)} kort · nya ${String(created).padStart(4)} · prissatta ${String(candidates.length).padStart(4)}`
    );
  }

  return res;
}
