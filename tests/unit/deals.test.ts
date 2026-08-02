import { describe, it, expect } from "vitest";
import { qualifiesAsDeal } from "../../src/services/products";
import { extractTraderaItemId, dealVerdict } from "../../src/jobs/verify-deals";
import { buildUserPrompt, buildVerdict } from "../../src/services/deal-verify/contract";

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

// ⛔ FAILAR STÄNGT. Den här domen blir ett FYND i en betald feed, och vi har en
// incident där LLM-verifieringen välsignade felmatchningar. Ett svar som inte är
// en komplett dom ska bli null ("kunde inte verifiera"), aldrig ett halvt ja —
// och aldrig heller ett tyst nej, för nej är destruktivt i verifyTraderaMatches.
describe("buildVerdict", () => {
  it("tolkar ett komplett svar", () => {
    expect(buildVerdict({ sameProduct: true, sealedComplete: true, reason: "Samma ETB." })).toEqual({
      sameProduct: true,
      sealedComplete: true,
      reason: "Samma ETB.",
    });
    expect(buildVerdict({ sameProduct: false, sealedComplete: true, reason: "" })?.sameProduct).toBe(false);
  });

  it("null när ett fält saknas eller inte är boolean", () => {
    expect(buildVerdict({ sealedComplete: true, reason: "x" })).toBeNull();
    expect(buildVerdict({ sameProduct: true, reason: "x" })).toBeNull();
    // Strängar tolkas INTE — "true" är inte ett schemaenligt svar, och att gissa
    // vad modellen menade är precis det som skapar ett falskt fynd.
    expect(buildVerdict({ sameProduct: "true", sealedComplete: "true", reason: "x" })).toBeNull();
    expect(buildVerdict({ sameProduct: 1, sealedComplete: 1, reason: "x" })).toBeNull();
    expect(buildVerdict({})).toBeNull();
    expect(buildVerdict(null)).toBeNull();
  });

  it("motiveringen är kosmetisk: får saknas, kapas till 200 tecken", () => {
    const v = buildVerdict({ sameProduct: true, sealedComplete: true });
    expect(v).not.toBeNull();
    expect(v?.reason).toBe("");
    expect(buildVerdict({ sameProduct: true, sealedComplete: true, reason: "x".repeat(500) })?.reason)
      .toHaveLength(200);
  });
});

// Prompten är DELAD mellan leverantörerna — därför bor den i kontraktet och
// testas här, inte per adapter.
describe("buildUserPrompt", () => {
  it("tar med prisraden bara när referenspris finns", () => {
    const listing = { title: "Prismatic ETB", description: "Oöppnad" };
    expect(buildUserPrompt({ title: "P", category: "SEALED", refKr: 1234 }, listing))
      .toContain("Ungefärligt marknadspris: 1234 kr");
    expect(buildUserPrompt({ title: "P", category: "SEALED" }, listing))
      .not.toContain("marknadspris");
  });

  it("markerar tom beskrivning i stället för att skicka en tom rad", () => {
    expect(buildUserPrompt({ title: "P", category: "SEALED" }, { title: "T", description: "" }))
      .toContain("(ingen beskrivning)");
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
