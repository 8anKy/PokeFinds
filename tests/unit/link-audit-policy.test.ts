import { describe, expect, it } from "vitest";
import {
  isDeadStatus,
  isPrunableDeadLink,
  isStoreRefusal,
  PRUNE_MIN_STALE_DAYS,
} from "../../src/lib/link-audit-policy";

/**
 * Länk-revisionen är det enda stället där en rapport RADERAR butiks-offers. De två
 * besluten nedan avgör vad som försvinner, så de är vaktade separat från allt annat.
 */
const now = new Date("2026-08-25T09:00:00Z");
const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000);

describe("statuskoder: avvisad vs död", () => {
  // ⛔ Det HÄR var buggen 2026-08-25: nio friska Leksaksaffären-länkar låg i
  // "SÄKRA fel" (rensningskön) bara för att butiken 403:ar Actions egress-IP.
  it.each([401, 403, 407, 451])("%i = butiken avvisade OSS, aldrig en död länk", (code) => {
    expect(isStoreRefusal(code)).toBe(true);
    expect(isDeadStatus(code)).toBe(false);
  });

  it.each([404, 410])("%i = sidan är borta", (code) => {
    expect(isDeadStatus(code)).toBe(true);
    expect(isStoreRefusal(code)).toBe(false);
  });

  // 429 betyder "för fort", inte "nej till dig" — och har redan gjort sina omförsök.
  it("429 är varken avvisad eller död", () => {
    expect(isStoreRefusal(429)).toBe(false);
    expect(isDeadStatus(429)).toBe(false);
  });

  it("200 är varken", () => {
    expect(isStoreRefusal(200)).toBe(false);
    expect(isDeadStatus(200)).toBe(false);
  });
});

describe("auto-rensning kräver TVÅ signaler", () => {
  it("rensar när sidan är död OCH raden fallit ur feeden", () => {
    expect(isPrunableDeadLink({ dead: true, lastSeenAt: daysAgo(8), now })).toBe(true);
  });

  // Signal 2 utan signal 1: butiken kan ha byggt om sidan i går. Rapporteras, rensas ej.
  it("rensar INTE en död sida vars rad fortfarande är färsk i feeden", () => {
    expect(isPrunableDeadLink({ dead: true, lastSeenAt: daysAgo(2), now })).toBe(false);
  });

  // Signal 1 utan signal 2: en butik kan tappa en vara ur feeden utan att sidan dör
  // (slutsåld, tillfälligt dold). Frånvaro TOLKAS aldrig — den måste verifieras.
  it("rensar INTE en gammal rad vars sida fortfarande svarar", () => {
    expect(isPrunableDeadLink({ dead: false, lastSeenAt: daysAgo(400), now })).toBe(false);
  });

  it("gränsen ligger på minStaleDays, inte runt den", () => {
    expect(isPrunableDeadLink({ dead: true, lastSeenAt: daysAgo(PRUNE_MIN_STALE_DAYS + 0.1), now })).toBe(true);
    expect(isPrunableDeadLink({ dead: true, lastSeenAt: daysAgo(PRUNE_MIN_STALE_DAYS - 0.1), now })).toBe(false);
  });

  it("respekterar en egen tröskel", () => {
    expect(isPrunableDeadLink({ dead: true, lastSeenAt: daysAgo(3), now, minStaleDays: 1 })).toBe(true);
    expect(isPrunableDeadLink({ dead: true, lastSeenAt: daysAgo(3), now, minStaleDays: 30 })).toBe(false);
  });

  // Standarden ger "två röda veckor" i praktiken: en vara som avlistas mellan två
  // måndagskörningar hinner alltid rapporteras minst en gång innan den rensas.
  it("standardtröskeln är en vecka", () => {
    expect(PRUNE_MIN_STALE_DAYS).toBe(7);
  });
});
