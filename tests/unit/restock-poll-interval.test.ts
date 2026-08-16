import { describe, expect, it } from "vitest";
import { pollIntervalMs, type PollBudget } from "@/lib/restock-poll-interval";

/**
 * ARTIGHETSTAKET (2026-08-16). Discord-lanen delade tidigare in butikerna efter
 * PLATTFORM ("Shopify varje minut, egna servrar varannan"), som om alla feedar
 * kostade lika mycket att hämta. Testet vaktar den egenskap som ersatte den
 * indelningen: en butiks SUSTAINED förfrågningstakt får aldrig överstiga
 * 1/`perRequestSeconds`, hur feeden än är formad.
 */
const CDN: PollBudget = {
  perRequestSeconds: 2.5,
  floorSeconds: 25,
  ceilSeconds: 240,
  unmeasuredSeconds: 60,
};
const OWN: PollBudget = {
  perRequestSeconds: 6,
  floorSeconds: 60,
  ceilSeconds: 240,
  unmeasuredSeconds: 60,
};

describe("pollIntervalMs", () => {
  it("en dyr feed pollas SÄLLAN — taket är förfrågningar, inte sekunder", () => {
    // 30 kollektionsanrop × 2,5 s = 75 s. Den gamla modellen gav samma butik 60 s
    // oavsett hur många anrop den kostade.
    expect(pollIntervalMs(30, CDN)).toBe(75_000);
  });

  it("en billig feed pollas OFTARE — men aldrig snabbare än golvet", () => {
    // 2 sidhämtningar × 2,5 s = 5 s ⇒ golvet 25 s vinner. Ingen butik har bett om
    // en hämtning var femte sekund, och det köper inget: en påfyllning som upptäcks
    // inom en halv minut är redan snabbare än varje mejlbaserad väg.
    expect(pollIntervalMs(2, CDN)).toBe(25_000);
  });

  it("egna servrar får dubbelt så generöst tak som CDN", () => {
    // Skillnaden är VEM SOM BETALAR: Shopifys CDN möter hela deras kundtrafik,
    // medan en Quickbutik-server konkurrerar med butikens riktiga besökare.
    expect(pollIntervalMs(20, CDN)).toBe(50_000);
    expect(pollIntervalMs(20, OWN)).toBe(120_000);
  });

  it("taket hindrar att en absurd feed pollas en gång i timmen", () => {
    expect(pollIntervalMs(500, CDN)).toBe(240_000);
  });

  it("OMÄTT (första varvet) ger den gamla takten, aldrig noll", () => {
    // ⛔ 0 får ALDRIG tolkas som "gratis att hämta" — det betyder "vi vet inte än".
    expect(pollIntervalMs(0, CDN)).toBe(60_000);
    expect(pollIntervalMs(-1, CDN)).toBe(60_000);
    expect(pollIntervalMs(Number.NaN, CDN)).toBe(60_000);
  });

  it("den sammanlagda takten mot en butik överstiger aldrig taket", () => {
    for (const requests of [1, 3, 10, 25, 60, 200]) {
      const seconds = pollIntervalMs(requests, CDN) / 1000;
      // Vid taket (ceil) är butiken redan så dyr att vi medvetet backar; annars
      // måste kvoten hålla.
      if (seconds < CDN.ceilSeconds) {
        expect(requests / seconds).toBeLessThanOrEqual(1 / CDN.perRequestSeconds + 1e-9);
      }
    }
  });
});
