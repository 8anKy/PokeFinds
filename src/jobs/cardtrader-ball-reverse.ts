/**
 * MASTER BALL / POKÉ BALL REVERSE HOLO som egna katalogposter.
 *
 * De moderna specialsetens reverse holos finns i två mönster utöver den vanliga:
 * Master Ball och Poké Ball. De är andra varor — MÄTT 2026-08-03 ligger Umbreon ·
 * Prismatic Evolutions Master Ball på **80,64 €** (~930 kr) medan Poké
 * Ball-varianten av samma kort ligger på 5,99 €.
 *
 * ⛔ CARDTRADER MODELLERAR DEM SOM EGNA EXPANSIONER, INTE SOM EN EGENSKAP.
 * "Prismatic Evolutions - Master Ball Reverse Holo" är en expansion vid sidan av
 * "Prismatic Evolutions". Den vanliga reverse-importen mappar vårt set till EN
 * expansion och slutar där — de här korten var alltså osynliga för den, tyst.
 *
 * ⛔ RIMLIGHETSVAKTEN KAN INTE VARA REVERSE-IMPORTENS. Den dömer mot kortets
 * ORDINARIE golv med tak 50×, och det taket är fel här: en Master Ball-variant av
 * ett kort som kostar 0,22 kr ligger legitimt tusentals gånger över. Vakten dömer
 * i stället mot **expansionens EGEN median** — placeholder-annonserna (10 000,00 €
 * återkommande identiskt, se project_cardtrader_reverse_build) sticker ut med
 * hundratals gånger, medan en äkta chase-variant ligger inom ett tiotal.
 *
 * Grinden för att varianten FINNS är expansionen själv: CardTrader har skapat en
 * egen expansion för mönstret, och blueprinten bär kortets samlarnummer. Det är
 * ett starkare påstående än TCGdex-flaggan den vanliga importen behöver — därför
 * ingen TCGdex-koll här.
 */
import { prisma } from "../lib/db";
import { getRatesOre } from "../lib/exchange-rate";
import { createObservationWriter } from "./cardtrader-observation";
import { normalizeTitle } from "@/lib/utils";
import {
  CT_MIN_DEPTH,
  ctBlueprintUrl,
  ctBlueprints,
  ctExpansions,
  ctMarketplace,
  ctNumberKey,
  isBuyableNmListing,
  isSingleBlueprint,
  matchBallExpansions,
  matchJpBallExpansions,
  ctSetNameKey,
  type CtBlueprint,
} from "../lib/cardtrader";

const RETAILER_NAME = "CardTrader";
const RETAILER_URL = "https://www.cardtrader.com";

/**
 * Hur många gånger expansionens egen median ett golv får ligga innan det
 * behandlas som en placeholder-annons i stället för ett pris.
 *
 * Satt på MÄTNING, inte på magkänsla: i de sex engelska boll-expansionerna låg
 * det dyraste ÄKTA golvet (Umbreon Master Ball, 80,64 €) på ~7× sin expansions
 * median, och inget äkta golv nådde 20×. Placeholder-signaturen är 10 000,00 €,
 * vilket är 1000×+ i varje expansion. 100 lämnar alltså en tiofaldig marginal åt
 * det dyraste vi faktiskt sett, utan att släppa igenom skräpet.
 */
export const BALL_MAX_MEDIAN_RATIO = Number(process.env.CT_BALL_MAX_MEDIAN_RATIO ?? 100);

export interface BallImportResult {
  expansionsFound: number;
  cardsConsidered: number;
  noBlueprint: number;
  rejectedThin: number;
  rejectedImplausible: number;
  productsCreated: number;
  offersUpserted: number;
  /** Golv per expansion, för att kunna se fördelningen i en torrkörning. */
  perExpansion: { name: string; label: string; priced: number; medianEur: number; maxEur: number }[];
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

export async function runCardTraderBallImport(opts: {
  apply: boolean;
  setLimit?: number;
  gapMs?: number;
}): Promise<BallImportResult> {
  const { apply, setLimit, gapMs = 700 } = opts;
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const { eurToOre } = await getRatesOre();

  const res: BallImportResult = {
    expansionsFound: 0,
    cardsConsidered: 0,
    noBlueprint: 0,
    rejectedThin: 0,
    rejectedImplausible: 0,
    productsCreated: 0,
    offersUpserted: 0,
    perExpansion: [],
  };

  const retailer = apply
    ? await prisma.retailer.upsert({
        where: { name: RETAILER_NAME },
        update: {},
        create: { name: RETAILER_NAME, websiteUrl: RETAILER_URL, country: "IT" },
        select: { id: true },
      })
    : null;

  // EN skrivare per körning: den förladdar senaste punkten per produkt i EN
  // fråga, i stället för en SELECT per produkt.
  const obs = await createObservationWriter(apply);

  const [sets, expansions] = await Promise.all([
    prisma.cardSet.findMany({
      orderBy: { releaseDate: { sort: "desc", nulls: "last" } },
      select: { id: true, name: true, series: true, language: true },
    }),
    ctExpansions(),
  ]);

  // JAPANSKA SET SEDAN 2026-08-30: samma expansionstyp hos CT, men japanska
  // annonser och kodbärande namn — se matchJpBallExpansions. Offern skrivs med
  // setets språk så att JP-golv aldrig läses som engelska.
  const enSetKeys = new Set(sets.filter((s) => s.language !== "JP").map((s) => ctSetNameKey(s.name)));
  const targets = sets
    .flatMap((set) => {
      const isJp = set.language === "JP";
      const hits = isJp
        ? matchJpBallExpansions(set.name, expansions, enSetKeys)
        : matchBallExpansions(set.name, expansions);
      return hits.map((b) => ({ set, ...b, lang: isJp ? ("jp" as const) : ("en" as const) }));
    })
    .slice(0, setLimit ?? undefined);
  res.expansionsFound = targets.length;

  for (const { set, label, expansion, lang } of targets) {
    const offerLanguage = lang === "jp" ? ("JP" as const) : ("EN" as const);
    let blueprints: CtBlueprint[];
    let market: Awaited<ReturnType<typeof ctMarketplace>>;
    try {
      blueprints = await ctBlueprints(expansion.id);
      await sleep(gapMs);
      market = await ctMarketplace(expansion.id);
      await sleep(gapMs);
    } catch (err) {
      console.warn(`[ct-ball] ${expansion.name}: ${(err as Error).message.slice(0, 120)}`);
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
        OR: [{ variantLabel: null }, { variantLabel: label }],
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
    const ballByCard = new Map<string, (typeof products)[number]>();
    for (const p of products) {
      if (!p.cardId) continue;
      if (p.variantLabel === label) ballByCard.set(p.cardId, p);
      else if (!baseByCard.has(p.cardId)) baseByCard.set(p.cardId, p);
    }

    // ---- PASS A: golv per kort (ingen nättrafik, inga skrivningar) ----
    interface Candidate {
      cardId: string;
      base: (typeof products)[number];
      cents: number;
      depth: number;
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
      const listings = (market[String(bp.id)] ?? []).filter((l) => isBuyableNmListing(l, lang));
      if (listings.length < CT_MIN_DEPTH) {
        res.rejectedThin++;
        continue;
      }
      candidates.push({
        cardId,
        base,
        cents: Math.min(...listings.map((l) => l.price.cents)),
        depth: listings.length,
        url: ctBlueprintUrl(bp.id),
      });
    }

    // ---- PASS B: expansionens egen fördelning dömer utliggarna ----
    const med = median(candidates.map((c) => c.cents));
    const kept = candidates.filter((c) => {
      if (med > 0 && c.cents > med * BALL_MAX_MEDIAN_RATIO) {
        res.rejectedImplausible++;
        console.warn(
          `[ct-ball] ${expansion.name}: ${c.base.title} ${(c.cents / 100).toFixed(2)} € är ${Math.round(c.cents / med)}× medianen — hoppas över.`
        );
        return false;
      }
      return true;
    });
    res.perExpansion.push({
      name: expansion.name,
      label,
      priced: kept.length,
      medianEur: med / 100,
      maxEur: kept.length ? Math.max(...kept.map((c) => c.cents)) / 100 : 0,
    });

    let created = 0;
    for (const c of kept) {
      let product = ballByCard.get(c.cardId);
      const priceOre = Math.round((c.cents / 100) * eurToOre);

      if (!product) {
        const title = `${c.base.title} · ${label}`;
        const slug = `${c.base.slug}-${slugify(label)}`;
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
                variantLabel: label,
                cardId: c.base.cardId,
                setId: c.base.setId,
                imageUrl: c.base.imageUrl,
                description: c.base.description,
                releaseDate: c.base.releaseDate,
                language: c.base.language,
              },
              select: { id: true },
            })) as unknown as (typeof products)[number]);
        ballByCard.set(c.cardId, product);
      }

      res.offersUpserted++;
      if (!apply || !retailer) continue;
      await prisma.offer.upsert({
        where: {
          productId_retailerId_condition_language: {
            productId: product.id,
            retailerId: retailer.id,
            condition: "NEAR_MINT",
            language: offerLanguage,
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
          language: offerLanguage,
          price: priceOre,
          currency: "SEK",
          stockStatus: "IN_STOCK",
          url: c.url,
        },
      });
      // Grafpunkt — skrivs bara när priset ändrats eller hjärtslaget löpt ut.
      await obs.record(product.id, priceOre);
    }

    console.log(
      `[ct-ball] ${expansion.name.padEnd(48).slice(0, 48)} nya ${String(created).padStart(4)} · prissatta ${String(kept.length).padStart(4)} · tunt ${res.rejectedThin} · median ${(med / 100).toFixed(2)} €`
    );
  }

  return res;
}
