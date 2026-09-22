import { isDirectOfferUrl } from "@/lib/marketplace-urls";

/**
 * Retailer-namnet för den ÄKTA Cardmarket-källan. Samma sträng som
 * `CardmarketPriceGuideAdapter.name` och `ScrapeSource.name` — en källa som stavas
 * på två ställen stavas förr eller senare olika, och då byter värderingen tyst källa.
 */
export const CARDMARKET_RETAILER_NAME = "Cardmarket";

export interface ValuedOffer {
  /** öre — null/0 = länk-offer utan känt pris */
  price: number | null;
  stockStatus: string;
  url: string;
  retailer: { name: string };
}

export interface MarketValue {
  /** öre per styck, null = inget känt värde */
  price: number | null;
  /** true = talet kommer från Cardmarket, false = reservkällan (butik/marknadsplats) */
  fromCardmarket: boolean;
}

const NO_VALUE: MarketValue = { price: null, fromCardmarket: false };

/**
 * SAMLINGENS OCH SKANNERNS VÄRDE PER PRODUKT — **CARDMARKET FÖRST** (ägarbeslut
 * 2026-09-22), lägsta direkta offer bara som RESERV.
 *
 * ⛔ DET HÄR ÄR INTE PRODUKTSIDANS RUBRIKPRIS och får aldrig bli det. Rubriken
 * svarar på "vad kostar den billigast just nu" — där ÄR en Tradera-annons på 67 kr
 * svaret. Samlingsvärdet svarar på "vad är min samling värd", och där är samma
 * annons ett enskilt utrop, inte ett marknadsvärde.
 *
 * VARFÖR (mätt mot prod 2026-09-22, 3 002 samlingsposter / 2 351 med pris): värdet
 * togs förut av `computeLowestPrice` över ALLA källor, så 397 singlar värderades av
 * CardTrader och 243 av Tradera. På 380 produkter fanns en CM-offer som INTE var
 * lägst — Brock's Rhydon · Gym Heroes stod i 67 kr (Tradera) mot CM:s 327 kr, "Here
 * Comes Team Rocket!" i 59 kr mot 386 kr. Utfallet avgjordes alltså av VILKEN
 * marknadsplats som råkade vara billigast, inte av vad kortet är värt — exakt det
 * som `getCardValues` redan varnade för i reverse-holo-undantaget.
 *
 * Det förklarar också takten ägaren såg: värdet räknas live per request ur
 * `Offer`-tabellen, så varje butiksskrapning, Tradera-svep och CardTrader-körning
 * flyttade samlingsvärdet. Med CM först rör det sig med prisjobben
 * (cardmarket-refresh 13:00, hot-card-refresh 21:00, jp-singles-refresh).
 *
 * ⛔ Reserven tas ALDRIG bort: nya set, JP-singlar utan CM-länk och rena butiksvaror
 * saknar CM-offer helt, och "–" på ett kort användaren faktiskt äger är sämre än ett
 * butikspris som är märkt som just det (`fromCardmarket: false`).
 */
export function productMarketValue(offers: ValuedOffer[]): MarketValue {
  const priced = offers.filter(
    (o): o is ValuedOffer & { price: number } =>
      o.price != null && o.price > 0 && isDirectOfferUrl(o.url)
  );
  if (priced.length === 0) return NO_VALUE;

  // En produkt kan bära flera CM-offers (unik per condition+language) — lägst vinner.
  // ⛔ Ingen IN_STOCK-prioritering här: prisjobben märker en CM-offer OUT_OF_STOCK
  // när siffran är en uppskattning, men den är fortfarande Cardmarkets referens och
  // ett bättre värde än en butik i lager på andra sidan katalogen.
  const cm = priced.filter((o) => o.retailer.name === CARDMARKET_RETAILER_NAME);
  if (cm.length > 0) {
    return { price: cm.reduce((a, b) => (b.price < a.price ? b : a)).price, fromCardmarket: true };
  }

  // Reserv = samma urval som produktsidans rubrik: i lager före slutsålt, sedan lägst.
  const inStock = priced.filter((o) => o.stockStatus === "IN_STOCK");
  const pool = inStock.length > 0 ? inStock : priced;
  return { price: pool.reduce((a, b) => (b.price < a.price ? b : a)).price, fromCardmarket: false };
}

/**
 * Vilken av ETT KORTS produkter ska sätta värdet?
 *
 * ⛔ CM-produkterna jämförs BARA med varandra. Att ta "lägst av alla" efter att varje
 * produkt fått sitt eget värde hade smugit tillbaka precis samma fel en nivå upp:
 * en tryckning med CM-pris 327 kr hade förlorat mot en syskonprodukt vars enda
 * offer är en Tradera-annons på 67 kr, och kortet hade fått marknadsplatsens tal ändå.
 */
export function pickCardValue(values: MarketValue[]): MarketValue {
  const withPrice = values.filter((v): v is MarketValue & { price: number } => v.price != null);
  if (withPrice.length === 0) return NO_VALUE;
  const cm = withPrice.filter((v) => v.fromCardmarket);
  const pool = cm.length > 0 ? cm : withPrice;
  return pool.reduce((a, b) => (b.price < a.price ? b : a));
}
