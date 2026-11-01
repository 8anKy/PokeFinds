/**
 * Shopify Markets: pinna den SVENSKA marknaden (SEK ink. moms) på varje Shopify-hämtning.
 *
 * Shopify Markets serverar pris per BESÖKARENS marknad (geo/cookie/URL). Jobben kör på
 * GitHub Actions (US) — utan pinne får vi en utländsk marknads pris, ofta EX moms
 * (Goblinen: 55,20 = 69/1,25) eller i FEL VALUTA.
 *
 * ⛔ COOKIEN ENSAM RÄCKER INTE (upptäckt 2026-11-01). Rogerz (rogerz.dk) slutade lyssna på
 *    `localization=SE` och svarade i DKK — 899,00 DKK lagrades som 899 kr för en ETB som
 *    kostar 1 346 kr i deras svenska marknad. En användare såg det i appen. `?country=SE` är
 *    Shopifys egen marknadsväljare i URL:en och bet där cookien inte gjorde det. MÄTT samma
 *    dag mot alla 28 Shopify-butikers /products.json: identiska priser med och utan
 *    parametern överallt UTOM Rogerz ⇒ ofarlig för butiker utan Markets. Båda skickas.
 */
export const SE_MARKET_HEADERS = { cookie: "localization=SE", "accept-language": "sv-SE" } as const;

/** Lägger på `country=SE` (Shopify Markets väljare) utan att röra övriga parametrar. */
export function withSeMarket(url: string): string {
  try {
    const u = new URL(url);
    u.searchParams.set("country", "SE");
    return u.toString();
  } catch {
    return url;
  }
}
