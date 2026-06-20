/**
 * Delade URL-byggare för marknadsplats-offers (Cardmarket, Tradera).
 *
 * - Cardmarket exakt: prices.pokemontcg.io/cardmarket/{id} 302-redirectar till
 *   kortets riktiga Cardmarket-produktsida (fungerar när kortet har
 *   cardmarket-data i Pokémon TCG API:t).
 * - Cardmarket per idProduct: /en/Pokemon/Products?idProduct={id} redirectar
 *   till exakta produktsidan och BEVARAR extra query-parametrar — &language=1
 *   förfiltrerar annonserna till engelska (verifierat 2026-06-12).
 * - Cardmarket-sök: endast kortnamn — set+nummer i söksträngen ger 0 träffar.
 * - Tradera-sök: "Pokemon {term}" — håll termen kort för träffar.
 */
/**
 * En "direkt" offer-länk pekar på en specifik produkt-/annonssida som går att
 * köpa direkt (Cardmarket-produktsida, Tradera /item/, butikens produktsida).
 * En sök-/bläddringslänk (Cardmarket Search, Tradera /search?q=, butikssök) är
 * INTE direkt — sådana offers visas inte och räknas inte in i prisstatistiken.
 */
export function isDirectOfferUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  const u = url.toLowerCase();
  // Sökvägar/parametrar som avslöjar en sök- eller bläddringslänk.
  if (u.includes("/search")) return false;        // Tradera & CM Search, butikssök
  if (u.includes("searchstring=")) return false;  // Cardmarket-sök
  if (u.includes("sokstr=") || u.includes("funk=sok")) return false; // Spelexperten-sök
  if (/[?&]query=/.test(u)) return false;         // Alphaspel m.fl. sök
  if (/[?&]q=/.test(u)) return false;             // generisk ?q= sökterm
  // Cardmarket-redirecten (prices.pokemontcg.io/cardmarket/{id}) går till rätt
  // kort men kan INTE bära ?language=1 (302:n strippar query). Den är en
  // transient länk som ska lösas till en engelsk slug innan den visas — dölj
  // den tills resolve-cm-urls.ts har uppgraderat den.
  if (isCardmarketRedirect(u)) return false;
  return true;
}

/** prices.pokemontcg.io-redirecten — rätt kort, men inte engelsk-förfiltrerad. */
export function isCardmarketRedirect(url: string | null | undefined): boolean {
  return !!url && url.toLowerCase().includes("prices.pokemontcg.io/cardmarket");
}

/** Färdig engelsk Cardmarket-produktlänk (cardmarket.com … language=1). */
export function isEnglishCardmarketUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  const u = url.toLowerCase();
  return u.includes("cardmarket.com") && u.includes("language=1");
}

/**
 * TRANSIENT redirect — INTE en engelsk-förfiltrerad länk. 302:n till kortets
 * riktiga CM-produktsida strippar appended query (?language=1 försvinner), så
 * den måste lösas till slug via resolve-cm-urls.ts innan den visas (isDirectOfferUrl
 * döljer den tills dess). Använd cardmarketProductUrl()/den lösta slugen för
 * länkar som faktiskt ska visas.
 */
export function cardmarketExactUrl(tcgExternalId: string): string {
  return `https://prices.pokemontcg.io/cardmarket/${tcgExternalId}`;
}

/**
 * Cardmarket-villkorsfilter i webb-URL:er: minCondition=2 = Near Mint (och
 * bättre, dvs Mint+NM). Motsvarar API-fältet lowest_near_mint. Endast
 * relevant för singlar — sealed har inget skick.
 */
export const CARDMARKET_NEAR_MINT_PARAM = "minCondition=2";

/**
 * Lägg till Near Mint-filtret på en Cardmarket-länk (idempotent). No-op om
 * länken inte pekar på cardmarket.com eller redan har ett minCondition.
 */
export function withNearMint(url: string | null | undefined): string {
  if (!url) return url ?? "";
  const u = url.toLowerCase();
  if (!u.includes("cardmarket.com") || u.includes("mincondition=")) return url;
  return `${url}${url.includes("?") ? "&" : "?"}${CARDMARKET_NEAR_MINT_PARAM}`;
}

/**
 * Exakt CM-produktsida via officiellt idProduct, förfiltrerad till engelska.
 * Redirecten bevarar extra query-params, så &minCondition=2 (Near Mint)
 * läggs på för singlar via `opts.nearMint`.
 */
export function cardmarketProductUrl(
  idProduct: number,
  opts?: { nearMint?: boolean }
): string {
  const base = `https://www.cardmarket.com/en/Pokemon/Products?idProduct=${idProduct}&language=1`;
  return opts?.nearMint ? withNearMint(base) : base;
}

export function cardmarketSearchUrl(term: string): string {
  return `https://www.cardmarket.com/en/Pokemon/Products/Search?searchString=${encodeURIComponent(term)}&site=1`;
}

export function traderaSearchUrl(term: string): string {
  // Prefixa inte termer som redan börjar med Pokemon/Pokémon (dubbla ord ger sämre träffar)
  const q = /^pok[eé]mon\b/i.test(term.trim()) ? term.trim() : `Pokemon ${term.trim()}`;
  return `https://www.tradera.com/search?q=${encodeURIComponent(q)}`;
}

/**
 * Tradera-kategorier för Pokémon TCG (under Samlarsaker → Pokémonkort = 293307).
 */
export const TRADERA_CATEGORY: Record<string, number> = {
  SINGLE_CARD: 1001337,   // Löskort/Singles
  BOOSTER_BOX: 1001340,   // Boosterboxar
  BOOSTER_PACK: 1001339,  // Boosterpaket (bundles listas ofta här)
  ETB: 1001341,           // Övrigt sealed (ETB m.m.)
  COLLECTION_BOX: 1001341,
  TIN: 1001341,
  BLISTER: 1001339,
  BUNDLE: 1001341,
  OTHER: 293307,          // Hela Pokémonkort-kategorin
};

/**
 * Specifik Tradera-sök-URL med kategorifilter. Ger mer träffsäkra resultat
 * genom att filtrera på rätt produkttyp.
 *
 * @param term  Sökterm (t.ex. "Charizard ex Obsidian Flames 125")
 * @param category  ProductCategory (t.ex. "SINGLE_CARD", "BOOSTER_BOX")
 */
export function traderaSearchUrlSpecific(
  term: string,
  category?: string
): string {
  const q = /^pok[eé]mon\b/i.test(term.trim())
    ? term.trim()
    : `Pokemon ${term.trim()}`;
  const catId = category ? TRADERA_CATEGORY[category] ?? 293307 : 293307;
  return `https://www.tradera.com/search?q=${encodeURIComponent(q)}&categoryId=${catId}`;
}
