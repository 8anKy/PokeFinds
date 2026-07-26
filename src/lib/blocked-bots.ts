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
  /Applebot|GPTBot|OAI-SearchBot|ChatGPT-User|ClaudeBot|Claude-Web|anthropic-ai|CCBot|Bytespider|AhrefsBot|SemrushBot|DataForSeoBot|MJ12bot|Amazonbot|Meta-ExternalAgent|Meta-WebIndexer|PerplexityBot|Perplexity-User|YandexBot|Baiduspider|SeznamBot|DotBot|BLEXBot|Barkrowler|ImagesiftBot|Timpibot|Diffbot|omgili|Screaming Frog|python-requests|Scrapy|node-fetch|Go-http-client|libwww-perl/i;

export function isBlockedBot(userAgent: string): boolean {
  return BLOCKED_BOTS.test(userAgent);
}
