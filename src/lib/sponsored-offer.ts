/**
 * SPONSRAD PLACERING — vilken (om någon) offer som får det märkta arket ovanför
 * butikslistan.
 *
 * ⛔ FUNKTIONEN RÖR ALDRIG BUTIKSLISTAN. Villkor §8 och /om ("Så rankar vi") lovar
 *    ordagrant att sponsrade placeringar hålls **åtskilda från den ordinarie
 *    rangordningen och aldrig påverkar den**. Därför: ett EGET ark ovanför listan,
 *    märkt "Annons", medan listan under sorteras precis som förut och den sponsrade
 *    butiken ligger kvar på sin naturliga prisplats där. Sorterar man in den i
 *    listan i stället bryts löftet, och BÅDA legaltexterna måste skrivas om i BÅDA
 *    språken först.
 *
 * ⛔ "Lägst"-taggen, rubrikpriset, prisstatistiken och prislarmen räknas oförändrat.
 *    Sponsringen är en PLACERING, inte ett pris — se `lowestBuyableOffer`.
 *
 * ⛔ BARA KÖPBART FÅR ANNONSERAS. En annons för något som är slut är sämre än ingen
 *    annons: den lovar en väg in i butiken som inte finns. Kravet är IN_STOCK, precis
 *    som "Lägst"-taggens. Pris får däremot SAKNAS (visas "–") — `null` betyder "vi
 *    vet inte", och en direktlänk utan pris visas ändå överallt annars i tjänsten.
 */

export interface SponsorableOffer {
  id: string;
  price: number | null;
  stockStatus: string;
  retailerId: string;
  retailer: { sponsored?: boolean };
}

/**
 * Den offer som ska visas i annonsarket, eller null.
 *
 * Väljer billigaste köpbara offern från en sponsrad butik — en butik kan ha flera
 * offers på samma produkt (olika skick/språk), och då är det billigaste den ärliga
 * siffran att annonsera. Offers utan pris väljs sist, aldrig före ett känt pris.
 *
 * @param offers Redan gallrade offers (direkta produktlänkar), i valfri ordning.
 */
export function pickSponsoredOffer<T extends SponsorableOffer>(offers: T[]): T | null {
  const candidates = offers.filter(
    (o) => o.retailer.sponsored && o.stockStatus === "IN_STOCK"
  );
  if (candidates.length === 0) return null;
  return candidates.reduce((best, o) => {
    if (o.price == null) return best;
    if (best.price == null) return o;
    return o.price < best.price ? o : best;
  });
}

/** Är butiken sponsrad just nu? `null` = aldrig sponsrad, förfluten tid = utgången. */
export function isSponsoredNow(sponsoredUntil: Date | string | null | undefined, now: Date = new Date()): boolean {
  if (!sponsoredUntil) return false;
  const until = sponsoredUntil instanceof Date ? sponsoredUntil : new Date(sponsoredUntil);
  return Number.isFinite(until.getTime()) && until.getTime() > now.getTime();
}
