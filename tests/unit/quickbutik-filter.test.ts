/**
 * qbShouldDrop: filtrerar bort singel-URL:er som annars fel-länkas till sealed-produkter.
 */
import { describe, expect, it } from "vitest";
import { qbShouldDrop } from "@/scrapers/adapters/quickbutik-adapter";

describe("qbShouldDrop", () => {
  it("släpper singel-URL:er", () => {
    expect(qbShouldDrop("https://www.swepoke.se/pokemon/singles-and-graded-cards/singles/zekrom-ex-nxd-51")).toBe(true);
    expect(qbShouldDrop("https://www.swepoke.se/pokemon/singles/foo")).toBe(true);
  });

  it("behåller sealed-URL:er", () => {
    expect(qbShouldDrop("https://www.swepoke.se/pokemon/booster-box/surging-sparks-booster-box")).toBe(false);
    expect(qbShouldDrop("https://www.swepoke.se/alla-produkter/chaos-rising-elite-trainer-box")).toBe(false);
  });
});
