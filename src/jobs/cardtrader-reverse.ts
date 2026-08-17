/**
 * REVERSE HOLO SOM EGNA KATALOGPOSTER, PRISSATTA AV CARDTRADER.
 *
 * En reverse holo är en annan vara än det ordinarie kortet — mätt i Paldea
 * Evolved: Primeape normal 0,11 € mot reverse 0,27 €, och i äldre set skiljer
 * det tvåsiffrigt (Legendary Collection: reverse-median 1 974 kr). Katalogen
 * hade EN post per kort, så en samlare kunde varken se eller äga rätt vara.
 *
 * ⛔ DETTA PRIS ÄR INTE CARDMARKETS. CardTrader är en EGEN marknadsplats och
 * blir en EGEN `Offer` med EGEN länk som konkurrerar i billigast-vinner precis
 * som Tradera och butikerna. Det får ALDRIG blandas in i `lowest_near_mint`
 * eller publiceras under den rubriken — se "GOLVET RAKT AV" i CLAUDE.md.
 *
 * TVÅ OBEROENDE GRINDAR, i den här ordningen, för att en produkt ska SKAPAS:
 *  1. **CardTrader har ett publicerbart golv** (`judgeReversePrice`): minst två
 *     NM-engelska reverse-annonser, och golvet högst `CT_MAX_REVERSE_RATIO` ×
 *     kortets ordinarie golv. Vakten är mätt mot facit — se dess egen doc.
 *  2. **TCGdex säger att varianten FINNS** (`variants.reverse === true`).
 *     MÄTT över 724 kort: TCGdex och CardTraders egen taxonomi är ense i
 *     99,59 %, och TCGdex säger ALDRIG reverse där CardTrader inte gör det. De
 *     tre oenigheterna är CardTrader som ÖVERDRIVER (Silver Tempests Seal
 *     Stones — secret rares utan reverse-tryckning), och två av dem hade
 *     faktiska annonser. Utan grinden blir de fantomprodukter.
 *
 * TCGdex-grinden är GRATIS I LÄNGDEN: den frågas bara för kort som ännu SAKNAR
 * reverse-produkt. Produktens existens ÄR cachen, så körning två frågar bara om
 * det handfull kort som föll ifjol.
 *
 * ⛔ LÄNKEN ÄR OFILTRERAD MED FLIT. CardTrader minns filtren i SESSIONEN, inte i
 * URL:en — MÄTT 2026-08-03: en förfrågan med `language=it` i query-strängen
 * landade på en sida där `en` fortfarande var ikryssat och `it` inte, och en
 * HELT parameterlös URL visade ändå NM+en+reverse från förra klicket. Exakt
 * samma fälla som Cardmarkets `isFirstEd` ([[project_cm_firsted_filter_is_sticky]]).
 * Att lägga på filterparametrar hade alltså sett rätt ut i koden och INTE
 * fungerat. Rubriken namnger därför källan (`lowestOfferSource`) i stället för
 * att låtsas att den länkade sidan är förfiltrerad.
 */
import { PrismaClient } from "@prisma/client";
import {
  CT_REVERSE_LABEL,
  blueprintAllowsReverse,
  ctBlueprints,
  ctBlueprintUrl,
  ctExpansions,
  ctMarketplace,
  ctNumberKey,
  isSingleBlueprint,
  judgeReversePrice,
  cheapestNonReverseNmEn,
  isPlausibleBaseFloor,
  matchExpansion,
  shouldDistrustDexTaxonomy,
  type CtBlueprint,
} from "@/lib/cardtrader";
import { getRatesOre } from "@/lib/exchange-rate";
import { createObservationWriter } from "./cardtrader-observation";
import { normalizeTitle } from "@/lib/utils";

const prisma = new PrismaClient();

const RETAILER_NAME = "CardTrader";
const RETAILER_URL = "https://www.cardtrader.com";

const slugify = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

export interface ReverseImportResult {
  setsMatched: number;
  setsUnmatched: number;
  cardsConsidered: number;
  noBlueprint: number;
  rejectedThin: number;
  rejectedImplausible: number;
  /**
   * Kort där CardTrader inte hade EN ENDA publicerbar reverse-annons.
   *
   * ⛔ RÄKNADES INTE ALLS FÖRE 2026-08-16 — grenen var ett tyst `continue`. Det
   * gjorde den viktigaste frågan om katalogens luckor omätbar: av de ~6 300 kort
   * som saknar reverse holo-produkt gick det inte att skilja "marknaden har
   * ingen" (datagräns, inget att göra åt) från "våra vakter fällde den" (bugg).
   * Utan den skillnaden går det inte att avgöra om prislösa reverse-produkter
   * ska skapas — och det är ett ägarbeslut som kräver en siffra, inte en känsla.
   */
  noReverseMarket: number;
  gateRejected: number;
  gateUnknown: number;
  productsCreated: number;
  offersUpserted: number;
  /** Set där TCGdex-datat bedömdes ofyllt och CardTraders taxonomi fick gälla. */
  dexDistrustedSets: number;
  /** Grafpunkter skrivna för ORDINARIE kort (ingen offer, bara historik). */
  baseObservations: number;
  /** CardTrader-offers på ordinarie kort (raden + länken i pristabellen). */
  baseOffers: number;
  /** Golv som låg orimligt långt under vårt publicerade pris — ej publicerade. */
  baseImplausible: number;
}

interface DexCard {
  id: string;
  localId: string;
  variants?: { reverse?: boolean };
}

/**
 * ⛔ VÅRT `tcgExternalId` ÄR INTE TCGdex ID. pokemontcg.io skriver `sv2-1`,
 * TCGdex `sv02-001` — både setkoden och kortnumret är nollutfyllda på olika sätt.
 * MÄTT: en rak `/cards/{tcgExternalId}`-slagning gav **404 på varenda kort**, och
 * eftersom "kunde inte svara" tolkas konservativt (ingen produkt) blev utfallet
 * noll skapade produkter — tyst, utan ett enda felmeddelande.
 *
 * Setet slås därför upp på NAMN (samma väg som scripts/fix-card-images.ts), och
 * korten inom setet på normaliserat `localId`.
 */
const dexNorm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

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

/** localId (normaliserat) → TCGdex kort-id, för ett helt set i ETT anrop. */
async function dexCardIndex(dexSetId: string): Promise<Map<string, string>> {
  const idx = new Map<string, string>();
  try {
    const set = (await (await fetch(`https://api.tcgdex.net/v2/en/sets/${dexSetId}`)).json()) as {
      cards?: DexCard[];
    };
    for (const c of set.cards ?? []) {
      const k = ctNumberKey(c.localId);
      if (k && !idx.has(k)) idx.set(k, c.id);
    }
  } catch {
    /* tomt index = grinden kan inte svara = ingen produkt */
  }
  return idx;
}

/**
 * Setets TCGdex-taxonomi i ETT anrop: hur många kort finns, och hur många bär
 * `variants.reverse`?
 *
 * Endpointen tar id-wildcard (`?id=ex7-*`) och svarar med korta poster — det är
 * skillnaden mot att fråga per kort, som hade kostat ett anrop per rad bara för
 * att avgöra OM taxonomin går att lita på. Verifierat att filtret verkligen
 * filtrerar (sv02: 279 kort, 176 reverse) så en nolla betyder nolla och inte
 * "frågan förstods inte".
 *
 * Fel/okänt set → `null`, som anroparen tolkar konservativt.
 */
async function dexSetTaxonomy(
  dexSetId: string
): Promise<{ cards: number; reverse: number } | null> {
  try {
    const [all, rev] = await Promise.all([
      fetch(`https://api.tcgdex.net/v2/en/cards?id=${dexSetId}-*`),
      fetch(`https://api.tcgdex.net/v2/en/cards?variants.reverse=true&id=${dexSetId}-*`),
    ]);
    if (!all.ok || !rev.ok) return null;
    const [a, r] = (await Promise.all([all.json(), rev.json()])) as [unknown[], unknown[]];
    if (!Array.isArray(a) || !Array.isArray(r)) return null;
    return { cards: a.length, reverse: r.length };
  } catch {
    return null;
  }
}

/**
 * Säger TCGdex att kortet har en reverse holo?
 * `null` = vet inte (nätfel/okänt kort) — och OKÄNT ÄR INTE JA. Ett kort vi inte
 * kan bekräfta får ingen produkt; hellre en lucka än en fantomvara.
 */
async function tcgdexHasReverse(dexCardId: string): Promise<boolean | null> {
  try {
    const res = await fetch(`https://api.tcgdex.net/v2/en/cards/${dexCardId}`);
    if (!res.ok) return null;
    const card = (await res.json()) as DexCard;
    if (!card?.variants) return null;
    return card.variants.reverse === true;
  } catch {
    return null;
  }
}

export async function runCardTraderReverseImport(opts: {
  apply: boolean;
  setLimit?: number;
  gapMs?: number;
}): Promise<ReverseImportResult> {
  const { apply, setLimit, gapMs = 700 } = opts;
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const { eurToOre } = await getRatesOre();
  /** Vårt SEK-öre → eurocent, för vaktens reservreferens. */
  const oreToEurCents = (ore: number) => Math.round((ore * 100) / eurToOre);

  const res: ReverseImportResult = {
    setsMatched: 0,
    setsUnmatched: 0,
    cardsConsidered: 0,
    noBlueprint: 0,
    rejectedThin: 0,
    rejectedImplausible: 0,
    noReverseMarket: 0,
    gateRejected: 0,
    gateUnknown: 0,
    productsCreated: 0,
    offersUpserted: 0,
    dexDistrustedSets: 0,
    baseObservations: 0,
    baseOffers: 0,
    baseImplausible: 0,
  };

  const retailer = apply
    ? await prisma.retailer.upsert({
        where: { name: RETAILER_NAME },
        update: {},
        create: {
          name: RETAILER_NAME,
          websiteUrl: RETAILER_URL,
          country: "IT",
          sourceType: "API",
        },
        select: { id: true },
      })
    : await prisma.retailer.findUnique({ where: { name: RETAILER_NAME }, select: { id: true } });

  // EN skrivare per körning: den förladdar senaste punkten per produkt i EN
  // fråga, i stället för en SELECT per produkt.
  const obs = await createObservationWriter(apply);

  // ⛔ STALASTE SETET FÖRST — ALDRIG EN FAST ORDNING.
  //
  // Ordningen var `releaseDate: "desc"` (nyast först). Med jobbets 60-minuterstak
  // och en full genomgång på ~2,5 h betyder en FAST ordning att samma första ~40 %
  // betas av varje natt och att svansen ALDRIG nås. MÄTT 2026-08-17 efter första
  // körningen på 13 dygn: 10 299 offers färska, 16 166 kvar på `lastSeenAt`
  // 2026-08-03 — och de kvarvarande är just de äldre seten (EX-eran, e-Card), dvs
  // exakt de med sämst reverse holo-täckning. En fast ordning gör inte jobbet
  // långsamt, den gör en del av katalogen PERMANENT ouppdaterad.
  //
  // Sorteringen på hur gammal setets äldsta CardTrader-offer är gör körningen
  // självläkande: varje natt fortsätter den där gårdagen kapades, och när
  // eftersläpningen är ikapp blir ordningen i praktiken rundgång. Samma grepp som
  // `verify-instock-buyable` använder med sin skärva per dygn.
  //
  // Set UTAN CardTrader-offers (aldrig importerade) sorteras FÖRST — de har mest
  // att hämta, och `NULLS FIRST` säger det uttryckligen i stället för att förlita
  // sig på Postgres default.
  const [staleOrder, expansions] = await Promise.all([
    prisma.$queryRaw<{ id: string; name: string; series: string | null }[]>`
      SELECT s.id, s.name, s.series
      FROM "CardSet" s
      LEFT JOIN LATERAL (
        SELECT MIN(o."lastSeenAt") AS oldest
        FROM "Product" p
        JOIN "Offer" o ON o."productId" = p.id
        JOIN "Retailer" r ON r.id = o."retailerId"
        WHERE p."setId" = s.id AND r.name = ${RETAILER_NAME}
      ) ct ON TRUE
      ORDER BY ct.oldest ASC NULLS FIRST, s."releaseDate" DESC NULLS LAST`,
    ctExpansions(),
  ]);
  const sets = staleOrder;

  const targets = sets
    .map((s) => ({ set: s, exp: matchExpansion(s.name, s.series, expansions) }))
    .filter((t): t is { set: (typeof sets)[number]; exp: NonNullable<typeof t.exp> } => {
      if (!t.exp) {
        res.setsUnmatched++;
        return false;
      }
      return true;
    })
    .slice(0, setLimit ?? undefined);

  for (const { set, exp } of targets) {
    let blueprints: CtBlueprint[];
    let market: Awaited<ReturnType<typeof ctMarketplace>>;
    try {
      blueprints = await ctBlueprints(exp.id);
      await sleep(gapMs);
      market = await ctMarketplace(exp.id);
      await sleep(gapMs);
    } catch (err) {
      console.warn(`[ct-reverse] ${set.name}: ${(err as Error).message.slice(0, 120)}`);
      continue;
    }
    res.setsMatched++;

    const bpByNum = new Map<string, CtBlueprint>();
    for (const b of blueprints) {
      if (!isSingleBlueprint(b)) continue;
      const k = ctNumberKey(b.fixed_properties.collector_number);
      if (k && !bpByNum.has(k)) bpByNum.set(k, b);
    }

    // Baskorten (variantLabel = null) OCH redan skapade reverse-produkter i EN
    // fråga per set — inte en fråga per kort.
    const products = await prisma.product.findMany({
      where: {
        category: "SINGLE_CARD",
        card: { setId: set.id },
        OR: [{ variantLabel: null }, { variantLabel: CT_REVERSE_LABEL }],
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
        lowestPriceOre: true,
        card: { select: { id: true, number: true, tcgExternalId: true } },
      },
    });

    /** Lat TCGdex-index för setet — byggs först när grind 2 faktiskt behövs. */
    let dexIndex: Map<string, string> | null = null;
    const before = {
      created: res.productsCreated,
      offers: res.offersUpserted,
      thin: res.rejectedThin,
      implausible: res.rejectedImplausible,
      gateNo: res.gateRejected,
    };
    // PER SET, inte löpande totaler: en logg som räknar upp globalt läser som om
    // varje set vore större än det förra.
    const logSet = () =>
      console.log(
        `[ct-reverse] ${set.name.padEnd(30).slice(0, 30)} nya ${String(res.productsCreated - before.created).padStart(4)} · offers ${String(res.offersUpserted - before.offers).padStart(4)} · tunt ${res.rejectedThin - before.thin} · orimligt ${res.rejectedImplausible - before.implausible} · TCGdex nej ${res.gateRejected - before.gateNo}`
      );

    const baseByCard = new Map<string, (typeof products)[number]>();
    const reverseByCard = new Map<string, (typeof products)[number]>();
    for (const p of products) {
      if (!p.cardId) continue;
      if (p.variantLabel === CT_REVERSE_LABEL) reverseByCard.set(p.cardId, p);
      else if (!baseByCard.has(p.cardId)) baseByCard.set(p.cardId, p);
    }

    // ---- PASS A: vilka kort har ett publicerbart golv? (ingen nättrafik) ----
    interface Candidate {
      cardId: string;
      base: (typeof products)[number];
      priceOre: number;
      url: string;
      bp: CtBlueprint;
      numKey: string;
    }
    const candidates: Candidate[] = [];
    for (const [cardId, base] of baseByCard) {
      const card = base.card;
      if (!card) continue;
      res.cardsConsidered++;

      const numKey = ctNumberKey(card.number);
      const bp = numKey ? bpByNum.get(numKey) : undefined;
      if (!bp || !numKey) {
        res.noBlueprint++;
        continue;
      }
      // ── GRAFPUNKT FÖR DET ORDINARIE KORTET ────────────────────────────────
      // CardTraders golv för den ICKE-reverse tryckningen räknades redan ut här
      // (det är `judgeReversePrice`:s referens) och kastades bort. Samma tal ger
      // en CardTrader-linje i prisgrafen för vanliga kort — 97 % av dem har djup
      // ≥2 (mätt över 11 set, 1 961 av 2 019). Det skapar INGEN offer: rubriken
      // och det publicerade priset ägs fortfarande av Cardmarket
      // ([[project_singles_raw_floor_policy]]), det här är bara historik.
      // Vakten jämför mot vårt PUBLICERADE pris: CardTrader är den dyrare
      // marknadsplatsen (median 3,67× över), så ett golv långt UNDER är en
      // felmatchning, inte ett fynd. Se `isPlausibleBaseFloor`.
      const ordinary = cheapestNonReverseNmEn(market[String(bp.id)]);
      if (ordinary != null) {
        if (isPlausibleBaseFloor(ordinary, base.lowestPriceOre ? oreToEurCents(base.lowestPriceOre) : null)) {
          const basePriceOre = Math.round((ordinary / 100) * eurToOre);
          await obs.record(base.id, basePriceOre);
          res.baseObservations++;
          // EGEN offer med EGEN länk, precis som Tradera och butikerna — det är
          // den som ger raden i pristabellen och knappen till CardTrader.
          if (apply && retailer) {
            await prisma.offer.upsert({
              where: {
                productId_retailerId_condition_language: {
                  productId: base.id,
                  retailerId: retailer.id,
                  condition: "NEAR_MINT",
                  language: "EN",
                },
              },
              update: {
                price: basePriceOre,
                currency: "SEK",
                stockStatus: "IN_STOCK",
                url: ctBlueprintUrl(bp.id),
                lastSeenAt: new Date(),
              },
              create: {
                productId: base.id,
                retailerId: retailer.id,
                condition: "NEAR_MINT",
                language: "EN",
                price: basePriceOre,
                currency: "SEK",
                stockStatus: "IN_STOCK",
                url: ctBlueprintUrl(bp.id),
              },
            });
            res.baseOffers++;
          }
        } else {
          res.baseImplausible++;
        }
      }

      const verdict = judgeReversePrice(market[String(bp.id)], {
        fallbackReferenceCents: base.lowestPriceOre ? oreToEurCents(base.lowestPriceOre) : null,
      });
      if (!verdict.price) {
        if (verdict.reason === "thin") res.rejectedThin++;
        else if (verdict.reason === "implausible") res.rejectedImplausible++;
        // "none" UTAN pris = noll publicerbara reverse-annonser. Räknas, aldrig
        // tyst. (Samma `reason` bär OCKSÅ det lyckade utfallet — när ingen
        // referens finns hoppas kvotvakten över — därför står räknaren innanför
        // `!verdict.price`.)
        else res.noReverseMarket++;
        continue;
      }
      candidates.push({
        cardId,
        base,
        priceOre: Math.round((verdict.price.cents / 100) * eurToOre),
        url: ctBlueprintUrl(bp.id),
        bp,
        numKey,
      });
    }
    if (candidates.length === 0) {
      logSet();
      continue;
    }

    // ---- PASS B: TCGdex-grinden, och en TRUST-KOLL PÅ SETNIVÅ ----
    //
    // ⛔ "TCGdex SÄGER NEJ" OCH "TCGdex HAR INTE FYLLT I SETET" SER LIKADANA UT.
    // MÄTT 2026-08-03: Chaos Rising (me04) har `reverse: false` på VARENDA kort,
    // medan grannseten Perfect Order (me03) och Pitch Black (me05) har `true` på
    // de flesta. Chaos Rising är ett modernt huvudset — det HAR reverse holos, och
    // CardTrader har 76 kort med riktiga NM-engelska reverse-annonser. Datat är
    // alltså ofyllt, inte negativt, och grinden hade tyst tappat ett helt set.
    //
    // Diskriminatorn är setnivå, inte kortnivå: säger TCGdex JA om minst ett kort
    // är setet ifyllt och ett nej betyder nej. Säger TCGdex nej om ALLA kandidater
    // (och de är fler än en handfull) är datat inte trovärdigt för det setet — då
    // faller vi tillbaka på CardTraders EGEN taxonomi, som är en mätt säker
    // superset (TCGdex sa aldrig reverse där CardTrader inte gjorde det).
    const dexSetId = await dexSetIdByName(set.name);
    // Setets taxonomi FÖRST, och på hela setet: den avgör om det ens är
    // meningsfullt att fråga per kort. Ett set utan TCGdex-motsvarighet
    // (HS—Unleashed heter "Unleashed" hos dem) har ingen taxonomi alls, vilket
    // är samma sorts icke-svar som ett ofyllt set — och ska behandlas likadant,
    // inte tystare.
    const taxonomy = dexSetId ? await dexSetTaxonomy(dexSetId) : null;
    const dexUnfilled = taxonomy
      ? shouldDistrustDexTaxonomy(taxonomy.reverse, taxonomy.cards)
      : true;
    if (dexUnfilled) {
      console.warn(
        `[ct-reverse] ${set.name}: TCGdex ${
          taxonomy
            ? `har 0 av ${taxonomy.cards} kort med reverse=true`
            : "har ingen motsvarighet till setet"
        } — taxonomin behandlas som OANVÄNDBAR, CardTraders egen får gälla.`
      );
      res.dexDistrustedSets++;
    }

    dexIndex = dexSetId && !dexUnfilled ? await dexCardIndex(dexSetId) : new Map();

    const gateVerdicts = new Map<string, boolean | null>();
    if (!dexUnfilled) {
      for (const c of candidates) {
        if (reverseByCard.has(c.cardId)) continue; // produkten finns → ingen grind
        const dexCardId = dexIndex.get(c.numKey);
        gateVerdicts.set(c.cardId, dexCardId ? await tcgdexHasReverse(dexCardId) : null);
      }
    }

    for (const c of candidates) {
      const { base, cardId, priceOre, url } = c;
      let product = reverseByCard.get(cardId);

      if (!product) {
        const dex = gateVerdicts.get(cardId) ?? null;
        const allowed = dexUnfilled ? blueprintAllowsReverse(c.bp) : dex === true;
        if (!allowed) {
          if (dex === null && !dexUnfilled) res.gateUnknown++;
          else res.gateRejected++;
          continue;
        }

        const title = `${base.title} · ${CT_REVERSE_LABEL}`;
        const slug = `${base.slug}-${slugify(CT_REVERSE_LABEL)}`;
        res.productsCreated++;
        // Torrkörningen ska rapportera HELA avsikten — även offern som skulle
        // följt med produkten. Ett `continue` här gjorde att torrkörningen sa
        // "0 offers" om ett bygge som skriver en offer per ny produkt.
        if (!apply) {
          res.offersUpserted++;
          continue;
        }

        const existing = await prisma.product.findUnique({ where: { slug }, select: { id: true } });
        product = existing
          ? ({ ...base, id: existing.id } as (typeof products)[number])
          : ((await prisma.product.create({
              data: {
                title,
                normalizedTitle: normalizeTitle(title),
                slug,
                category: "SINGLE_CARD",
                variantLabel: CT_REVERSE_LABEL,
                cardId: base.cardId,
                setId: base.setId,
                imageUrl: base.imageUrl,
                description: base.description,
                releaseDate: base.releaseDate,
                language: base.language,
              },
              select: { id: true },
            })) as unknown as (typeof products)[number]);
        reverseByCard.set(cardId, product);
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
        update: { price: priceOre, currency: "SEK", stockStatus: "IN_STOCK", url, lastSeenAt: new Date() },
        create: {
          productId: product.id,
          retailerId: retailer.id,
          condition: "NEAR_MINT",
          language: "EN",
          price: priceOre,
          currency: "SEK",
          stockStatus: "IN_STOCK",
          url,
        },
      });
      // Grafpunkt — skrivs bara när priset ändrats eller hjärtslaget löpt ut.
      await obs.record(product.id, priceOre);
    }

    logSet();
  }

  return res;
}
