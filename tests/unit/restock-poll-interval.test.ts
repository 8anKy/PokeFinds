import { describe, expect, it } from "vitest";
import { pollBudget, pollIntervalMs, type PollBudget } from "@/lib/restock-poll-interval";

/**
 * ARTIGHETSTAKET (2026-08-16). Discord-lanen delade tidigare in butikerna efter
 * PLATTFORM ("Shopify varje minut, egna servrar varannan"), som om alla feedar
 * kostade lika mycket att hämta. De gör inte det — mätt i drift kostar Pokexclusives
 * feed 1 förfrågan och Rogerz 44.
 *
 * ⛔ VAD TESTET FAKTISKT VAKTAR. Inte "ingen butik får mer last än förut": en butik
 * vars hela feed är EN sidhämtning lyfts med flit från 60 s till golvet 25 s, dvs 2,4
 * gånger fler förfrågningar — det är hela poängen med att mäta, och i absoluta tal är
 * det fortfarande en förfrågan var 25:e sekund. Kravet är att **ingen butik får en
 * högre ihållande takt än den TYNGSTA feeden i sin klass redan fick av den gamla
 * fasta cadencen**. Den takten tålde butikerna bevisligen i drift.
 */
const CDN: PollBudget = {
  perRequestSeconds: 2,
  floorSeconds: 25,
  ceilSeconds: 240,
  unmeasuredSeconds: 60,
};
const OWN: PollBudget = {
  perRequestSeconds: 3.5,
  floorSeconds: 60,
  ceilSeconds: 240,
  unmeasuredSeconds: 60,
};

/** Förfrågningar per hämtning, MÄTT i drift 2026-08-16 över alla 42 butiker. */
const CDN_MEASURED = [1, 2, 3, 5, 7, 8, 9, 11, 12, 13, 15, 17, 24, 26, 37, 44];
const OWN_MEASURED = [1, 2, 3, 4, 5, 6, 8, 11, 26, 34, 37];
/** Den gamla fasta cadencen, som taket kalibrerades mot. */
const OLD_CDN_SECONDS = 60;
const OLD_OWN_SECONDS = 120;

const rate = (requests: number, budget: PollBudget) =>
  requests / (pollIntervalMs(requests, budget) / 1000);

describe("pollIntervalMs", () => {
  it("en dyr feed pollas SÄLLAN — taket är förfrågningar, inte sekunder", () => {
    // 30 kollektionsanrop × 2 s = 60 s. Den gamla modellen gav samma butik 60 s
    // oavsett hur många anrop den kostade — och en två-anropsbutik likaså.
    expect(pollIntervalMs(30, CDN)).toBe(60_000);
  });

  it("en billig feed pollas OFTARE — men aldrig snabbare än golvet", () => {
    // 2 sidhämtningar × 2 s = 4 s ⇒ golvet 25 s vinner. Ingen butik har bett om en
    // hämtning var fjärde sekund, och det köper inget: en påfyllning som upptäcks
    // inom en halv minut är redan snabbare än varje mejlbaserad väg.
    expect(pollIntervalMs(2, CDN)).toBe(25_000);
  });

  it("egna servrar får knappt dubbelt så generöst tak som CDN", () => {
    // Skillnaden är VEM SOM BETALAR: Shopifys CDN möter hela deras kundtrafik,
    // medan en Quickbutik-server konkurrerar med butikens riktiga besökare.
    expect(pollIntervalMs(40, CDN)).toBe(80_000);
    expect(pollIntervalMs(40, OWN)).toBe(140_000);
  });

  /**
   * ⛔ KALIBRERINGSKRAVET. Bryts den här raden har någon sänkt `perRequestSeconds`
   * "för att bli snabbare" — och den butik som blockerar oss skadar HELA produkten,
   * inte bara Discord.
   */
  it("ingen butik får högre takt än klassens TYNGSTA feed fick av gamla cadencen", () => {
    const heaviestCdn = Math.max(...CDN_MEASURED) / OLD_CDN_SECONDS; // Rogerz, 0,73/s
    for (const req of CDN_MEASURED) {
      expect(rate(req, CDN), `CDN ${req} förfrågn.`).toBeLessThanOrEqual(heaviestCdn);
    }
    const heaviestOwn = Math.max(...OWN_MEASURED) / OLD_OWN_SECONDS; // Swepoke, 0,31/s
    for (const req of OWN_MEASURED) {
      expect(rate(req, OWN), `egen server ${req} förfrågn.`).toBeLessThanOrEqual(heaviestOwn);
    }
  });

  it("de TVÅ TYNGSTA feedarna blir politare, inte snabbare", () => {
    // De är också de enda som pollas mer sällan än förut — priset för att sluta låta
    // dem sätta takten för alla 42.
    expect(pollIntervalMs(44, CDN)).toBe(88_000); // Rogerz, var 60 s
    expect(pollIntervalMs(37, OWN)).toBe(129_500); // Swepoke, var 120 s
  });

  it("de HETA, LÄTTA butikerna vinner — det var hela syftet", () => {
    expect(pollIntervalMs(3, CDN)).toBe(25_000); // Dragon's Lair, var 60 s
    expect(pollIntervalMs(17, CDN)).toBe(34_000); // Speltrollet, var 60 s
    expect(pollIntervalMs(24, CDN)).toBe(48_000); // Webhallen, var 60 s
    expect(pollIntervalMs(3, OWN)).toBe(60_000); // NordicTCG, var 120 s
    expect(pollIntervalMs(5, OWN)).toBe(60_000); // Coolcard, var 120 s
    expect(pollIntervalMs(26, OWN)).toBe(91_000); // CardGame, var 120 s
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

  it("den ihållande takten mot en butik överstiger aldrig budgetens tak", () => {
    for (const requests of [1, 3, 10, 25, 60, 200]) {
      const seconds = pollIntervalMs(requests, CDN) / 1000;
      // Vid taket (ceil) är butiken redan så dyr att vi medvetet backar; annars
      // måste kvoten hålla.
      if (seconds < CDN.ceilSeconds) {
        expect(requests / seconds).toBeLessThanOrEqual(1 / CDN.perRequestSeconds + 1e-9);
      }
    }
  });

  it("defaulterna i pollBudget är de kalibrerade, inte några andra", () => {
    // Testerna ovan kör på LITERALER så de dokumenterar avvägningen; den här raden
    // fångar att någon ändrar defaulten utan att räkna om kalibreringen.
    expect(pollBudget(true).perRequestSeconds).toBe(CDN.perRequestSeconds);
    expect(pollBudget(false).perRequestSeconds).toBe(OWN.perRequestSeconds);
    expect(pollBudget(true).floorSeconds).toBe(CDN.floorSeconds);
    expect(pollBudget(false).floorSeconds).toBe(OWN.floorSeconds);
  });
});
