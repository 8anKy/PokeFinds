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

/**
 * NYSLÄPPTA SINGLAR SYNS UTAN PRIS (2026-11-06, ägaren: "jag ser inte Delta Reign
 * när jag väljer setet"). Bläddringsytorna gömmer prislösa produkter, men ett helt
 * nytt sets kort saknar CM-koppling hos leverantören i dagar (`cardmarket_id: null`
 * på släppdagen) — då var hela setet osynligt i katalogen, setfiltret och sökningen.
 * Ett kort ur katalogimporten är en kurerad post, inte skräp ⇒ det visas med "–".
 * Gäller bara SINGLAR (sealed föds ur Cardmarket med id) i set släppta de senaste
 * `NEW_SET_UNPRICED_DAYS` dygnen; därefter gäller vanliga regeln igen.
 */
export const NEW_SET_UNPRICED_DAYS = 14;

function newSetSince(): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - NEW_SET_UNPRICED_DAYS);
  return d;
}

/** Prisma-villkor: singel i ett set släppt nyligen (OR:as in bredvid "har pris"). */
export function newSetSingleWhere() {
  return { category: "SINGLE_CARD" as const, card: { set: { releaseDate: { gte: newSetSince() } } } };
}

/** Samma villkor som rå SQL; `alias` = Product-tabellens alias (t.ex. `p`). */
export function newSetSingleSql(alias: string): string {
  return `(${alias}."category"::text = 'SINGLE_CARD' AND EXISTS (SELECT 1 FROM "Card" nsc JOIN "CardSet" nss ON nss."id" = nsc."setId" WHERE nsc."id" = ${alias}."cardId" AND nss."releaseDate" >= '${newSetSince().toISOString()}'))`;
}
