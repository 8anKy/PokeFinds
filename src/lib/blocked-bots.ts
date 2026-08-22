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

export function isBlockedBot(userAgent: string): boolean {
  return BLOCKED_BOTS.test(userAgent);
}
