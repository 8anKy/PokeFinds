/**
 * TYSTA TIMMAR FÖR PRISLARM (2026-09-28): cardmarket-refresh går på natten, och dess
 * prislarmsvep hade annars pushat kl 03–04 svensk tid. 22–07 svensk tid ⇒ vänta till 07:00.
 * Restock-larm rörs inte (de är ett lopp på minuter).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { priceAlertQuietUntil } from "@/lib/quiet-hours";

const at = (iso: string) => new Date(iso);

describe("priceAlertQuietUntil", () => {
  it("dagtid (07–22 svensk tid) ⇒ null, skicka direkt", () => {
    // CEST = UTC+2: 07:00 lokal = 05:00 UTC, 21:59 lokal = 19:59 UTC.
    expect(priceAlertQuietUntil(at("2026-09-28T05:00:00Z"))).toBeNull();
    expect(priceAlertQuietUntil(at("2026-09-28T12:00:00Z"))).toBeNull();
    expect(priceAlertQuietUntil(at("2026-09-28T19:59:00Z"))).toBeNull();
  });

  it("natten efter midnatt ⇒ samma morgon 07:00 (sommartid)", () => {
    // cardmarket-refreshens svep: ~02:00 UTC = 04:00 lokal.
    expect(priceAlertQuietUntil(at("2026-09-29T02:00:00Z"))?.toISOString()).toBe("2026-09-29T05:00:00.000Z");
  });

  it("kvällen ⇒ NÄSTA morgon 07:00", () => {
    // hot-card-refresh: ~23:30 UTC = 01:30 lokal ⇒ samma natt; 20:30 UTC = 22:30 lokal ⇒ imorgon.
    expect(priceAlertQuietUntil(at("2026-09-28T20:30:00Z"))?.toISOString()).toBe("2026-09-29T05:00:00.000Z");
    expect(priceAlertQuietUntil(at("2026-09-28T23:30:00Z"))?.toISOString()).toBe("2026-09-29T05:00:00.000Z");
  });

  it("vintertid (CET = UTC+1): 07:00 lokal = 06:00 UTC", () => {
    expect(priceAlertQuietUntil(at("2026-11-10T02:00:00Z"))?.toISOString()).toBe("2026-11-10T06:00:00.000Z");
    expect(priceAlertQuietUntil(at("2026-11-10T06:00:00Z"))).toBeNull();
  });

  it("natten då sommartiden tar slut (25 okt 2026) landar på rätt 07:00", () => {
    // 22:30 lokal den 24:e (CEST) ⇒ 07:00 lokal den 25:e, som då är CET.
    expect(priceAlertQuietUntil(at("2026-10-24T20:30:00Z"))?.toISOString()).toBe("2026-10-25T06:00:00.000Z");
  });

  it("prislarmen bär notBefore; en notis om 'Pro fick det för N min sedan' gäller bara restock", () => {
    const alerts = readFileSync(resolve(__dirname, "../../src/services/alerts.ts"), "utf8");
    expect(alerts).toMatch(/const notBefore = priceAlertQuietUntil\(now\)/);
    const notifications = readFileSync(resolve(__dirname, "../../src/services/notifications.ts"), "utf8");
    expect(notifications).toMatch(/isPriceAlert \? null : freeDelayMinutes\(alert\)/);
  });
});
