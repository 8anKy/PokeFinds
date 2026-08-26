/**
 * Crawler-blocklistan. Bor i en egen modul (i stället för inuti middleware.ts) för
 * att den ska gå att TESTA: regexen är en enda 400 tecken lång rad där ett tappat
 * `|` är osynligt vid granskning, och en tyst trasig rad här betyder att hela
 * katalogen ligger öppen för svep igen.
 *
 * Middleware kör på Edge-runtime → den här filen får ALDRIG importera något
 * Node-specifikt. En bar regex, inget annat.
 *
 * Se middleware.ts för policyn (varför 403 och inte bara robots.txt, och varför
 * Google/Bing/länkförhandsvisare medvetet står utanför).
 */
export const BLOCKED_BOTS =
  /Applebot|GPTBot|OAI-SearchBot|ChatGPT-User|ClaudeBot|Claude-Web|Claude-SearchBot|Claude-User|anthropic-ai|CCBot|Bytespider|AhrefsBot|SemrushBot|DataForSeoBot|MJ12bot|Amazonbot|Amzn-SearchBot|ShapBot|Meta-ExternalAgent|Meta-WebIndexer|GoogleOther|PerplexityBot|Perplexity-User|YandexBot|Baiduspider|SeznamBot|DotBot|BLEXBot|Barkrowler|ImagesiftBot|Timpibot|Diffbot|omgili|Screaming Frog|python-requests|Scrapy|node-fetch|Go-http-client|libwww-perl/i;
// Amzn-SearchBot: Amazons NYARE crawler-UA (2026-08-22). `Amazonbot` stod redan i
// listan men matchar INTE strängen "Amzn-SearchBot" — det är ett annat namn, inte en
// variant, och regexen är ren substrängsmatchning. Följden: den svepte /produkter/[slug]
// var ~10:e sekund dygnet runt (8 672 träffar/dygn = 35 % av ALL trafik och 1 689 s =
// mest servertid av alla UA:er i Railways httpLogs), höll Neon-computen vaken 65 h i
// sträck och drev Railways RSS från 0,63 GB till 4,9 GB. Samma felmönster som
// Claude-SearchBot 08-09 och meta-webindexer 07-26: EN blockerad UA från en leverantör
// säger INGENTING om leverantörens andra UA:er. ShapBot: okänd lågvärdes-crawler i
// samma svep, ingen SEO-nytta för en svensk nischsajt.
// Claude-SearchBot: NY Anthropic-UA (matchas inte av ClaudeBot/Claude-Web) — svepte
// katalogen i 5,7 req/s från EN IP 2026-08-09 och stod för 63 % av ALL trafik; höll
// ensam Neon vaken dygnet runt. GoogleOther: Googles icke-sök-crawler (R&D/AI) — 28 %
// av trafiken samma dygn. Blockera den påverkar INTE sökindexeringen (Googlebot är
// en annan UA och står medvetet utanför listan).

/**
 * SVEPET SOM INTE HAR ETT NAMN ATT BLOCKERA (mätt 2026-08-26).
 *
 * Namnlistan ovan hade slutat bita: MÄTT över 24 h i Railways httpLogs stod alla
 * namngivna crawlers tillsammans för nästan ingenting, medan **416 hämtningar från 321
 * OLIKA IP-adresser** — 99 % `/produkter/[slug]`, aldrig samma slug två gånger — kom
 * från EN sträng:
 *
 *   Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15
 *   (KHTML, like Gecko) Chrome/139.0.0.0 Safari/605.1.15
 *
 * Med 1,3 hämtningar per IP är IP-blockering meningslös (residential proxies), och UA:n
 * bär inget namn. Men den är OMÖJLIG: `AppleWebKit/605.x` är SAFARIS motor, och Chrome
 * rapporterar ALLTID `AppleWebKit/537.36`. Ingen riktig webbläsare skickar båda.
 *
 * TRE VILLKOR, alla nödvändiga — vart och ett skyddar en ÄKTA webbläsare:
 *   · `AppleWebKit/6xx` + `Chrome/`  = kombinationen som inte kan finnas.
 *   · INTE `CriOS`/`EdgiOS`/`FxiOS`  = Chrome/Edge/Firefox PÅ iOS är WebKit-skal och
 *     skulle annars matcha — de skriver dock aldrig bara `Chrome/`, så villkoret är ett
 *     bälte till hängslena.
 *   · INTE `Version/x.y`            = varje riktig WebKit-webbläsare skriver ut sin
 *     Safari-version. Förfalskningen gör det inte.
 * ⛔ Googlebot/Bingbot rörs INTE: de använder `AppleWebKit/537.36` och står dessutom
 * utanför namnlistan med flit. Vaktat av tests/unit/blocked-bots.test.ts.
 *
 * ⚠️ DEN HÄR REGELN ÅLDRAS OCKSÅ. Nästa svep kan välja en KORREKT Chrome-sträng, och då
 * finns ingen UA-signal kvar — då är rätt verktyg edge-nivå (Cloudflare) eller att göra
 * katalogsidorna DB-fria, inte en fjärde regex. Mätt samma dygn: ett andra svep (107
 * hämtningar, 49 IP:n, 100 % katalog) använde redan en fullt giltig Chrome-sträng och
 * går INTE att skilja från en besökare på UA:n. Det lämnas i fred med flit.
 */
export function isForgedBrowserUa(userAgent: string): boolean {
  if (!/AppleWebKit\/6\d\d\./i.test(userAgent)) return false;
  if (!/\bChrome\/\d/i.test(userAgent)) return false;
  if (/\b(CriOS|EdgiOS|FxiOS|OPiOS)\//i.test(userAgent)) return false;
  if (/\bVersion\/\d/i.test(userAgent)) return false;
  return true;
}

export function isBlockedBot(userAgent: string): boolean {
  return BLOCKED_BOTS.test(userAgent) || isForgedBrowserUa(userAgent);
}
