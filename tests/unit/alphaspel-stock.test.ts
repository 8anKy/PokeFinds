import { describe, it, expect } from "vitest";
import { alphaspelInStock } from "../../src/scrapers/adapters/alphaspel-adapter";

// Fraser observerade live i Alphaspels kategori-grid (2026-07-04).
describe("alphaspelInStock", () => {
  it("i lager när antal/tillgänglighet visas", () => {
    for (const t of ["I lager", "1 i butiken", "2 i butiken 5 på postorder", "Fler än 20 på postorder", "1 på postorder"]) {
      expect(alphaspelInStock(t)).toBe(true);
    }
  });

  it("ur lager för slut/förbokat/okänt", () => {
    for (const t of ["Slutsåld", "Ej i lager", "Första leveransen fullbokad, ingen info om nästa leverans ännu", ""]) {
      expect(alphaspelInStock(t)).toBe(false);
    }
  });
});
