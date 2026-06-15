/**
 * Kör ett insamlingsjobb för en källa: hämtar produkter via adapter,
 * matchar mot katalogen, uppdaterar erbjudanden, skapar prisobservationer
 * (rådata separat i rawData), dagliga prissnapshots, restock-händelser
 * och triggar alerts.
 *
 * Säkerhetsregler: jobbet avbryts automatiskt om felräknaren passerar 20.
 */
import { JobStatus, SourceType, StockStatus, type Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { MockAdapter } from "@/scrapers/adapters/mock-adapter";
import { PokemonTcgAdapter } from "@/scrapers/adapters/pokemontcg-adapter";
import { SpelexpertenAdapter } from "@/scrapers/adapters/spelexperten-adapter";
import { WebhallenAdapter } from "@/scrapers/adapters/webhallen-adapter";
import { DragonsLairAdapter } from "@/scrapers/adapters/dragonslair-adapter";
import { AlphaspelAdapter } from "@/scrapers/adapters/alphaspel-adapter";
import { TraderaAdapter } from "@/scrapers/adapters/tradera-adapter";
import { CardmarketPriceGuideAdapter } from "@/scrapers/adapters/cardmarket-adapter";
import {
  SpeltrolletAdapter,
  SamlarhobbyAdapter,
  GoblinenAdapter,
} from "@/scrapers/adapters/shopify-adapter";
import {
  SwepokeAdapter,
  ShinycardsAdapter,
} from "@/scrapers/adapters/quickbutik-adapter";
import { MaxGamingAdapter } from "@/scrapers/adapters/maxgaming-adapter";
import { isPlausibleListingPrice, matchProduct } from "@/scrapers/matching";
import { isCardmarketRedirect, isEnglishCardmarketUrl } from "@/lib/marketplace-urls";
import type { SourceAdapter } from "@/scrapers/types";
import { checkPriceAlerts, checkRestockAlerts } from "@/services/alerts";
import { CARDMARKET_SOURCE_NAMES } from "@/services/products";

const MAX_ERRORS = 20;

/** Namn → adapter-klass för SCRAPER-typ-källor. */
const SCRAPER_ADAPTERS: Record<string, new () => SourceAdapter> = {
  Spelexperten: SpelexpertenAdapter,
  Webhallen: WebhallenAdapter,
  "Dragon's Lair": DragonsLairAdapter,
  Alphaspel: AlphaspelAdapter,
  Tradera: TraderaAdapter,
  // Shopify-butiker (återanvändbar ShopifyAdapter)
  Speltrollet: SpeltrolletAdapter,
  Samlarhobby: SamlarhobbyAdapter,
  Goblinen: GoblinenAdapter,
  // Quickbutik-butiker (återanvändbar QuickbutikAdapter)
  Swepoke: SwepokeAdapter,
  Shinycards: ShinycardsAdapter,
  // Custom-plattform (server-renderad PT_-markup)
  MaxGaming: MaxGamingAdapter,
};

function getAdapter(type: SourceType, sourceName?: string): SourceAdapter {
  switch (type) {
    case SourceType.MOCK:
      return new MockAdapter();
    case SourceType.API:
      // "Cardmarket" = officiella prisguiden (sealed); övriga API-källor = Pokémon TCG API
      if (sourceName === "Cardmarket") return new CardmarketPriceGuideAdapter();
      return new PokemonTcgAdapter();
    case SourceType.SCRAPER: {
      const AdapterClass = sourceName ? SCRAPER_ADAPTERS[sourceName] : undefined;
      if (!AdapterClass) {
        throw new Error(`Ingen scraper-adapter för "${sourceName}". Tillgängliga: ${Object.keys(SCRAPER_ADAPTERS).join(", ")}`);
      }
      return new AdapterClass();
    }
    default:
      throw new Error(`Adapter ej implementerad för källtyp: ${type}`);
  }
}

export interface ScrapeJobSummary {
  jobId: string;
  status: JobStatus;
  itemsFound: number;
  itemsUpdated: number;
  errorCount: number;
}

/** Hitta eller skapa en Retailer som motsvarar källan. */
async function getRetailerForSource(sourceName: string, baseUrl: string, type: SourceType) {
  return prisma.retailer.upsert({
    where: { name: sourceName },
    update: {},
    create: { name: sourceName, websiteUrl: baseUrl, sourceType: type },
  });
}

export async function runScrapeJob(sourceId: string): Promise<ScrapeJobSummary> {
  const source = await prisma.scrapeSource.findUnique({ where: { id: sourceId } });
  if (!source) throw new Error(`Okänd källa: ${sourceId}`);

  const job = await prisma.scrapeJob.create({
    data: { sourceId, status: JobStatus.RUNNING, startedAt: new Date() },
  });

  const logs: string[] = [];
  let itemsFound = 0;
  let itemsUpdated = 0;
  let errorCount = 0;
  let aborted = false;

  try {
    const adapter = getAdapter(source.type, source.name);
    logs.push(`Startar insamling från "${source.name}" (${source.type})`);

    const result = await adapter.fetchProducts();
    itemsFound = result.products.length;
    errorCount += result.errors.length;
    for (const e of result.errors) logs.push(`Adapterfel: ${e}`);

    const retailer = await getRetailerForSource(source.name, source.baseUrl, source.type);
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    // Billigaste annonsen vinner: när flera annonser i samma körning matchar
    // samma produkt ska offerten visa den billigaste, inte den senast bearbetade.
    const bestPriceThisRun = new Map<string, number>();

    for (const rawProduct of result.products) {
      if (errorCount > MAX_ERRORS) {
        aborted = true;
        logs.push(`Avbryter: fler än ${MAX_ERRORS} fel.`);
        break;
      }
      try {
        if (!adapter.validateResult(rawProduct)) {
          errorCount++;
          logs.push(`Ogiltig produktdata: ${rawProduct.externalId}`);
          continue;
        }

        const normalized = adapter.normalizeProduct(rawProduct);
        const match = await matchProduct(normalized.normalizedTitle);
        if (!match) {
          logs.push(`Ingen produktmatchning: "${rawProduct.title}"`);
          continue;
        }
        const { productId } = match;

        // Erbjudandepriset (det vi VISAR) kan skilja sig från observationspriset:
        // för Cardmarket är offerPrice lägsta annonspris ("From") medan
        // normalized.price är trend-priset som prishistoriken/grafen bygger på.
        let offerPrice = normalized.offerPrice ?? normalized.price;

        // Marknadsplats-lots: Tradera-pris långt över CM-marknadspriset är
        // nästan alltid flera enheter i samma annons — skippa helt (även
        // observationen — priset avser inte EN enhet).
        if (
          source.name === "Tradera" &&
          !(await isPlausibleListingPrice(productId, normalized.price))
        ) {
          logs.push(`Orimligt pris vs marknadspris (trolig lot): "${rawProduct.title}" ${normalized.price} öre`);
          continue;
        }

        // Tidigare erbjudande (för pris-/lagerjämförelse)
        const previousOffer = await prisma.offer.findFirst({
          where: { productId, retailerId: retailer.id },
        });

        // Skick utifrån produktkategori: singlar är NEAR_MINT, övrigt SEALED
        const matchedProduct = await prisma.product.findUnique({
          where: { id: productId },
          select: { category: true },
        });

        // Singelkort får bara matcha skrapade singelkort och vice versa
        if (normalized.category && matchedProduct) {
          const isSingleRaw =
            normalized.category === "SINGLE_CARD" || normalized.category === "GRADED_CARD";
          const isSingleProduct =
            matchedProduct.category === "SINGLE_CARD" ||
            matchedProduct.category === "GRADED_CARD";
          if (isSingleRaw !== isSingleProduct) {
            logs.push(`Kategorimismatch (${normalized.category} ↔ ${matchedProduct.category}): "${rawProduct.title}"`);
            continue;
          }
        }
        const condition =
          previousOffer?.condition ??
          (matchedProduct?.category === "SINGLE_CARD" ||
          matchedProduct?.category === "GRADED_CARD"
            ? "NEAR_MINT"
            : "SEALED");
        const language = previousOffer?.language ?? "EN";

        // pokemontcg.io/TCGdex ger TREND-pris, inte en köpbar annons. För
        // singlar äger CardMarket-RapidAPI (engelska NM-lägsta "From") det
        // visade offer-priset — låt inte trend-källan skriva över ett redan
        // satt singel-pris; seeda bara när priset saknas. Observationen nedan
        // använder fortfarande normalized.price (trend) för grafen.
        const isTrendOnlySource =
          source.name === "Pokémon TCG API" || source.name === "TCGdex API";
        if (
          isTrendOnlySource &&
          matchedProduct?.category === "SINGLE_CARD" &&
          previousOffer?.price != null
        ) {
          offerPrice = previousOffer.price;
        }

        // Billigaste annonsen vinner — har en billigare annons redan skrivit
        // denna offer under körningen behåller vi den (observationen sparas ändå).
        const offerKey = `${productId}:${retailer.id}:${condition}:${language}`;
        const cheaper = bestPriceThisRun.get(offerKey);
        const skipOfferUpdate = cheaper !== undefined && cheaper <= offerPrice;

        if (!skipOfferUpdate) {
          bestPriceThisRun.set(offerKey, offerPrice);

          // Bevara en redan löst engelsk CM-slug: PokemonTcgAdapter emittar en
          // bar prices.pokemontcg.io-redirect som annars skulle skriva över den
          // (och tappa ?language=1) vid varje körning. Behåll den lösta slugen;
          // resolver-jobbet uppgraderar nya redirect-länkar separat.
          const urlToStore =
            isCardmarketRedirect(normalized.url) &&
            isEnglishCardmarketUrl(previousOffer?.url)
              ? (previousOffer!.url as string)
              : normalized.url;

          // Upserta erbjudandet
          await prisma.offer.upsert({
            where: {
              productId_retailerId_condition_language: {
                productId,
                retailerId: retailer.id,
                condition,
                language,
              },
            },
            update: {
              price: offerPrice,
              currency: normalized.currency,
              stockStatus: normalized.stockStatus,
              url: urlToStore,
              lastSeenAt: new Date(),
            },
            create: {
              productId,
              retailerId: retailer.id,
              condition,
              language,
              price: offerPrice,
              currency: normalized.currency,
              stockStatus: normalized.stockStatus,
              url: urlToStore,
            },
          });
          itemsUpdated++;

          // Lagerstatus-förändring → RestockEvent + restock-alerts
          const oldStatus = previousOffer?.stockStatus ?? StockStatus.UNKNOWN;
          if (oldStatus !== normalized.stockStatus) {
            await prisma.restockEvent.create({
              data: {
                productId,
                retailerId: retailer.id,
                oldStatus,
                newStatus: normalized.stockStatus,
                price: offerPrice,
              },
            });
            if (normalized.stockStatus === StockStatus.IN_STOCK) {
              await checkRestockAlerts(productId);
            }
            logs.push(
              `Lagerstatus ändrad för produkt ${productId}: ${oldStatus} → ${normalized.stockStatus}`
            );
          }
        }

        // Rå observation — rådata lagras separat från normaliserad data
        await prisma.priceObservation.create({
          data: {
            productId,
            sourceId: source.id,
            price: normalized.price,
            currency: normalized.currency,
            rawData: rawProduct.raw as Prisma.InputJsonValue,
          },
        });

        // Dagligt prissnapshot = marknadspris (endast Cardmarket-källor).
        // Butiks-/Tradera-observationer får ALDRIG blandas in — varierande
        // källsammansättning ger fejkade prisförändringar i trender/badges.
        const agg = await prisma.priceObservation.aggregate({
          where: {
            productId,
            observedAt: { gte: today },
            source: { name: { in: CARDMARKET_SOURCE_NAMES } },
          },
          _min: { price: true },
          _max: { price: true },
          _avg: { price: true },
          _count: { _all: true },
        });
        if (agg._count._all > 0 && agg._avg.price != null) {
          const snapshot = {
            minPrice: agg._min.price ?? Math.round(agg._avg.price),
            maxPrice: agg._max.price ?? Math.round(agg._avg.price),
            avgPrice: Math.round(agg._avg.price),
            volume: agg._count._all,
          };
          await prisma.priceSnapshot.upsert({
            where: { productId_date: { productId, date: today } },
            update: snapshot,
            create: { productId, date: today, ...snapshot },
          });
        }

        // Prisfall → kontrollera bevakningar med målpris (på det visade priset)
        if (previousOffer?.price != null && offerPrice < previousOffer.price) {
          await checkPriceAlerts(productId, offerPrice);
        }
      } catch (err) {
        errorCount++;
        const msg = err instanceof Error ? err.message : String(err);
        logs.push(`Fel vid bearbetning av ${rawProduct.externalId}: ${msg}`);
      }
    }

    const status = aborted ? JobStatus.FAILED : JobStatus.COMPLETED;
    await prisma.scrapeJob.update({
      where: { id: job.id },
      data: {
        status,
        finishedAt: new Date(),
        itemsFound,
        itemsUpdated,
        logs,
        errorMessage: aborted ? `Avbrutet: fler än ${MAX_ERRORS} fel.` : null,
      },
    });
    await prisma.scrapeSource.update({
      where: { id: source.id },
      data: { lastRunAt: new Date() },
    });

    return { jobId: job.id, status, itemsFound, itemsUpdated, errorCount };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logs.push(`Jobbet kraschade: ${msg}`);
    await prisma.scrapeJob.update({
      where: { id: job.id },
      data: {
        status: JobStatus.FAILED,
        finishedAt: new Date(),
        itemsFound,
        itemsUpdated,
        logs,
        errorMessage: msg,
      },
    });
    return {
      jobId: job.id,
      status: JobStatus.FAILED,
      itemsFound,
      itemsUpdated,
      errorCount: errorCount + 1,
    };
  }
}

/** Kör alla aktiva källor i sekvens. Returnerar sammanfattningar. */
export async function runAllActiveSources(): Promise<ScrapeJobSummary[]> {
  const sources = await prisma.scrapeSource.findMany({ where: { isActive: true } });
  const summaries: ScrapeJobSummary[] = [];
  for (const s of sources) {
    try {
      summaries.push(await runScrapeJob(s.id));
    } catch (err) {
      console.error(`[runner] Misslyckades köra källa ${s.name}:`, err);
    }
  }
  return summaries;
}
