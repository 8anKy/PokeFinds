/**
 * Ägarens katalogborttagning — `Product.hiddenAt`.
 *
 * ⛔ EN GÖMD PRODUKT ÄR INTE RADERAD, och det är hela poängen. Discord-lanens
 *    ruttabell (butiks-URL → produkt) byggs ur Offer + StoreListing, så en RADERAD
 *    produkt tar med sig routen: restock-lanen ser fortfarande lagerflippen men kan
 *    inte posta den ("okänd URL"), tyst och för alltid. Raderingsflödet denylistar
 *    dessutom butiks-URL:erna, vilket gör tystnaden permanent. Att gömma raden
 *    behåller offern, routen och Discord-inlägget.
 *
 * ⛔ EGET LEAF-MODUL, INTE services/products.ts. `products.ts` importerar
 *    `services/market.ts`, så en konstant därifrån in i market hade slutit en
 *    importcykel — och en `const` i en cykel kan utvärderas som `undefined`
 *    beroende på modulordning. Ett gömfilter som tyst blir `undefined` är exakt
 *    det fel som inte får finnas: `where: undefined` filtrerar ingenting.
 *
 * ⛔ PRODUKTSIDAN GRINDAS ALDRIG PÅ DET HÄR. `/produkter/[slug]` måste svara på en
 *    direkt träff — annars pekar varje Discord-embed på en 404.
 *
 * ⚠️ Gäller BLÄDDRINGSYTORNA: katalog/sök, facetter, autocomplete, liknande
 *    produkter, /marknad och sitemapen. Läggs en ny publik lista till hör den hit.
 */

/** Prisma-villkor: bara produkter ägaren inte gömt. */
export const NOT_HIDDEN = { hiddenAt: null } as const;

/** Samma villkor för de råa SQL-vägarna (utan tabellalias). */
export const NOT_HIDDEN_SQL = `"hiddenAt" IS NULL`;
