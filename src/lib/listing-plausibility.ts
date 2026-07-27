/**
 * Marknadsplats-annonsens pris mot produktens facit — EN tröskel, delad av både
 * skriv- och läsvägen.
 *
 * Skrivvägen (`isPlausiblePriceFor` / `getListingPriceGuard` i scrapers/matching.ts)
 * avgör om en Tradera-annons får bli offer eller skena-rad. Läsvägen (produktsidans
 * "Fler annonser på Tradera") måste ställa SAMMA fråga igen, för vakten kan bara döma
 * med det facit som fanns NÄR raden skrevs: "Mega Darkrai ex 116/084 Extended
 * Artwork-ram" (179 kr) skrevs medan Pitch Black ännu saknade CM-data — utan
 * referenspris fanns ingen undre gräns att falla på. Dagen efter hade kortet ett
 * CM-golv på 3 207 kr, men skena-raden låg kvar och visades i karusellen.
 *
 * Modulen är avsiktligt beroendefri: produktsidan får inte dra in hela
 * matchningsmotorn (pokemon-names m.m.) i sitt serverbundle bara för en tröskel —
 * minnet är den dyraste posten på Railway.
 */

/**
 * Under så här stor andel av facit är en skick-okänd marknadsannons inte varan:
 * det är ett spelat exemplar, ett tillbehör eller en felmatch. Ägarbeslut
 * 2026-07-17 (singlar) — vår rubrik betyder "NM engelska", och en annons på 5 %
 * av NM-golvet är inte NM.
 */
export const MARKETPLACE_MIN_PRICE_RATIO = 0.15;

/**
 * Får annonsen visas som "samma vara" bredvid produktens pris?
 *
 * `referenceOre = null` (inget facit) ⇒ true. Att gissa utan facit är precis vad
 * som skrev ramen till att börja med; att DÖLJA utan facit vore lika godtyckligt.
 */
export function listingPriceIsPlausible(
  priceOre: number,
  referenceOre: number | null | undefined
): boolean {
  if (referenceOre == null || referenceOre <= 0) return true;
  return priceOre >= referenceOre * MARKETPLACE_MIN_PRICE_RATIO;
}

/**
 * Karusellens urval: dölj UTSTICKARE, aldrig hela marknaden.
 *
 * Mätt på prod 2026-07-27: en rå tillämpning av gränsen ovan hade dolt 263 av
 * 92 586 skena-rader — men på 17 produkter försvann ALLA annonser, och de var
 * samtliga vintage-commons där VÅR referens är fel tryckning: Gust of Wind ·
 * Base 93/102 har CM-golv 494 kr (1st Edition Shadowless) medan tjugo Tradera-
 * annonser på det ordinarie kortet ligger på 5–9 kr. Att döma bort tjugo av
 * tjugo annonser är inte en outlier-vakt — det är ett påstående om att hela
 * marknaden har fel, och det påståendet har vi inget stöd för.
 *
 * Regeln: fäller gränsen NÅGON annons men inte alla, är de fällda utstickare
 * (ramen på 179 kr bredvid 4 050/4 495/5 000). Fäller den ALLA är det referensen
 * som är misstänkt — visa dem då, för karusellen länkar ut till en verklig
 * marknad även när vår rubrik pekar på fel tryckning.
 */
export function visibleListings<T extends { price: number }>(
  rows: T[],
  referenceOre: number | null | undefined
): T[] {
  const kept = rows.filter((r) => listingPriceIsPlausible(r.price, referenceOre));
  return kept.length > 0 ? kept : rows;
}
