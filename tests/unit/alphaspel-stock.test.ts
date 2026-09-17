import { describe, it, expect } from "vitest";
import { alphaspelInStock, alphaspelStockStatus } from "../../src/scrapers/adapters/alphaspel-adapter";

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

// Knappmarkup ordagrant ur grid-korten 2026-09-17 (188 kort över Pokémon + brädspel).
const BUY = `<a rel="nofollow"
class="btn w-100 btn-success add-to-cart"
href="/1762-pokemon-tcg/1-x"><span
class="fa fa-cart"></span>Köp
</a>`;
const BOOK = `<a rel="nofollow"
class="btn w-100 btn-primary add-to-cart"
href="/491-bradspel/237984-the-old-kings-crown-en"><span
class="fa fa-hourglass"></span>Boka
</a>`;
const DISABLED = `<a rel="nofollow"
class="btn w-100 btn-default disabled add-to-cart"
href="/1762-pokemon-tcg/357412-pokemon-tcg-30th-celebration-elite-trainer-box"><span
class="fa fa-cart"></span>Köp
</a>`;

describe("alphaspelStockStatus — knappen dömer, texten är fallback", () => {
  it("aktiv Köp-knapp = i lager oavsett text", () => {
    expect(alphaspelStockStatus("3 i butiken 12 på postorder", BUY)).toBe("in");
    expect(alphaspelStockStatus("", BUY)).toBe("in");
  });

  it("aktiv Boka-knapp = förhandsbokning (KÖPBAR) — det var 30th Celebration-släppet 2026-09-17", () => {
    // Öppen förhandsbokning står som "Preliminärt <datum>" — allowlisten ensam dömde den ur lager.
    expect(alphaspelStockStatus("Preliminärt slutet av september", BOOK)).toBe("preorder");
    expect(alphaspelInStock("Preliminärt slutet av september")).toBe(false);
    // Även "Ej i lager" kan vara bokningsbar (restnoterad vara med Boka-knapp).
    expect(alphaspelStockStatus("Ej i lager", BOOK)).toBe("preorder");
  });

  it("disabled-knapp = går inte att köpa, även om texten låter som lager", () => {
    expect(alphaspelStockStatus("Första leveransen fullbokad", DISABLED)).toBe("out");
    expect(alphaspelStockStatus("Slutsåld", DISABLED)).toBe("out");
    expect(alphaspelStockStatus("Försenad, kommande", DISABLED)).toBe("out");
    expect(alphaspelStockStatus("2 i butiken", DISABLED)).toBe("out");
  });

  it("utan knapp faller domen tillbaka på text-allowlisten", () => {
    expect(alphaspelStockStatus("2 i butiken", null)).toBe("in");
    expect(alphaspelStockStatus("Preliminärt slutet av september", null)).toBe("out");
    expect(alphaspelStockStatus("Slutsåld", null)).toBe("out");
  });
});
