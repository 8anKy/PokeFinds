import { describe, expect, it } from "vitest";
import {
  communityV2Allowed,
  isGatedPath,
  nativeAppVersion,
} from "@/lib/community-v2-gate";

const IOS_11 =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148";
const IOS_12 = `${IOS_11} FoilioApp/1.2`;
const ANDROID_12 =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/125.0.0.0 Mobile Safari/537.36 wv FoilioApp/1.2";
const DESKTOP =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

describe("nativeAppVersion", () => {
  it("läser versionen ur appens UA-tagg", () => {
    expect(nativeAppVersion(IOS_12)).toBe("1.2");
    expect(nativeAppVersion(ANDROID_12)).toBe("1.2");
    expect(nativeAppVersion(`${DESKTOP} FoilioApp/1.10.3`)).toBe("1.10.3");
  });
  it("null för webbläsare och för den gamla appen utan tagg", () => {
    expect(nativeAppVersion(DESKTOP)).toBeNull();
    expect(nativeAppVersion(IOS_11)).toBeNull();
    expect(nativeAppVersion(null)).toBeNull();
    expect(nativeAppVersion("FoilioApp/")).toBeNull();
  });
});

describe("communityV2Allowed", () => {
  it("stängt för vanliga användare på webben och i App Store-appen (1.1)", () => {
    expect(communityV2Allowed({ userAgent: DESKTOP, role: "USER" })).toBe(false);
    expect(communityV2Allowed({ userAgent: IOS_11, role: "USER" })).toBe(false);
    expect(communityV2Allowed({ userAgent: DESKTOP })).toBe(false);
    // Moderator är INTE admin — bara ägaren/admin testar före lansering.
    expect(communityV2Allowed({ userAgent: DESKTOP, role: "MODERATOR" })).toBe(false);
  });
  it("öppet för admin/superadmin oavsett klient", () => {
    expect(communityV2Allowed({ userAgent: DESKTOP, role: "ADMIN" })).toBe(true);
    expect(communityV2Allowed({ userAgent: IOS_11, role: "SUPERADMIN" })).toBe(true);
  });
  it("öppet för en ny native-byggnad (TestFlight 1.2) även utan roll", () => {
    expect(communityV2Allowed({ userAgent: IOS_12 })).toBe(true);
    expect(communityV2Allowed({ userAgent: ANDROID_12, role: "USER" })).toBe(true);
  });
  it("lanseringsspaken öppnar för alla; bara exakt \"1\" räknas", () => {
    expect(communityV2Allowed({ userAgent: DESKTOP, publicFlag: "1" })).toBe(true);
    expect(communityV2Allowed({ userAgent: IOS_11, role: "USER", publicFlag: " 1 " })).toBe(true);
    expect(communityV2Allowed({ userAgent: DESKTOP, publicFlag: "true" })).toBe(false);
    expect(communityV2Allowed({ userAgent: DESKTOP, publicFlag: "" })).toBe(false);
    expect(communityV2Allowed({ userAgent: DESKTOP, publicFlag: "0" })).toBe(false);
  });
});

describe("isGatedPath", () => {
  it("bevakar forum och meddelanden, inte community-platshållaren", () => {
    expect(isGatedPath("/forum")).toBe(true);
    expect(isGatedPath("/forum/t/abc")).toBe(true);
    expect(isGatedPath("/meddelanden/xyz")).toBe(true);
    expect(isGatedPath("/community")).toBe(false);
    expect(isGatedPath("/forumet")).toBe(false);
  });
});
