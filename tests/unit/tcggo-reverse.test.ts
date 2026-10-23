import { describe, expect, it } from "vitest";
import { mayCreateReverseProduct, reverseHoloCmUrl, tcggoReverseEur } from "@/lib/tcggo-reverse";

describe("tcggoReverseEur", () => {
  it("läser reverse holo-golvet (verifierat mot CM: Charizard SW 3 = 200 €)", () => {
    const row = {
      variants: [
        { type: "poke_ball", prices: { cardmarket: { lowest_near_mint: 5 } } },
        { type: "reverse_holo", prices: { cardmarket: { lowest_near_mint: 200 } } },
      ],
    };
    expect(tcggoReverseEur(row)).toBe(200);
  });
  it("null när fältet saknas, är null eller 0 (0 är inget pris)", () => {
    expect(tcggoReverseEur({})).toBeNull();
    expect(tcggoReverseEur({ variants: null })).toBeNull();
    expect(tcggoReverseEur({ variants: [{ type: "reverse_holo", prices: { cardmarket: { lowest_near_mint: null } } }] })).toBeNull();
    expect(tcggoReverseEur({ variants: [{ type: "reverse_holo", prices: { cardmarket: { lowest_near_mint: 0 } } }] })).toBeNull();
    expect(tcggoReverseEur(null)).toBeNull();
  });
  it("tar aldrig en annan variants pris", () => {
    expect(tcggoReverseEur({ variants: [{ type: "master_ball", prices: { cardmarket: { lowest_near_mint: 40 } } }] })).toBeNull();
  });
});

describe("reverseHoloCmUrl", () => {
  it("lägger till filtret och behåller resten, idempotent", () => {
    const base = "https://www.cardmarket.com/en/Pokemon/Products?idProduct=277756&language=1&minCondition=2&isFirstEd=N";
    const u = reverseHoloCmUrl(base);
    expect(u).toContain("idProduct=277756");
    expect(u).toContain("language=1");
    expect(u).toContain("minCondition=2");
    expect(u).toContain("isReverseHolo=Y");
    expect(reverseHoloCmUrl(u)).toBe(u);
  });
});

describe("mayCreateReverseProduct", () => {
  it("skapar bara för reverse-sällsyntheter i set som har reverse holos", () => {
    expect(mayCreateReverseProduct({ rarity: "Common", setHasReverse: true })).toBe(true);
    expect(mayCreateReverseProduct({ rarity: "Rare Holo", setHasReverse: true })).toBe(true);
    expect(mayCreateReverseProduct({ rarity: "Special Illustration Rare", setHasReverse: true })).toBe(false);
    expect(mayCreateReverseProduct({ rarity: "Double Rare", setHasReverse: true })).toBe(false);
    expect(mayCreateReverseProduct({ rarity: "Common", setHasReverse: false })).toBe(false);
    expect(mayCreateReverseProduct({ rarity: null, setHasReverse: true })).toBe(false);
  });
});
