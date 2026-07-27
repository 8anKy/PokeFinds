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
