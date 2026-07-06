/**
 * qbDropReason: filtrerar bort singel-URL:er (fel-länkas till sealed) och
 * platshållar-priser (Swepoke vintage-junk) ur Quickbutik-feeden.
 */
import { describe, expect, it } from "vitest";
import { qbDropReason } from "@/scrapers/adapters/quickbutik-adapter";

describe("qbDropReason", () => {
  it("släpper singel-URL:er", () => {
    expect(qbDropReason("https://www.swepoke.se/pokemon/singles-and-graded-cards/singles/zekrom-ex-nxd-51", 10000)).toBe("single");
    expect(qbDropReason("https://www.swepoke.se/pokemon/singles/foo", 10000)).toBe("single");
  });

  it("släpper platshållar-priser över taket", () => {
    expect(qbDropReason("https://www.swepoke.se/alla-produkter/plasma-blast-booster-box-36-packs", 19_000_000)).toBe("junk-price");
  });

  it("behåller äkta sealed under taket", () => {
    expect(qbDropReason("https://www.swepoke.se/pokemon/booster-box/surging-sparks-booster-box", 324_875)).toBeNull();
  });
});
