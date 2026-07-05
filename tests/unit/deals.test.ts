import { describe, it, expect } from "vitest";
import { qualifiesAsDeal } from "../../src/services/products";
import { extractTraderaItemId, dealVerdict } from "../../src/jobs/verify-deals";

// Fynd = Tradera-annons minst `minDiscount` under Cardmarket-referenspriset (allt i öre).
describe("qualifiesAsDeal", () => {
  it("kvalar vid exakt tröskeln och därunder", () => {
    expect(qualifiesAsDeal(700_00, 1000_00, 0.3)).toBe(true); // exakt 30 %
    expect(qualifiesAsDeal(400_00, 1000_00, 0.3)).toBe(true); // 60 %
  });

  it("kvalar inte precis under tröskeln", () => {
    expect(qualifiesAsDeal(701_00, 1000_00, 0.3)).toBe(false); // ~29,9 %
    expect(qualifiesAsDeal(1000_00, 1000_00, 0.3)).toBe(false); // samma pris
  });

  it("kräver giltiga priser (referens/tradera > 0)", () => {
    expect(qualifiesAsDeal(500_00, 0, 0.3)).toBe(false); // ingen referens
    expect(qualifiesAsDeal(0, 1000_00, 0.3)).toBe(false); // inget Tradera-pris
  });

  it("filtrerar bort skräp över taket (felmatch/uppblåst referens)", () => {
    // 98,5 % rabatt = 15 kr vs 1000 kr → nästan alltid felmatch, inte fynd.
    expect(qualifiesAsDeal(15_00, 1000_00, 0.3, 0.85)).toBe(false);
    expect(qualifiesAsDeal(150_00, 1000_00, 0.3, 0.85)).toBe(true); // 85 % = exakt taket
  });
});

describe("extractTraderaItemId", () => {
  it("plockar itemId ur annons-URL", () => {
    expect(extractTraderaItemId("https://www.tradera.com/item/1001341/738310965/mega-charizard")).toBe("738310965");
    expect(extractTraderaItemId("https://www.tradera.com/item/0/500/x")).toBe("500");
  });
  it("null för sök-/okänd URL", () => {
    expect(extractTraderaItemId("https://www.tradera.com/search?q=pokemon")).toBeNull();
  });
});

describe("dealVerdict", () => {
  const base = { sameProduct: true, sealedComplete: true, ended: false, remaining: 1 };
  it("ok bara när allt stämmer", () => {
    expect(dealVerdict(base)).toBe(true);
  });
  it("avvisar fel produkt / tom vara / utgången / slutsåld", () => {
    expect(dealVerdict({ ...base, sameProduct: false })).toBe(false);
    expect(dealVerdict({ ...base, sealedComplete: false })).toBe(false); // tom ask
    expect(dealVerdict({ ...base, ended: true })).toBe(false);
    expect(dealVerdict({ ...base, remaining: 0 })).toBe(false);
  });
});
