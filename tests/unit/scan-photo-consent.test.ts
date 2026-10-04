/** "Dela mina skanningsbilder" — samtycket är en servertidsstämpel, av som standard. */
import { describe, expect, it } from "vitest";
import { SCAN_PHOTO_CONSENT_KEY, scanPhotoConsent } from "@/lib/scan-photo-consent";

describe("scanPhotoConsent", () => {
  it("av som standard — saknad, tom eller fel typ räknas aldrig som samtycke", () => {
    expect(scanPhotoConsent(null)).toBe(false);
    expect(scanPhotoConsent({})).toBe(false);
    expect(scanPhotoConsent({ [SCAN_PHOTO_CONSENT_KEY]: "" })).toBe(false);
    expect(scanPhotoConsent({ [SCAN_PHOTO_CONSENT_KEY]: true })).toBe(false);
    expect(scanPhotoConsent("ja")).toBe(false);
  });
  it("en tidsstämpel = samtycke", () => {
    expect(scanPhotoConsent({ [SCAN_PHOTO_CONSENT_KEY]: "2026-10-04T20:00:00.000Z" })).toBe(true);
  });
});
