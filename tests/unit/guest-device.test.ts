import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  GUEST_SCAN_LIMIT,
  deviceMonthScans,
  guestQuotaOf,
  mergedMonthUsed,
  monthKeyOf,
  readDeviceId,
} from "@/lib/guest-device";

/**
 * Gästskanning (2026-08-29): 10 skanningar utan konto per ENHET, sedan 20 till
 * med konto (30/mån). Det som får gå sönder tyst här är att ett nytt konto på
 * samma telefon får en ny kvot — därför räknar kontokvoten max(konto, enhet).
 */
const ROOT = resolve(__dirname, "../..");

describe("enhets-id ur headern", () => {
  const h = (v?: string) => new Headers(v ? { "x-foilio-device": v } : {});
  it("tar UUID v4 (iOS Keychain) och and-<hex> (ANDROID_ID), inget annat", () => {
    expect(readDeviceId(h("3F2504E0-4F89-41D3-9A0C-0305E82C3301"))).toBe(
      "3f2504e0-4f89-41d3-9a0c-0305e82c3301"
    );
    expect(readDeviceId(h("and-9774d56d682e549c"))).toBe("and-9774d56d682e549c");
    expect(readDeviceId(h("hello"))).toBeNull();
    expect(readDeviceId(h("and-zz"))).toBeNull();
    expect(readDeviceId(h("<script>"))).toBeNull();
    expect(readDeviceId(h())).toBeNull();
  });
});

describe("kvotmodellen", () => {
  it("gäst: 10 livstid, aldrig negativt", () => {
    expect(GUEST_SCAN_LIMIT).toBe(10);
    expect(guestQuotaOf(0)).toEqual({ used: 0, limit: 10, remaining: 10 });
    expect(guestQuotaOf(10).remaining).toBe(0);
    expect(guestQuotaOf(14).remaining).toBe(0);
  });

  it("enhetens månad nollas när raden är från en annan månad", () => {
    const now = new Date("2026-08-29T12:00:00Z");
    expect(monthKeyOf(now)).toBe("2026-08");
    expect(deviceMonthScans({ monthKey: "2026-08", monthScans: 7 }, now)).toBe(7);
    expect(deviceMonthScans({ monthKey: "2026-07", monthScans: 7 }, now)).toBe(0);
    expect(deviceMonthScans(null, now)).toBe(0);
    // UTC-gräns, inte lokal: 23:30 den 31:a i Stockholm är redan september UTC?
    // Nej — 21:30Z den 31:a är fortfarande augusti. Nyckeln följer UTC som
    // startOfMonthUtc(), så de två räknarna aldrig glider isär.
    expect(monthKeyOf(new Date("2026-08-31T23:30:00Z"))).toBe("2026-08");
    expect(monthKeyOf(new Date("2026-09-01T00:00:00Z"))).toBe("2026-09");
  });

  it("konto + enhet = MAX, inte summan: 10 som gäst + 0 som konto ⇒ 20 kvar av 30", () => {
    expect(30 - mergedMonthUsed(0, 10)).toBe(20);
    // Inloggade skanningar räknas på båda sidor — får inte dubbelräknas.
    expect(mergedMonthUsed(15, 25)).toBe(25);
    // Raderat konto, nytt konto samma månad: kontot 0, enheten 30 ⇒ 0 kvar.
    expect(30 - mergedMonthUsed(0, 30)).toBe(0);
  });
});

describe("kopplingarna som inte syns i typerna", () => {
  it("GuestDevice överlever kontoradering (SetNull) och ScannerJob gör det inte (Cascade)", () => {
    const schema = readFileSync(resolve(ROOT, "prisma/schema.prisma"), "utf8");
    const guest = schema.slice(schema.indexOf("model GuestDevice {"), schema.indexOf("model ScannerJob {"));
    expect(guest).toContain("onDelete: SetNull");
    expect(guest).not.toContain("Cascade");
  });

  it("skannern ligger utanför (app) — annars redirectar serverlayouten gästen till login", () => {
    expect(() => readFileSync(resolve(ROOT, "src/app/[locale]/(scan)/skanna/page.tsx"))).not.toThrow();
    const layout = readFileSync(resolve(ROOT, "src/app/[locale]/(scan)/layout.tsx"), "utf8");
    expect(layout).not.toContain("auth()");
    expect(layout).not.toContain("redirect(");
  });

  it("skanner-anropen bär enhets-headern (annars finns ingen gäst)", () => {
    const page = readFileSync(resolve(ROOT, "src/app/[locale]/(scan)/skanna/page.tsx"), "utf8");
    for (const url of ["/api/scanner/quota", "/api/scanner/identify\"", "/api/scanner/identify-art", "/api/scanner/identify-gtin"]) {
      expect(page).toContain(`scanFetch("${url}`);
      expect(page).not.toContain(`fetch("${url}`);
    }
  });
});
