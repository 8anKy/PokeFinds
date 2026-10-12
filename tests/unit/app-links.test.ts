import { describe, expect, it } from "vitest";
import { appLinkPath } from "@/lib/app-links";

describe("appLinkPath (universal links → sida i appen)", () => {
  it("mejlknappen till en produkt öppnar produktsidan i appen", () => {
    expect(appLinkPath("https://scoutr.se/produkter/30th-celebration-elite-trainer-box")).toBe(
      "/produkter/30th-celebration-elite-trainer-box"
    );
  });

  it("behåller frågesträng och ankare, och www räknas som scoutr.se", () => {
    expect(appLinkPath("https://www.scoutr.se/samling?parm=abc#set")).toBe("/samling?parm=abc#set");
  });

  it("startsidan blir '/'", () => {
    expect(appLinkPath("https://scoutr.se")).toBe("/");
  });

  it("API-vägar öppnas aldrig i appen (OAuth-callbacks, webhooks)", () => {
    expect(appLinkPath("https://scoutr.se/api/auth/callback/apple")).toBeNull();
    expect(appLinkPath("https://scoutr.se/api")).toBeNull();
  });

  it("andra värdar, http och skräp ger null — aldrig en öppen omdirigering", () => {
    expect(appLinkPath("https://evil.example/produkter/x")).toBeNull();
    expect(appLinkPath("https://scoutr.se.evil.example/x")).toBeNull();
    expect(appLinkPath("http://scoutr.se/produkter/x")).toBeNull();
    expect(appLinkPath("se.foilio.app://open")).toBeNull();
    expect(appLinkPath("inte en url")).toBeNull();
    expect(appLinkPath(undefined)).toBeNull();
  });
});
