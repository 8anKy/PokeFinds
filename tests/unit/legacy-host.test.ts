import { describe, expect, it } from "vitest";
import { isNativeAppUserAgent, legacyHostRedirect } from "@/lib/legacy-host";

const CHROME =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const SAFARI_IOS =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const WKWEBVIEW_OLD_APP =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148";
const IOS_APP_TAGGED = `${WKWEBVIEW_OLD_APP} FoilioApp/1.4`;
const ANDROID_WEBVIEW =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/130.0 Mobile Safari/537.36";
const GOOGLEBOT = "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";

describe("legacyHostRedirect", () => {
  it("is off without a target", () => {
    expect(legacyHostRedirect("foilio.se", "/produkter", CHROME, undefined)).toBeNull();
    expect(legacyHostRedirect("foilio.se", "/produkter", CHROME, "  ")).toBeNull();
  });

  it("redirects browsers and crawlers on the old host, keeping path and query", () => {
    expect(legacyHostRedirect("foilio.se", "/produkter/x?q=1", CHROME, "https://scoutr.se")).toBe(
      "https://scoutr.se/produkter/x?q=1"
    );
    expect(legacyHostRedirect("www.foilio.se", "/en/sets", SAFARI_IOS, "https://scoutr.se/")).toBe(
      "https://scoutr.se/en/sets"
    );
    expect(legacyHostRedirect("FOILIO.SE:443", "/", GOOGLEBOT, "https://scoutr.se")).toBe("https://scoutr.se/");
  });

  it("never redirects the installed apps", () => {
    for (const ua of [WKWEBVIEW_OLD_APP, IOS_APP_TAGGED, ANDROID_WEBVIEW]) {
      expect(legacyHostRedirect("foilio.se", "/produkter", ua, "https://scoutr.se")).toBeNull();
    }
  });

  it("leaves the new host alone", () => {
    expect(legacyHostRedirect("scoutr.se", "/produkter", CHROME, "https://scoutr.se")).toBeNull();
  });
});

describe("isNativeAppUserAgent", () => {
  it("tells apps from browsers", () => {
    expect(isNativeAppUserAgent(IOS_APP_TAGGED)).toBe(true);
    expect(isNativeAppUserAgent(`${WKWEBVIEW_OLD_APP} ScoutrApp/1.5`)).toBe(true);
    expect(isNativeAppUserAgent(WKWEBVIEW_OLD_APP)).toBe(true);
    expect(isNativeAppUserAgent(ANDROID_WEBVIEW)).toBe(true);
    expect(isNativeAppUserAgent(SAFARI_IOS)).toBe(false);
    expect(isNativeAppUserAgent(CHROME)).toBe(false);
    expect(isNativeAppUserAgent(GOOGLEBOT)).toBe(false);
  });
});
