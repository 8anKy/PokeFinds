import { describe, expect, it } from "vitest";
import {
  cardNumberLabel,
  productDisplayName,
  productMetaLabel,
} from "@/lib/product-display";

describe("product-display", () => {
  it("visar kortets namn utan set och nummer", () => {
    expect(
      productDisplayName({
        title: "Umbreon · Obsidian Flames 130/197 · Specialversion",
        cardName: "Umbreon",
      })
    ).toBe("Umbreon");
  });

  it("faller tillbaka på titeln när Card-relationen saknas (sealed)", () => {
    expect(
      productDisplayName({ title: "Perfect Order Elite Trainer Box", cardName: null })
    ).toBe("Perfect Order Elite Trainer Box");
  });

  it("faller tillbaka på titeln när kortnamnet bara är blanksteg", () => {
    expect(productDisplayName({ title: "Gengar · Fusion Strike 156/264", cardName: "  " })).toBe(
      "Gengar · Fusion Strike 156/264"
    );
  });

  it("sätter ihop nummer/total", () => {
    expect(cardNumberLabel({ title: "x", cardNumber: "130", setTotalCards: 197 })).toBe("130/197");
  });

  it("utelämnar totalen när setet saknar ett kortantal", () => {
    expect(cardNumberLabel({ title: "x", cardNumber: "SV107", setTotalCards: 0 })).toBe("SV107");
    expect(cardNumberLabel({ title: "x", cardNumber: "038", setTotalCards: null })).toBe("038");
  });

  it("metaraden lägger variantetiketten efter numret", () => {
    expect(
      productMetaLabel({
        title: "x",
        cardNumber: "130",
        setTotalCards: 197,
        variantLabel: "Specialversion",
      })
    ).toBe("130/197 · Specialversion");
  });

  it("metaraden är null när det inte finns något att visa (sealed)", () => {
    expect(productMetaLabel({ title: "Perfect Order Booster Box" })).toBeNull();
  });

  it("metaraden visar bara varianten när kortnumret saknas", () => {
    expect(productMetaLabel({ title: "x", variantLabel: "Specialversion" })).toBe("Specialversion");
  });
});
