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
  // ⛔ ETT ENDA UNDANTAG, ägarbeslut 2026-08-29: Cardmarket-sök på JAPANSKA singlar.
  // Priset på en japansk singel är CM:s exakta NM-"From" för just det kortet (ur
  // RapidAPI:s /pokemon-jp), men leverantören ger inget `cardmarket_id` och ingen
  // produktsida — bara en Cloudflare-skyddad redirect via sin egen sajt, som ägaren
  // valde bort. Länken är därför CM:s sök förfiltrerad till japanska annonser
  // (language=7), och knappen säger "Sök på Cardmarket", inte "Till butik".
  // Regeln ovan gäller oförändrat för allt annat; SQL-spegeln i DIRECT_URL_SQL
  // (services/products.ts) bär samma undantag. Vaktat av marketplace-urls.test.ts.
  if (isCardmarketJpSearchUrl(u)) return true;
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
 * Cardmarkets 1st Edition-filter: isFirstEd=Y visar BARA annonser som säljaren
 * märkt 1st Edition.
 *
 * VARFÖR DET INTE ÄR VALFRITT för en 1st Edition-produkt: CM har bara TVÅ
 * produkter per Base-kort, och Shadowless + 1st Edition delar den ena — 1st
 * Edition är en FLAGGA på annonsen, inte en egen produkt. Utan filtret landar
 * båda våra tryckningsprodukter på exakt samma osorterade sida, där den
 * billigaste annonsen nästan alltid är en Shadowless. Priset vi publicerar för
 * 1st Edition kommer däremot från de 1st Edition-märkta annonserna (feedens
 * `version`-rad), så länken hade visat något annat än siffran bredvid den.
 *
 * Verifierat 2026-07-28: filtret finns i CM:s egen filterpanel ("First Edition?
 * Any/Yes/No"), och 302:n från ?idProduct= BEVARAR parametern in i slug-URL:en
 * (Bulbasaur 660184 → .../Base-Set/Bulbasaur-V2-BS44?isFirstEd=Y&language=1&
 * minCondition=2, som visar exakt den 600 €-annons feedens 1st Edition-rad
 * rapporterar som From).
 */
export const CARDMARKET_FIRST_ED_PARAM = "isFirstEd=Y";

/**
 * `only` = bara 1st Edition-annonser (isFirstEd=Y), `exclude` = allt UTOM dem
 * (isFirstEd=N). Det finns inget "lämna åt slumpen" — se nedan.
 */
export type FirstEdFilter = "only" | "exclude";

/**
 * Sätt 1st Edition-filtret på en Cardmarket-länk. Idempotent OCH korrigerande:
 * ett befintligt isFirstEd skrivs över, så en länk aldrig blir kvar i fel läge.
 *
 * ⛔ ATT UTELÄMNA PARAMETERN ÄR INTE "INGET FILTER" (mätt 2026-07-28).
 * Cardmarket lägger filtret i SESSIONEN och stämplar tillbaka det på nästa
 * produktsida man öppnar. Verifierat: en förfrågan till `?idProduct=273696&
 * language=1&minCondition=2` — helt utan isFirstEd — landade på
 * `.../Alakazam-V1-BS1?language=1&minCondition=2&isFirstEd=N`, och tidigare
 * samma dag fick `?idProduct=273753&language=1` tillbaka `&isFirstEd=Y`.
 * Klickar man alltså EN 1st Edition-länk hos oss följer filtret med till varje
 * annat kort man öppnar sen — Unlimited-kortet visar 1st Edition-annonser.
 * Därför säger VARJE singel-länk uttryckligen vilket läge den vill ha; det är
 * det enda sättet att äga vad besökaren faktiskt får se.
 *
 * (Sealed lämnas utanför: CM stämplar in parametern där också, men sealed-sidan
 * har varken skick- eller 1st Edition-filter i sin panel och listan påverkas
 * inte — verifierat på Scarlet & Violet Booster, 3 204 annonser med isFirstEd=N.)
 */
export function withFirstEd(url: string | null | undefined, state: FirstEdFilter): string {
  if (!url) return url ?? "";
  if (!url.toLowerCase().includes("cardmarket.com")) return url;
  const want = state === "only" ? "Y" : "N";
  if (/[?&]isFirstEd=/i.test(url)) return url.replace(/([?&]isFirstEd=)[^&]*/i, `$1${want}`);
  return `${url}${url.includes("?") ? "&" : "?"}isFirstEd=${want}`;
}

/**
 * Exakt CM-produktsida via officiellt idProduct, förfiltrerad till engelska.
 * Redirecten bevarar extra query-params, så &minCondition=2 (Near Mint) och
 * &isFirstEd=Y/N (tryckning) läggs på via `opts`.
 *
 * `firstEd` bör alltid sättas för SINGLAR — utelämnad parameter betyder inte
 * "ofiltrerat" utan "vad besökarens CM-session råkar minnas" (se withFirstEd).
 */
export function cardmarketProductUrl(
  idProduct: number,
  opts?: { nearMint?: boolean; firstEd?: FirstEdFilter }
): string {
  const base = `https://www.cardmarket.com/en/Pokemon/Products?idProduct=${idProduct}&language=1`;
  const nm = opts?.nearMint ? withNearMint(base) : base;
  return opts?.firstEd ? withFirstEd(nm, opts.firstEd) : nm;
}

/**
 * Exakt CM-produktsida för en JAPANSK produkt, förfiltrerad till japanska
 * annonser (language=7 = Japanese i Cardmarkets språk-ID:n; japanska set har
 * EGNA produktsidor på CM, så id:t pekar redan på den japanska utgåvan —
 * filtret säkrar att listorna/priserna är japanskspråkiga).
 */
export function cardmarketJapaneseProductUrl(idProduct: number): string {
  return `https://www.cardmarket.com/en/Pokemon/Products?idProduct=${idProduct}&language=7`;
}

/**
 * Samma sida för en japansk SINGEL: + Near Mint-filtret (`minCondition=2`), precis
 * som de engelska singlarna får via `withNearMint`. Priset vi visar är CM:s NM-From,
 * så sidan ska öppna på de annonser priset gäller. Sealed får INGET skickfilter.
 */
export function cardmarketJapaneseSingleUrl(idProduct: number): string {
  return withNearMint(cardmarketJapaneseProductUrl(idProduct));
}

export function cardmarketSearchUrl(term: string): string {
  return `https://www.cardmarket.com/en/Pokemon/Products/Search?searchString=${encodeURIComponent(term)}&site=1`;
}

/** Cardmarkets språk-id för japanska annonser (`language=7`). */
export const CARDMARKET_LANGUAGE_JP = 7;

/**
 * "Sök på Cardmarket" för en JAPANSK singel: namnsök (set+nummer ger 0 träffar hos
 * CM) förfiltrerad till japanska annonser. Det ENDA sök-URL:et som får bära ett
 * pris — se undantaget i `isDirectOfferUrl`. Bara det engelska kortnamnet, aldrig
 * vårt "(JP)"-suffix: det är vår skrivning, inte CM:s.
 */
export function cardmarketJpSearchUrl(nameEn: string): string {
  const term = nameEn.replace(/\s*\(JP\)\s*$/i, "").trim();
  return `https://www.cardmarket.com/en/Pokemon/Products/Search?searchString=${encodeURIComponent(term)}&language=${CARDMARKET_LANGUAGE_JP}`;
}

/** Är URL:en exakt den JP-söklänk `cardmarketJpSearchUrl` bygger? (Skiftlägesokänslig.) */
export function isCardmarketJpSearchUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  const u = url.toLowerCase();
  return (
    u.includes("cardmarket.com/") &&
    u.includes("/products/search?") &&
    u.includes("searchstring=") &&
    /[?&]language=7(&|$)/.test(u)
  );
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
