import { describe, expect, it } from "vitest";
import { isSwipeBackDestination, normalizeSwipePathname } from "@/lib/swipe-back-routes";

describe("SwipeBack-rutter", () => {
  it.each([
    "/sets/sv8",
    "/profil/user_1",
    "/forum/g/kop-salj-byt",
    "/forum/t/post_1",
    "/forum/sparade",
    "/nyheter",
    "/evenemang",
    "/nyheter/nytt-i-foilio",
    "/evenemang/stockholm",
    "/meddelanden/conv_1",
    "/skanna",
    "/en/sets/sv8",
    "/sv/forum/t/post_1",
  ])("fångar en tidigare vy för %s", (pathname) => {
    expect(isSwipeBackDestination(pathname)).toBe(true);
  });

  it.each([
    "/sets",
    "/profil",
    "/forum",
    "/forum/ny",
    "/installningar/okand",
    "/produkter/pikachu",
    "/forum/t/post_1/extra",
  ])("kopierar inte sidan för vanlig navigation till %s", (pathname) => {
    expect(isSwipeBackDestination(pathname)).toBe(false);
  });

  it("normaliserar locale-prefix utan att röra resten av vägen", () => {
    expect(normalizeSwipePathname("/en/forum/g/general")).toBe("/forum/g/general");
    expect(normalizeSwipePathname("/sv")).toBe("/");
  });
});
