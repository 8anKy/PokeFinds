/**
 * "Är den här klienten en crawler som kör JavaScript?" — KLIENTSIDANS fråga.
 *
 * Produktsidan är ett DB-fritt skal (ISR, 30 dygn) och hämtar priset först vid
 * montering. Googlebot renderar JavaScript och hade annars gjort exakt den
 * hämtningen på varje sida i sitt svep — och varje sådan hämtning är en
 * Neon-fråga, dvs samma väckning vi tog priset ur HTML:en för att slippa. En
 * crawler får därför skalet som det är (namn, set, bild, brödsmulor) och "–" som
 * pris. Det är ingen cloaking: samma HTML, samma innehåll — vi utelämnar en
 * XHR som ändå bara skulle visa ett tal Google inte litar på.
 *
 * ⛔ INGEN BAR `bot`-matchning. Cubot-telefoner skriver "CUBOT" i sin UA, och en
 * riktig besökare utan pris är ett fel, inte en besparing. Listan är NAMNGIVNA
 * crawlers + två renderingsmotorer utan användare (HeadlessChrome, Lighthouse).
 *
 * Spegelbilden av `blocked-bots.ts` (som avgör vem som får 403 i middleware):
 * den här listan innehåller MED FLIT Googlebot/Bingbot — de ska ha sidan, bara
 * inte fetchen.
 */
import { BLOCKED_BOTS } from "@/lib/blocked-bots";

export const CRAWLER_UA =
  /Googlebot|Google-InspectionTool|Storebot-Google|Mediapartners-Google|AdsBot-Google|APIs-Google|bingbot|BingPreview|DuckDuckBot|Slurp|YandexBot|Baiduspider|Applebot|PetalBot|SeznamBot|facebookexternalhit|Twitterbot|Discordbot|LinkedInBot|Pinterestbot|WhatsApp|TelegramBot|Slackbot|SkypeUriPreview|AhrefsBot|SemrushBot|MJ12bot|DotBot|Screaming Frog|HeadlessChrome|Lighthouse|Chrome-Lighthouse|PhantomJS|Prerender|GPTBot|ClaudeBot|PerplexityBot|CCBot|Bytespider/i;

export function isCrawlerUserAgent(userAgent: string | null | undefined): boolean {
  if (!userAgent) return false;
  // Namnlistan från middleware ingår: får en blockerad bot ändå in (ny väg, ny
  // UA-variant som bara den listan känner) ska den inte heller få fetchen.
  return CRAWLER_UA.test(userAgent) || BLOCKED_BOTS.test(userAgent);
}

/** Klientsidans helhetsbedömning: UA-listan + WebDriver-flaggan (automatiserade webbläsare). */
export function isCrawlerClient(nav: Pick<Navigator, "userAgent" | "webdriver"> | undefined): boolean {
  if (!nav) return false;
  if (nav.webdriver) return true;
  return isCrawlerUserAgent(nav.userAgent);
}
