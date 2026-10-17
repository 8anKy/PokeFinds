import { describe, expect, it } from "vitest";
import { appPlatformFrom, signupPlatformFrom } from "@/lib/signup-platform";

const IOS_APP = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 FoilioApp/1.5";
const ANDROID_APP = "Mozilla/5.0 (Linux; Android 15; Pixel 8; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/129.0 Mobile Safari/537.36 FoilioApp/1.5";
const ANDROID_WEB = "Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36";

describe("var kontot skapades", () => {
  it("appens UA-tagg: Android-WebView ⇒ android, annars ios", () => {
    expect(signupPlatformFrom(ANDROID_APP)).toBe("android");
    expect(signupPlatformFrom(IOS_APP)).toBe("ios");
  });
  it("utan taggen är det webben — även Chrome på en Android-telefon", () => {
    expect(signupPlatformFrom(ANDROID_WEB)).toBe("web");
    expect(signupPlatformFrom(null)).toBe("web");
  });
  it("enhets-id:t vinner över UA:n", () => {
    expect(signupPlatformFrom(IOS_APP, "and-0123456789abcdef")).toBe("android");
    expect(signupPlatformFrom(null, "3f2b8c1e-1d2a-4b3c-8d4e-5f6a7b8c9d0e")).toBe("ios");
  });
});

describe("vilken app kontot används i (User.appPlatform)", () => {
  it("appen ger sin plattform, en webbläsare ger null — aldrig \"web\"", () => {
    expect(appPlatformFrom(ANDROID_APP)).toBe("android");
    expect(appPlatformFrom(IOS_APP)).toBe("ios");
    expect(appPlatformFrom(ANDROID_WEB)).toBeNull();
    expect(appPlatformFrom(undefined)).toBeNull();
  });
});
