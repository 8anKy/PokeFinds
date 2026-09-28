/**
 * AI-ASSISTENTERNAS CRAWLERS (ägarbeslut 2026-09-28: "synas när man frågar ChatGPT").
 *
 * Fram till nu låg VARJE AI-UA i blocklistan — i robots.txt OCH med 403 i middleware —
 * efter att deras svep hållit Neon vaken (Claude-SearchBot 08-09: 5,7 req/s, 63 % av
 * all trafik). Följden var att ChatGPT/Claude/Perplexity inte kunde läsa foilio.se alls,
 * och en assistent kan inte rekommendera en sajt den aldrig fått se.
 *
 * Två klasser, två regler:
 *  · INDEXERARE (sökindex bakom svaren) får BARA navsidorna — `AI_HUB_PATHS`, ~400
 *    sidor — aldrig de ~63 000 produktsidorna som var själva svepet. Regeln står både i
 *    robots.txt och i middleware (403), för en crawler som struntar i robots.txt ska
 *    inte kunna svepa katalogen.
 *  · ANVÄNDARHÄMTARE (en människa frågade just nu och assistenten öppnar EN sida) får
 *    allt publikt, som en webbläsare — samma disallow som `*`-gruppen.
 *
 * ⛔ TRÄNINGSCRAWLERS (GPTBot, ClaudeBot, CCBot, Bytespider …) STÅR KVAR I BLOCKLISTAN.
 *    De är svepen, och de styr inte vad assistenten svarar i dag.
 * ⛔ Edge-runtime: bara regexar och strängar här, inget Node-specifikt.
 */
export const AI_INDEXER_UAS = ["OAI-SearchBot", "Claude-SearchBot", "PerplexityBot"] as const;
export const AI_USER_FETCHER_UAS = ["ChatGPT-User", "Claude-User", "Perplexity-User"] as const;

export const AI_INDEXER = /OAI-SearchBot|Claude-SearchBot|PerplexityBot/i;

/**
 * Navsidorna. Prefix — `/sets` täcker `/sets/<id>`, `/guider` varje guide. Allt under
 * svenska OCH `/en/`. Inget med query (`/produkter?` är en oändlig URL-rymd, och den
 * stoppas redan av `*`-reglerna).
 *
 * ⛔ `/produkter` EXAKT är tillåten, dess undersidor aldrig: `/` 308:ar dit (startsidan
 * ÄR katalogen), så utan den hade en AI som följde startsidan fått 403. Produktsidorna
 * (`/produkter/<slug>`, ~63 000) var svepet.
 * `/llms.txt`, `robots.txt` och sitemapen går aldrig genom middleware (punkt i vägen).
 */
export const AI_HUB_PATHS = ["/sets", "/guider", "/om", "/priser", "/discord", "/kontakt"] as const;

/** Får en AI-INDEXERARE hämta `pathname`? (Startsidan + navsidorna, båda språken.) */
export function aiIndexerMayFetch(pathname: string): boolean {
  const path = pathname === "/en" ? "/" : pathname.startsWith("/en/") ? pathname.slice(3) : pathname;
  if (path === "/" || path === "" || path === "/produkter") return true;
  return AI_HUB_PATHS.some((hub) => path === hub || path.startsWith(`${hub}/`));
}
