import { describe, it, expect } from "vitest";
import { maxgamingStock } from "../../src/scrapers/adapters/maxgaming-adapter";

// Lagerkoder + texter ordagrant ur MaxGamings grid 2026-09-17 (204 kort, /sv/pokemon).
describe("maxgamingStock — koden dömer, texten är fallback", () => {
  it("Lager_1 = i lager", () => {
    expect(maxgamingStock("1", "I lager")).toBe("in");
  });

  it("Lager_8 = Förhandsboka = KÖPBAR förhandsbokning (låg som OUT till 2026-09-17)", () => {
    // Produktsidan har en AKTIV Förhandsboka-knapp (30th Celebration Booster Box (Japanese)).
    expect(maxgamingStock("8", "Förhandsboka")).toBe("preorder");
  });

  it("Lager_2/10/12 går inte att köpa — 'Kommer snart' har ingen köpknapp alls", () => {
    expect(maxgamingStock("2", "Tillfälligt slut")).toBe("out");
    expect(maxgamingStock("10", "Slutsåld")).toBe("out");
    expect(maxgamingStock("12", "Kommer snart")).toBe("out");
  });

  it("okänd kod faller tillbaka på texten, allowlist", () => {
    expect(maxgamingStock("99", "Förhandsboka")).toBe("preorder");
    expect(maxgamingStock(null, "… I lager …")).toBe("in");
    expect(maxgamingStock("99", "Snart tillbaka")).toBe("out");
    expect(maxgamingStock(null, "")).toBe("out");
  });
});
