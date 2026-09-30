import { describe, it, expect } from "vitest";
import { jpSealedCategory } from "@/jobs/cm-jp-sealed-import";

// Namn ur leverantörens japanska produktlista (2026-09-30).
describe("jpSealedCategory", () => {
  it("booster, box och specialprodukter blir sealed", () => {
    expect(jpSealedCategory("Storm Emeralda Booster")).toBe("BOOSTER_PACK");
    expect(jpSealedCategory("Storm Emeralda Booster Box")).toBe("BOOSTER_BOX");
    expect(jpSealedCategory("Team Plasma Battle Gift Set")).toBe("COLLECTION_BOX");
  });
  it("grossistenheter skapas aldrig", () => {
    expect(jpSealedCategory("Storm Emeralda Booster Box Case")).toBeNull();
    expect(jpSealedCategory("White Flare JP Booster Box Case")).toBeNull();
  });
  it("kinesiska utgåvor skapas aldrig", () => {
    expect(jpSealedCategory("CSM1aC: Storming Emergence - Radiant Booster Box")).toBeNull();
  });
});
