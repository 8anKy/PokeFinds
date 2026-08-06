/**
 * Vad "sealed" betyder — EN definition.
 *
 * Frågan "är den här produkten en sealed-vara?" ställdes redan på fyra ställen med
 * var sin handskrivna negativa lista (services/products.ts, marketplace-offers.ts,
 * jobs/cardmarket-refresh.ts) och de är inte identiska — någon utesluter `OTHER`,
 * någon inte. En femte kopia hade garanterat drivit isär, så restock-bevakningen
 * (som avgör VEM som får mejl) läser härifrån i stället.
 *
 * ⛔ Rör inte de befintliga listorna på köpet: de sitter i prissättnings- och
 * synlighetsvägar med egna skäl att skilja sig, och en "städning" av dem är en
 * beteendeändring i fyra jobb, inte en refaktorering.
 */

/**
 * Kategorier som ALDRIG är en sealed-vara.
 *
 * `OTHER` är med flit INTE utesluten: det är butikernas restkategori och rymmer
 * riktiga sealed-SKU:er som auto-importen inte kunnat klassa närmare. De restockar
 * som vilken låda som helst, och att tysta dem hade gjort bevakningen tyst just
 * för de nya produkter den finns till för.
 */
const NON_SEALED_CATEGORIES = ["SINGLE_CARD", "GRADED_CARD", "ACCESSORY"] as const;

/** Samma lista som Prisma-filter: `category: { notIn: SEALED_CATEGORY_EXCLUSIONS }`. */
export const SEALED_CATEGORY_EXCLUSIONS = NON_SEALED_CATEGORIES;

/**
 * Är kategorin en sealed-produkt? Tar `string` (inte enumen) med flit — anropare
 * är både Prisma-rader och hand-typade klient-props, och en okänd sträng ska läsa
 * som "inte sealed", aldrig krascha.
 */
export function isSealedCategory(category: string | null | undefined): boolean {
  if (!category) return false;
  return !(NON_SEALED_CATEGORIES as readonly string[]).includes(category);
}
