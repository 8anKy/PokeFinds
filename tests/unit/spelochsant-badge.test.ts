import { describe, expect, it } from "vitest";
import { parseSosProduct, sosStockFromBadge } from "@/scrapers/adapters/spelochsant-adapter";

describe("Spel & Sånt efter ombygget 2026-11 (lagerbrickan dömer, knappen finns inte i svaret)", () => {
  it("grön bricka med saldo = i lager, röd = slut", () => {
    expect(sosStockFromBadge({ class: "green_bomb", text: "3 st i lager", quantity: 3 })).toBe("in");
    expect(sosStockFromBadge({ class: "green_bomb", text: "20+ i lager", quantity: 20 })).toBe("in");
    expect(sosStockFromBadge({ class: "red_bomb", text: "ej i lager", quantity: -1 })).toBe("out");
  });

  it("bokningsbar = förhandsbokning, okänd bricka = okänt (aldrig i lager)", () => {
    expect(sosStockFromBadge({ class: "yellow_bomb", text: "12 bokningsbara", quantity: 0 })).toBe("preorder");
    expect(sosStockFromBadge({ class: "blue_bomb", text: "kommer snart", quantity: 0 })).toBe("unknown");
    expect(sosStockFromBadge(null)).toBe("unknown");
  });

  it("ett riktigt svarsobjekt blir en annons på /produkt/<slug>", () => {
    const item = parseSosProduct({
      id: 57364,
      name: "Pokemon TCG Scarlet & Violet Prismatic Evolutions Super-Premium Collection (MAX 1 Per Hushåll)",
      price: 3499,
      slug: "pokemon-tcg-scarlet-violet-prismatic-evolutions-super-premium-collection-max-1-per-hushall-57364",
      stock: { class: "green_bomb", text: "3 st i lager", quantity: 3 },
    });
    expect(item?.stock).toBe("in");
    expect(item?.priceOre).toBe(349900);
    expect(item?.title).toBe("Pokemon TCG Scarlet & Violet Prismatic Evolutions Super-Premium Collection");
    expect(item?.url).toBe("https://www.spelochsant.se/produkt/pokemon-tcg-scarlet-violet-prismatic-evolutions-super-premium-collection-max-1-per-hushall-57364");
  });
});
