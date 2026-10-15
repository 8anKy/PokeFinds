import { describe, expect, it } from "vitest";
import { ctImageProxyUrl, ctImageSourceUrl, isValidCtImageFile } from "@/lib/ct-image";

describe("CardTrader-bildproxyn är ingen öppen proxy", () => {
  it("bara ett rent filnamn släpps igenom", () => {
    expect(isValidCtImageFile("team-rocket-s-moltres-ex-229.jpg")).toBe(true);
    expect(isValidCtImageFile("../../etc/passwd")).toBe(false);
    expect(isValidCtImageFile("a/b.jpg")).toBe(false);
    expect(isValidCtImageFile("x.svg")).toBe(false);
    expect(isValidCtImageFile("")).toBe(false);
  });
  it("blueprintets image.url blir vår proxy, källan är show_-versionen hos CardTrader", () => {
    expect(ctImageProxyUrl(357913, "/uploads/blueprints/image/357913/moltres-229.jpg")).toBe("/api/ct-image/357913?f=moltres-229.jpg");
    expect(ctImageProxyUrl(357913, "/uploads/blueprints/image/111/moltres-229.jpg")).toBeNull(); // fel id
    expect(ctImageProxyUrl(357913, null)).toBeNull();
    expect(ctImageSourceUrl(357913, "moltres-229.jpg")).toBe("https://www.cardtrader.com/uploads/blueprints/image/357913/show_moltres-229.jpg");
  });
});
