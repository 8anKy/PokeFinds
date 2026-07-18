/**
 * IMPORT-DENYLIST: butiks-URL:er som ALDRIG ska bli katalogprodukter.
 *
 * Auto-importen (ensureListingProduct) skapar en produkt för varje NY sealed butiks-URL.
 * En del butikslistningar är tillbehör (suddgummin/pennfodral/mini-album) eller generiska
 * SORTIMENT ("1st random Tin", generisk checklane/blister) som ägaren INTE vill ha i
 * katalogen. Raderar man bara produkten återskapar nästa import den — URL:en finns kvar i
 * butiksfeeden. Den här listan gör raderingen PERMANENT: URL:en avvisas vid import.
 *
 * Lägg till en URL här när ägaren säger "ta bort den här och låt den inte komma tillbaka".
 * (Ett riktigt admin-UI vore bättre om listan växer — men en committad lista räcker länge
 * och kostar noll runtime.) Matchning sker på NORMALISERAD URL, se normUrl.
 */

/** Normaliserar en URL för jämförelse: gemener, utan query/hash, utan avslutande slash. */
function normUrl(u: string): string {
  return u.trim().toLowerCase().replace(/[?#].*$/, "").replace(/\/+$/, "");
}

// Nekade URL:er (redan normaliserade). Grupperade efter borttagen produkt.
const DENIED = new Set<string>(
  [
    // "2 Booster Packs & Smoliv or Lechonk Eraser" (tillbehör: suddgummi)
    "https://www.swepoke.se/pokemon/blister-packs/pokemon-eraser-lechonk-smoliv-2-pack",
    "https://dragonslair.se/products/pokemon-tcg-2-booster-packs-smoliv-or-lechonk-eraser-pokemon",
    // "Back to School - 2 Booster Packs & Eraser" (tillbehör: pennfodral)
    "https://www.spelexperten.com/sallskapsspel/pokemon/pokemon-tcg-back-to-school-pennfodral-2024.html",
    "https://dragonslair.se/products/pokemon-tcg-back-to-school-2-booster-packs-eraser",
    // "2026 Spring Mini Album with Booster" (tillbehör: mini-album/pärm)
    "https://www.maxgaming.se/sv/pokemon/pokemon-mini-album-med-booster-q1-26",
    "https://www.webhallen.com/se/product/396737",
    "https://samlarhobby.se/products/pokemon-2026-spring-mini-album-with-booster",
    "https://dragonslair.se/products/pokemon-tcg-phantasmal-flames-booster-mini-parm-pokemon",
    // "Mega Evolution Checklane Booster" (generisk, karaktärslös)
    "https://www.maxgaming.se/sv/pokemon/pokemon-mega-evolution-checklane-booster",
    // "Mega Evolution 2.5: Ascended Heroes - 1st random Tin" (generiskt sortiment)
    "https://dragonslair.se/products/pokemon-tcg-mega-evolution-ascended-heroes-mini-tin",
    "https://www.maxgaming.se/sv/pokemon/pokemon-me25-ascended-heroes-mini-tin",
    "https://www.swepoke.se/pokemon/tins/pokemon-ascended-heroes-mini-tin-forhandsbokning",
    "https://samlarhobby.se/products/pokemon-mega-evolution-2-5-ascended-heroes-1st-random-tin",
    // "Sun & Moon: Guardians Rising, 1 Blister pack" (generisk blister, ingen match)
    "https://samlarhobby.se/products/pokemon-sun-moon-guardians-rising-1-blister-pack",
    // "Fall Tin - Paradox Destinies Tin" (generisk "random tin", mappar ej till en karaktär)
    "https://speltrollet.se/products/pok85844",
    // "Pokémon TCG: Kanto Power Mini Tin" (generisk sortiment-tin — de specifika
    // Kanto Power-tinsen finns som egna produkter; den här generiska ska bort)
    "https://www.spelexperten.com/sallskapsspel/pokemon/pokemon-tcg-kanto-power-mini-tin.html",
    // 2026-07-18 — ägaren rensade dubbletter/tillbehör bland sealed-stubbar utan CM-länk.
    // Mini-portfolio+booster (tillbehör som inte ska i katalogen alls):
    "https://dragonslair.se/products/pokemon-tcg-scarlet-violet-temporal-forces-mini-portfolio-plus-1-booster-pokemon",
    "https://dragonslair.se/products/pokemon-tcg-scarlet-violet-stellar-crown-mini-portfolio-plus-1-booster",
    "https://www.spelexperten.com/sallskapsspel/pokemon/pokemon-tcg-fall-2024-mini-portfolio-booster.html",
    "https://www.spelexperten.com/sallskapsspel/pokemon/pokemon-tcg-spring-2025-mini-portfolio-booster.html",
    "https://dragonslair.se/products/pokemon-tcg-scarlet-violet-journey-together-mini-portfolio-booster-pokemon",
    "https://www.maxgaming.se/sv/pokemon/scarlet-violet-9-journey-together-mini-album-booster",
    "https://dragonslair.se/products/pokemon-tcg-scarlet-violet-obsidian-flames-mini-portfolio-plus-booster-pokemon",
    "https://dragonslair.se/products/pokemon-tcg-mega-evolution-mini-portfolio-booster-pokemon",
    "https://www.spelexperten.com/sallskapsspel/pokemon/pokemon-tcg-mega-evolution-fall-2025-mini-portfolio-booster.html",
    "https://speltrollet.se/products/pokemon-mega-evolution-fall-2025-mini-portfolio-booster",
    "https://www.swepoke.se/pokemon/booster-packs/pokemon-mega-evolution-fall-2025-mini-portfolio-plus-1-booster-pack",
    "https://www.spelexperten.com/sallskapsspel/pokemon/pokemon-tcg-fall-2026-mini-portfolio-booster.html",
    "https://dragonslair.se/products/pokemon-tcg-mini-portfolio-with-booster-pack-pokemon",
    // Generiska dubblett-blistrar/booster (de karaktärsspecifika CM-produkterna finns kvar):
    "https://speltrollet.se/products/pokemon-mega-evolution-perfect-order-3-pack-blister",
    "https://samlarhobby.se/products/pokemon-mega-evolutions-me03-perfect-order-1-blister-pack",
    "https://dragonslair.se/products/pokemon-tcg-scarlet-violet-journey-together-checklane-blister-pokemon",
    "https://dragonslair.se/products/pokemon-tcg-scarlet-violet-journey-together-3-pack-blister-pokemon",
    "https://samlarhobby.se/products/pokemon-mega-evolutions-me04-chaos-rising-checklane-toxel",
    "https://www.maxgaming.se/sv/pokemon/pokemon-me04-chaos-rising-checklane-booster",
    "https://www.alphaspel.se/1762-pokemon-tcg/349393-pokemon-tcg-mega-evolution-chaos-rising-checklane-blister",
    "https://www.spelexperten.com/sallskapsspel/pokemon/pokemon-tcg-chaos-rising-checklane-toxel.html",
    "https://manatorsk.com/products/pokemon-checklane-mega-evolution-4-0-toxel",
    "https://dragonslair.se/products/pokemon-tcg-mega-evolution-chaos-rising-checklane-blister-pokemon",
    "https://www.webhallen.com/se/product/398333",
    "https://speltrollet.se/products/pokemon-me04-chaos-rising-checklane-booster",
    // #18 MaxGaming-dubblettlistning (store-länkarna flyttas till Makuhita 1-Pack, denna släpps):
    "https://www.maxgaming.se/sv/pokemon/pokemon-mega-evolution-checklane-booster",
  ].map(normUrl)
);

/** SANT om URL:en är nekad → auto-importen ska ALDRIG skapa en produkt för den. */
export function isDeniedListingUrl(url: string): boolean {
  return DENIED.has(normUrl(url));
}
