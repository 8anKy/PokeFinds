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
  /Applebot|GPTBot|OAI-SearchBot|ChatGPT-User|ClaudeBot|Claude-Web|Claude-SearchBot|Claude-User|anthropic-ai|CCBot|Bytespider|AhrefsBot|SemrushBot|DataForSeoBot|MJ12bot|Amazonbot|Meta-ExternalAgent|Meta-WebIndexer|GoogleOther|PerplexityBot|Perplexity-User|YandexBot|Baiduspider|SeznamBot|DotBot|BLEXBot|Barkrowler|ImagesiftBot|Timpibot|Diffbot|omgili|Screaming Frog|python-requests|Scrapy|node-fetch|Go-http-client|libwww-perl/i;
// Claude-SearchBot: NY Anthropic-UA (matchas inte av ClaudeBot/Claude-Web) — svepte
// katalogen i 5,7 req/s från EN IP 2026-08-09 och stod för 63 % av ALL trafik; höll
// ensam Neon vaken dygnet runt. GoogleOther: Googles icke-sök-crawler (R&D/AI) — 28 %
// av trafiken samma dygn. Blockera den påverkar INTE sökindexeringen (Googlebot är
// en annan UA och står medvetet utanför listan).

export function isBlockedBot(userAgent: string): boolean {
  return BLOCKED_BOTS.test(userAgent);
}
