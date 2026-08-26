import { describe, it, expect } from "vitest";
import { isBlockedBot, isForgedBrowserUa } from "@/lib/blocked-bots";

/**
 * Regressionsskydd för crawler-blocklistan. Listan är EN 400 tecken lång regex-rad
 * där ett tappat `|` inte syns vid granskning — och konsekvensen (hela katalogen
 * öppen för svep, ~50 Neon-frågor per produktsida) märks först på fakturan.
 *
 * UA-strängarna nedan är RIKTIGA, kopierade ur Railways httpLogs 2026-07-25/26.
 */

// Metas crawlers gömmer sitt namn i ett "(compatible; …)"-suffix EFTER en helt
// vanlig webbläsarsträng. Ett analysverktyg som klipper UA:n vid ~85 tecken
// visar bara "Chrome/145 …" och får trafiken att se ut som riktiga besökare —
// exakt så missades meta-webindexer fram till 2026-07-26.
const META_EXTERNALAGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) " +
  "Chrome/145.0.0.0 Safari/537.36 (compatible; meta-externalagent/1.1; " +
  "+https://developers.facebook.com/docs/sharing/webmasters/crawler)";

const META_WEBINDEXER =
  "Mozilla/5.0 (X11; Linux x86_64; rv:147.0) Gecko/20100101 Firefox/147.0 " +
  "(compatible; meta-webindexer/1.0; +https://developers.facebook.com/docs/sharing/webmasters/crawler)";

describe("blocklistan för bulk-crawlers", () => {
  it("blockar BÅDA Metas bulk-crawlers, inte bara den ena", () => {
    expect(isBlockedBot(META_EXTERNALAGENT)).toBe(true);
    expect(isBlockedBot(META_WEBINDEXER)).toBe(true);
  });

  it("matchar på suffixet även när UA:n börjar som en vanlig webbläsare", () => {
    // Prefixet är oskiljaktigt från en riktig Chrome-besökare — det är bara
    // svansen som avslöjar boten. Faller den här är truncerings-fällan tillbaka.
    expect(META_EXTERNALAGENT.startsWith("Mozilla/5.0 (Windows NT 10.0")).toBe(true);
    expect(isBlockedBot(META_EXTERNALAGENT.slice(0, 85))).toBe(false);
  });

  it.each([
    "Applebot/0.1 (+http://www.apple.com/go/applebot)",
    "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.1; +https://openai.com/gptbot",
    "Mozilla/5.0 (compatible; ClaudeBot/1.0; +claudebot@anthropic.com)",
    // Anthropics NYARE crawler-UA — matchades INTE av ClaudeBot/Claude-Web och svepte
    // katalogen i 5,7 req/s (63 % av all trafik, Railway httpLogs 2026-08-09).
    "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Claude-SearchBot/1.0; +searchbot@anthropic.com)",
    // Googles icke-sök-crawler (28 % av trafiken samma dygn). Sökindexeringen görs av
    // Googlebot (egen UA) och påverkas inte.
    "Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.7871.186 Mobile Safari/537.36 (compatible; GoogleOther)",
    // Amazons NYARE UA. `Amazonbot` stod redan i listan och matchar den INTE — det
    // här testet finns för att en blockerad UA från en leverantör aldrig ska få
    // förväxlas med att leverantören är blockerad. Stod för 35 % av all trafik och
    // mest servertid av alla UA:er (Railway httpLogs 2026-08-22), höll Neon vaken 65 h.
    "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Amzn-SearchBot/0.1) Chrome/119.0.6045.214 Safari/537.36",
    "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ShapBot/0.1.0",
    "Mozilla/5.0 (compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)",
    "Mozilla/5.0 (compatible; Bytespider; spider-feedback@bytedance.com)",
    "Mozilla/5.0 (compatible; AhrefsBot/7.0; +http://ahrefs.com/robot/)",
    "Mozilla/5.0 (compatible; SemrushBot/7~bl; +http://www.semrush.com/bot.html)",
    "python-requests/2.32.3",
    "Scrapy/2.11.0 (+https://scrapy.org)",
    "Go-http-client/2.0",
  ])("blockar lågvärdes-crawlern %s", (ua) => {
    expect(isBlockedBot(ua)).toBe(true);
  });

  it.each([
    // SEO vi VILL ha.
    ["Googlebot", "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)"],
    // Mobil-Googlebot delar Chrome-prefix med GoogleOther — vakten mot att
    // GoogleOther-blocket råkar träffa den riktiga indexeraren.
    [
      "Googlebot (mobil)",
      "Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.7871.186 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
    ],
    ["Bingbot", "Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)"],
    ["DuckDuckBot", "Mozilla/5.0 (compatible; DuckDuckBot-Https/1.1; https://duckduckgo.com/duckduckbot)"],
    // Länkförhandsvisare: hämtar EN delad URL, inte katalogen. Blockas de blir
    // varje delad Foilio-länk en naken URL utan bild i flödet/chatten.
    ["facebookexternalhit", "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)"],
    ["meta-externalfetcher", "meta-externalfetcher/1.1 (+https://developers.facebook.com/docs/sharing/webmasters/crawler)"],
    ["Twitterbot", "Twitterbot/1.0"],
    ["Discordbot", "Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)"],
    ["Slackbot", "Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)"],
    ["WhatsApp", "WhatsApp/2.23.20.0"],
    // Uptime-monitorn får aldrig 403:as — då larmar den om nedtid som inte finns.
    ["UptimeRobot", "Mozilla/5.0+(compatible; UptimeRobot/2.0; http://www.uptimerobot.com/)"],
    // Riktiga besökare.
    ["Chrome på Windows", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36"],
    ["Safari på iPhone", "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1"],
  ])("släpper igenom %s", (_namn, ua) => {
    expect(isBlockedBot(ua)).toBe(false);
  });

  it("är skiftlägesokänslig (butiker/bottar varierar versalisering)", () => {
    expect(isBlockedBot("meta-webindexer/1.0")).toBe(true);
    expect(isBlockedBot("META-WEBINDEXER/1.0")).toBe(true);
  });
});

/**
 * SVEPET UTAN NAMN (mätt 2026-08-26): 416 hämtningar från 321 olika IP-adresser,
 * 99 % `/produkter/[slug]`, aldrig samma slug två gånger. Ingen crawler-signatur att
 * matcha på — men UA:n är fysiskt omöjlig: `AppleWebKit/605.x` är Safaris motor och
 * Chrome rapporterar alltid `AppleWebKit/537.36`.
 *
 * ⛔ FALSKA POSITIVA ÄR DYRARE ÄN FALSKA NEGATIVA HÄR. En felaktig 403 gör sajten helt
 * osynlig för en riktig besökare, och tyst. Varje "släpper igenom"-rad nedan är ett
 * skydd för en äkta webbläsare som verkligen skickar AppleWebKit/6xx.
 */
describe("isForgedBrowserUa: den omöjliga webbläsarsträngen", () => {
  it.each([
    // Exakt strängen ur Railways httpLogs 2026-08-26.
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/605.1.15",
    // Samma omöjlighet med annan version/plattform — svepet byter siffror, inte form.
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/604.1.38 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/604.1",
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/605.1.15",
  ])("blockar %s", (ua) => {
    expect(isForgedBrowserUa(ua)).toBe(true);
    expect(isBlockedBot(ua)).toBe(true);
  });

  it.each([
    // Safari: WebKit-motorn MED sin Version/-token. Får aldrig träffas.
    ["Safari på Mac", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Safari/605.1.15"],
    ["Safari på iPhone", "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1"],
    // Chrome/Edge/Firefox PÅ iOS ÄR WebKit-skal — de har AppleWebKit/605 och en egen
    // märkestoken. Skulle de någon gång också skriva "Chrome/" räddar CriOS-villkoret dem.
    ["Chrome på iOS", "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/145.0.0.0 Mobile/15E148 Safari/604.1"],
    ["Edge på iOS", "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 EdgiOS/132.0.0.0 Mobile/15E148 Safari/605.1.15"],
    ["Firefox på iOS", "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/135.0 Mobile/15E148 Safari/605.1.15"],
    // Facebook-appens WebView: WebKit utan Chrome-token.
    ["Facebook in-app", "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBDV/iPhone15,2]"],
    // Riktig Chrome: Blink, alltså 537.36. Två helt olika tal.
    ["Chrome på Mac", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36"],
    ["Chrome på Android", "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Mobile Safari/537.36"],
    // ⛔ Googlebot får ALDRIG träffas — varken desktop- eller mobil-UA:n.
    ["Googlebot (mobil)", "Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.7871.186 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)"],
    // Smart-TV-webbläsare skriver både Version/ och Chrome/ — men på Blink.
    ["Tizen-TV", "Mozilla/5.0 (SMART-TV; Linux; Tizen 6.0) AppleWebKit/537.36 (KHTML, like Gecko) Version/6.0 Chrome/76.0.3809.146 TV Safari/537.36"],
  ])("släpper igenom %s", (_namn, ua) => {
    expect(isForgedBrowserUa(ua)).toBe(false);
  });

  it("tom UA är inte en förfalskning (den fångas av andra skäl eller inte alls)", () => {
    expect(isForgedBrowserUa("")).toBe(false);
  });
});
