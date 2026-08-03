/**
 * PRISPUNKTER FÖR CARDTRADER — skrivna VID ÄNDRING, inte varje dygn.
 *
 * ⛔ UTAN PUNKTER FINNS INGEN GRAF. De tre CardTrader-importerna skrev bara
 * `Offer`, och en offer är ett NULÄGE. Grafen ritas ur `PriceObservation`, så
 * produkterna hade stått historiklösa för alltid trots att jobbet kör varje dygn.
 *
 * ── VARFÖR VID ÄNDRING OCH INTE DAGLIGEN ────────────────────────────────────
 * MÄTT 2026-08-03: `PriceObservation` är redan störst i databasen — 462 MB över
 * 1 374 153 rader (~352 B/rad) i en databas på 948 MB. En daglig punkt för varje
 * ordinarie singel hade lagt till ~19 800 rader/dygn ≈ 209 MB/månad, dvs
 * fyrdubblat databasen på ett år för EN funktion. Mätt på Cardmarkets egna priser
 * ändras ett pris dag-till-dag i **40,8 %** av fallen (238 156 av 583 344
 * jämförelser på 30 dygn), så den här regeln skriver ~41 % av raderna.
 *
 * ⛔ ETT UTELÄMNAT SKRIV FÅR INTE SE UT SOM ETT MISSAT JOBB. Utan motvikt kan
 * "priset stod stilla" och "körningen kraschade" inte skiljas åt i efterhand —
 * exakt den hopblandning som `statusAfterVerify` finns för på restock-sidan.
 * Därför HJÄRTSLAGET: har produkten ingen punkt på `CT_MAX_GAP_DAYS` dygn skrivs
 * en ändå. Följden är att varje lucka i serien som är LÄNGRE än så bevisligen är
 * ett avbrott — och `fillForward` vägrar överbrygga just dem. De två talen är
 * SAMMA konstant med flit: glider de isär börjar grafen dikta över driftstopp.
 */
import { prisma } from "../lib/db";
import { CARDTRADER_SOURCE_NAME } from "../services/products";

/**
 * Max antal dygn mellan två punkter. Styr BÅDE hjärtslaget (skriv ändå) och
 * `fillForward` (överbrygga inte längre än så) — se resonemanget ovan.
 */
export const CT_MAX_GAP_DAYS = 7;

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

export interface ObservationStats {
  written: number;
  unchanged: number;
  heartbeat: number;
}

/**
 * Ren dom: ska produkten få en ny punkt?
 *
 * `last = null` (aldrig sett) → alltid. Annars bara om priset ändrats, eller om
 * hjärtslaget löpt ut. Utbruten och testad utan databas eftersom den avgör om en
 * lucka i grafen betyder "stilla" eller "trasigt".
 */
export function shouldRecord(
  last: { price: number; observedAt: Date } | null,
  priceOre: number,
  now: Date,
  maxGapDays = CT_MAX_GAP_DAYS
): "new" | "changed" | "heartbeat" | null {
  if (!last) return "new";
  if (last.price !== priceOre) return "changed";
  const ageDays = (now.getTime() - last.observedAt.getTime()) / 86_400_000;
  return ageDays >= maxGapDays ? "heartbeat" : null;
}

/**
 * Skrivare med FÖRLADDAT facit.
 *
 * ⛔ EN FRÅGA, INTE 20 000. Naiv "läs senaste punkten per produkt" hade blivit en
 * SELECT per produkt och körning — dyrare i Neon-compute än raderna vi sparar in.
 * `DISTINCT ON` hämtar senaste punkten för hela källan i ETT svep.
 */
/**
 * ⛔ `apply` HÖR HEMMA I SKRIVAREN, INTE HOS ANROPAREN. Grafpunkten för ORDINARIE
 * kort skrivs i importens PASS A, som körs även vid torrkörning (den räknar bara
 * fram kandidater). En gate på anropsstället hade alltså varit lätt att glömma —
 * och en torrkörning som skriver till produktionsdatabasen är precis den sortens
 * fälla som redan kostat pengar en gång ([[project_dedupe_catalog_cost_footgun]]).
 * Här failar den STÄNGT: utan `apply` räknas domen men ingen rad skrivs.
 */
export async function createObservationWriter(
  apply: boolean,
  now: Date = new Date()
): Promise<{
  record: (productId: string, priceOre: number) => Promise<void>;
  stats: ObservationStats;
}> {
  const sourceId = await cardTraderSourceId();
  const rows = await prisma.$queryRaw<{ productId: string; price: number; observedAt: Date }[]>`
    SELECT DISTINCT ON ("productId") "productId", price, "observedAt"
    FROM "PriceObservation"
    WHERE "sourceId" = ${sourceId}
    ORDER BY "productId", "observedAt" DESC`;
  const last = new Map(rows.map((r) => [r.productId, { price: r.price, observedAt: r.observedAt }]));

  const stats: ObservationStats = { written: 0, unchanged: 0, heartbeat: 0 };

  return {
    stats,
    async record(productId, priceOre) {
      const verdict = shouldRecord(last.get(productId) ?? null, priceOre, now);
      if (!verdict) {
        stats.unchanged++;
        return;
      }
      if (apply) {
        await prisma.priceObservation.create({
          data: { productId, sourceId, price: priceOre, currency: "SEK", condition: "NEAR_MINT" },
        });
      }
      // Uppdatera facit i minnet så en andra rad samma körning inte skrivs igen.
      last.set(productId, { price: priceOre, observedAt: now });
      stats.written++;
      if (verdict === "heartbeat") stats.heartbeat++;
    },
  };
}
