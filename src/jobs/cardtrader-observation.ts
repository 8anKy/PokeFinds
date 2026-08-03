/**
 * EN DAGLIG PRISPUNKT PER CARDTRADER-PRODUKT.
 *
 * ⛔ UTAN DEN HÄR FÅR VARIANTERNA ALDRIG NÅGON GRAF. De tre CardTrader-importerna
 * (reverse holo, Master/Poké Ball, 1st Edition) skrev bara `Offer` — och en offer
 * är ett NULÄGE, inte en historik. Grafen ritas ur `PriceObservation`, så de
 * 8 700+ produkterna hade stått med tom prishistorik för alltid, trots att jobbet
 * körde varje dygn. "Historiken byggs framåt" är sant bara om någon skriver punkter.
 *
 * Formen är EXAKT Cardmarkets: en observation per körning, och
 * `bucketObservationsBySource` tar dagens SISTA. Två körningar samma dygn ger
 * alltså en punkt, inte två — ingen dedup-fråga behövs (den hade kostat en
 * SELECT per produkt och per dygn).
 */
import { prisma } from "../lib/db";
import { CARDTRADER_SOURCE_NAME } from "../services/products";

/** ScrapeSource-raden för CardTrader, skapad vid behov. Memoiserad per process. */
let sourceIdPromise: Promise<string> | null = null;
export function cardTraderSourceId(): Promise<string> {
  sourceIdPromise ??= prisma.scrapeSource
    .upsert({
      where: { name: CARDTRADER_SOURCE_NAME },
      update: {},
      create: {
        name: CARDTRADER_SOURCE_NAME,
        baseUrl: "https://www.cardtrader.com",
        // Ingen HTML-skrapa: jobben pratar med CardTraders API. Raden finns bara
        // för att `PriceObservation.sourceId` ska kunna peka på en namngiven källa.
        isActive: false,
      },
      select: { id: true },
    })
    .then((s) => s.id);
  return sourceIdPromise;
}

/**
 * Skriver dagens punkt för en produkt. `condition` speglar offern (NEAR_MINT):
 * serien ska beskriva samma vara som priset i tabellen.
 */
export async function recordCardTraderObservation(
  productId: string,
  priceOre: number,
  sourceId: string
): Promise<void> {
  await prisma.priceObservation.create({
    data: {
      productId,
      sourceId,
      price: priceOre,
      currency: "SEK",
      condition: "NEAR_MINT",
    },
  });
}
