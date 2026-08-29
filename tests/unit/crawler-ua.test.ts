import { describe, expect, it } from "vitest";
import { isCrawlerClient, isCrawlerUserAgent } from "@/lib/crawler-ua";
import { BLOCKED_BOTS } from "@/lib/blocked-bots";

const GOOGLEBOT =
  "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Googlebot/2.1; +http://www.google.com/bot.html) Chrome/139.0.0.0 Safari/537.36";
const GOOGLEBOT_MOBILE =
  "Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";
const CHROME_WIN =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36";
const SAFARI_IOS =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const CUBOT =
  "Mozilla/5.0 (Linux; Android 13; CUBOT KINGKONG 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";
const CAPACITOR_WEBVIEW =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148";

describe("isCrawlerUserAgent", () => {
  it("känner igen JS-renderande crawlers och förhandsvisare", () => {
    for (const ua of [GOOGLEBOT, GOOGLEBOT_MOBILE, "Mozilla/5.0 (compatible; bingbot/2.0)", "Discordbot/2.0", "facebookexternalhit/1.1", "HeadlessChrome/120"]) {
      expect(isCrawlerUserAgent(ua), ua).toBe(true);
    }
  });

  it("släpper igenom riktiga besökare — även telefoner med 'bot' i namnet", () => {
    for (const ua of [CHROME_WIN, SAFARI_IOS, CUBOT, CAPACITOR_WEBVIEW, "", null, undefined]) {
      expect(isCrawlerUserAgent(ua), String(ua)).toBe(false);
    }
  });

  it("allt som middleware blockerar med namn räknas också som crawler här (ingen fetch om de ändå kommer in)", () => {
    // Namnlistan är en alternation av substrängar; varje namn ska ge true.
    const names = BLOCKED_BOTS.source.split("|").filter((n) => /^[A-Za-z0-9 _-]+$/.test(n));
    expect(names.length).toBeGreaterThan(20);
    const misses = names.filter((n) => !isCrawlerUserAgent(`Mozilla/5.0 (compatible; ${n}/1.0)`));
    // De här är HTTP-bibliotek, inte crawlers med JS — de kör aldrig fetchen ändå.
    const knownNonJs = new Set(["python-requests", "Scrapy", "node-fetch", "Go-http-client", "libwww-perl"]);
    expect(misses.filter((n) => !knownNonJs.has(n))).toEqual([]);
  });
});

describe("isCrawlerClient", () => {
  it("WebDriver-flaggan räcker (automatiserad webbläsare)", () => {
    expect(isCrawlerClient({ userAgent: CHROME_WIN, webdriver: true })).toBe(true);
    expect(isCrawlerClient({ userAgent: CHROME_WIN, webdriver: false })).toBe(false);
    expect(isCrawlerClient(undefined)).toBe(false);
  });
});
