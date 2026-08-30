/**
 * "Ny version finns"-remsan får BARA tändas när den installerade appen bevisligen
 * är äldre än MIN_APP_VERSION. Allt okänt ⇒ ingen remsa: att tjata på en
 * användare som redan uppdaterat (eller på TestFlight-byggen med ovanliga
 * strängar) är värre än att missa en.
 */
import { describe, expect, it } from "vitest";
import { MIN_APP_VERSION, compareVersions, isOutdatedAppVersion } from "@/lib/app-version";

describe("app-version", () => {
  it("MIN_APP_VERSION är en ren marknadsversion (aldrig build-nummer)", () => {
    expect(MIN_APP_VERSION).toMatch(/^\d+\.\d+$/);
  });

  it("jämför numeriskt per segment, inte som strängar", () => {
    expect(compareVersions("1.0", "1.1")).toBeLessThan(0);
    expect(compareVersions("1.1", "1.1")).toBe(0);
    expect(compareVersions("1.10", "1.9")).toBeGreaterThan(0);
    expect(compareVersions("1.1.1", "1.1")).toBeGreaterThan(0);
    expect(compareVersions("2", "1.9")).toBeGreaterThan(0);
  });

  it("äldre bygge ⇒ remsa; samma eller nyare ⇒ ingen", () => {
    expect(isOutdatedAppVersion("1.0", "1.1")).toBe(true);
    expect(isOutdatedAppVersion("1.1", "1.1")).toBe(false);
    expect(isOutdatedAppVersion("1.2", "1.1")).toBe(false);
    expect(isOutdatedAppVersion("1.1.1", "1.1")).toBe(false);
  });

  it("okänt/otolkbart ⇒ ingen remsa (failar stängt)", () => {
    expect(isOutdatedAppVersion(null)).toBe(false);
    expect(isOutdatedAppVersion(undefined)).toBe(false);
    expect(isOutdatedAppVersion("")).toBe(false);
    expect(isOutdatedAppVersion("1.0-beta")).toBe(false);
    expect(isOutdatedAppVersion("abc")).toBe(false);
    expect(compareVersions("1.0", "x")).toBeNull();
  });
});
