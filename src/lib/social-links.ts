/**
 * Foilios officiella kanaler — EN definition, delad av alla ytor (header-bricka,
 * "Häng med oss"-kortet i katalogens sidofält, /mer). Ändra länkarna HÄR, aldrig
 * på anropsställena.
 *
 * ⛔ App Store-länken bär MEDVETET ingen `?l=`-parameter: `l=en-GB` hade tvingat
 * engelsk butikssida på svenska besökare. `/se/`-butiken + användarens eget
 * språkval ger rätt sida av sig själv.
 */
export const APP_STORE_URL =
  "https://apps.apple.com/se/app/foilio-kortpriser-larm/id6783443245";

export const DISCORD_URL = "https://discord.gg/kpgmdEebgW";
export const INSTAGRAM_URL = "https://www.instagram.com/foilio.se";
export const TIKTOK_URL = "https://www.tiktok.com/@foilio.se";

/**
 * Subredditen r/PokemonTCGSverige.
 *
 * ⛔ VARFÖR DEN LIGGER HÄR OCH INTE I DISCORD-INVITES-MÖNSTRET: Discord räknar
 * användningar per inbjudningskod, vilket gör mätningen gratis. Reddit har ingen
 * motsvarande per-yta-räknare — en egen kod finns inte att skapa. Vi mäter i
 * stället på Reddits egen trafikvy (Mod Tools → Insights), som redovisar
 * hänvisande domäner utan att kosta oss något.
 *
 * ⛔ LÄNKEN FRÅN OSS ÄR HELA UPPTÄCKTSVÄGEN. Reddit publicerar ingen sitemap och
 * robots.txt saknar `Sitemap:`-direktiv, så Google hittar en helt ny subreddit
 * BARA via länkar från sidor som redan kryps. Sidfoten (varje sida) och
 * `SOCIAL_CHANNELS` (katalogens sidofält på /produkter) är därför inte pynt utan
 * den enda vägen in. ⛔ Omvänt ger Reddit oss ingenting tillbaka: varje
 * användarplacerad länk där bär `rel="nofollow ugc"`.
 *
 * ⛔ FÖRUTSÄTTNINGEN ÄR 200 UTLOGGAT, INTE "subben syns i mitt eget flöde".
 * Verifierat 2026-08-19 med en cookielös begäran (`credentials: "omit"`) mot
 * www.reddit.com/r/PokemonTCGSverige/ → 200. Byter subredditen namn eller blir
 * privat måste kontrollen göras OM före deploy: annars står en trasig utgående
 * länk i sidfoten på varenda sida sajten har.
 */
export const REDDIT_URL = "https://www.reddit.com/r/PokemonTCGSverige/";
