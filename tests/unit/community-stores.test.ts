import { describe, expect, it } from "vitest";
import { distanceMeters, nearbyAtSubmit, reportIsFresh, storeIdentity, storeReportSchema, storeSuggestionSchema, validVisitTime, type StoreReportInput } from "@/lib/community-stores";

const now = Date.parse("2026-10-03T12:00:00Z");
const store = { latitude: 59.33, longitude: 18.06 };
const report: StoreReportInput = { storeId: "branch", productLabel: "Booster bundle", observation: "SEEN", observedAt: new Date(now).toISOString() };

describe("local store observations", () => {
  it("keeps branches distinct and normalizes case/spacing", () => {
    expect(storeIdentity("Kortbutik", "Storgatan 1", "Gävle")).toBe(storeIdentity(" KORTBUTIK ", "Storgatan  1", "Gävle"));
    expect(storeIdentity("Kortbutik", "Storgatan 1", "Gävle")).not.toBe(storeIdentity("Kortbutik", "Storgatan 2", "Gävle"));
  });
  it("ages the visit, not publication or comments, exactly at 12h", () => {
    expect(reportIsFresh(new Date(now - 12 * 3600000 + 1).toISOString(), now)).toBe(true);
    expect(reportIsFresh(new Date(now - 12 * 3600000).toISOString(), now)).toBe(false);
    expect(reportIsFresh(new Date(now + 1).toISOString(), now)).toBe(false);
    expect(reportIsFresh("invalid", now)).toBe(false);
  });
  it("accepts home reports but rejects future/older-than-seven-day visits", () => {
    expect(validVisitTime(report.observedAt, now)).toBe(true);
    expect(validVisitTime(new Date(now - 7 * 86400000).toISOString(), now)).toBe(true);
    expect(validVisitTime(new Date(now - 7 * 86400000 - 1).toISOString(), now)).toBe(false);
    expect(validVisitTime(new Date(now + 1).toISOString(), now)).toBe(false);
  });
  it("does not infer a proximity signal without coordinates and recent precise GPS", () => {
    const location = { ...store, accuracy: 10, sampledAt: report.observedAt };
    expect(nearbyAtSubmit(store, report, now)).toBe(false);
    expect(nearbyAtSubmit(store, { ...report, location }, now)).toBe(true);
    expect(nearbyAtSubmit({ latitude: null, longitude: null }, { ...report, location }, now)).toBe(false);
    expect(nearbyAtSubmit(store, { ...report, location: { ...location, accuracy: 101 } }, now)).toBe(false);
    expect(nearbyAtSubmit(store, { ...report, location: { ...location, latitude: 59.4 } }, now)).toBe(false);
    expect(nearbyAtSubmit(store, { ...report, observedAt: new Date(now - 11 * 60000).toISOString(), location }, now)).toBe(false);
    expect(nearbyAtSubmit(store, { ...report, location: { ...location, sampledAt: new Date(now - 3 * 60000).toISOString() } }, now)).toBe(false);
  });
  it("includes accuracy in the distance boundary", () => {
    const location = { latitude: store.latitude + 0.0018, longitude: store.longitude, accuracy: 100, sampledAt: report.observedAt };
    expect(distanceMeters(store, location)).toBeLessThan(250);
    expect(nearbyAtSubmit(store, { ...report, location }, now)).toBe(false);
  });
  it("requires coordinate pairs and limits all user-controlled fields", () => {
    expect(storeSuggestionSchema.safeParse({ name: "Shop", address: "Street 1", city: "City", latitude: 59 }).success).toBe(false);
    expect(storeReportSchema.safeParse({ ...report, observation: "IN_STOCK" }).success).toBe(false);
    expect(storeReportSchema.safeParse(report).success).toBe(true);
    expect(storeReportSchema.safeParse({ ...report, location: { ...store, accuracy: -1, sampledAt: report.observedAt } }).success).toBe(false);
  });
});
