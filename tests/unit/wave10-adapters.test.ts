import { describe, it, expect } from "vitest";
import { StockStatus } from "@prisma/client";
import type { RawProductData } from "../../src/scrapers/types";
import {
  sosStockFromButton,
  cleanSosTitle,
  parseSosProduct,
  SpelOchSantAdapter,
} from "../../src/scrapers/adapters/spelochsant-adapter";

// ── Spel & Sånt ────────────────────────────────────────────────────────────────
// Knapparna ordagrant ur POST /products/json 2026-10-15 (kategori 192 + 601).
const BTN_BUY = `<div class="button buy" onClick="addToBasket(65019, undefined, undefined, undefined, $(this)); return false;"><span>LÄGG I VARUKORG</span></div>`;
const BTN_BOOK = `<div class="button booking" onClick="addToBasket(64244, 1, false, true, $(this)); return false;"><span>FÖRHANDSBOKA</span></div>`;
const BTN_WATCH = `<div class="button subscribe" onClick="alert('Sign in to monitor this product!'); return false;"><span>BEVAKA</span></div>`;

describe("sosStockFromButton — knappen dömer", () => {
  it("buy ⇒ i lager, booking ⇒ förhandsbokning, subscribe ⇒ slut", () => {
    expect(sosStockFromButton(BTN_BUY)).toBe("in");
    expect(sosStockFromButton(BTN_BOOK)).toBe("preorder");
    expect(sosStockFromButton(BTN_WATCH)).toBe("out");
  });

  it("okänd eller saknad knapp ⇒ unknown, aldrig i lager", () => {
    expect(sosStockFromButton(undefined)).toBe("unknown");
    expect(sosStockFromButton("")).toBe("unknown");
    expect(sosStockFromButton(`<div class="button other"><span>?</span></div>`)).toBe("unknown");
    expect(sosStockFromButton(`<div class="buy"><span>x</span></div>`)).toBe("unknown");
  });
});

describe("cleanSosTitle — köpgränsen bort, även med ord före 'per'", () => {
  it.each([
    ["Pokemon TCG 30th Celebration Booster Bundle (MAX 1 Per Hushåll)", "Pokemon TCG 30th Celebration Booster Bundle"],
    ["Pokemon TCG Mega Evolutions Phantasmal Flames Booster Pack (MAX 6 Boosters Per Hushåll)", "Pokemon TCG Mega Evolutions Phantasmal Flames Booster Pack"],
    ["Pokemon TCG Mega Charizard X ex Ultra-Premium Collection (MAX 1 Köp Per Hushåll)", "Pokemon TCG Mega Charizard X ex Ultra-Premium Collection"],
    ["Pokemon TCG Lumiose City Mini Tin (Emboar & Inkay)", "Pokemon TCG Lumiose City Mini Tin (Emboar & Inkay)"],
  ])("%s", (input, expected) => {
    expect(cleanSosTitle(input)).toBe(expected);
  });
});

describe("parseSosProduct", () => {
  const base = {
    id: "65019",
    name: "Pokemon TCG 30th Celebration Booster Bundle (MAX 1 Per Hushåll)",
    price: "799",
    slug: "pokemonkort/ovrigapokemonkort/pokemon-tcg-30th-celebration-booster-bundle-max-1-per-hushall",
    stock: { class: "green_bomb", text: "20+ i lager", quantity: "37" },
    buy_button: BTN_BUY,
    big_image_url: "https://www.spelochsant.se//uploads/images/product_images/563697_450x450.jpg",
  };

  it("bygger produkt-URL ur slug, pris i öre, rensad bild-URL", () => {
    expect(parseSosProduct(base)).toEqual({
      id: "65019",
      title: "Pokemon TCG 30th Celebration Booster Bundle",
      url: "https://www.spelochsant.se/produkt/pokemonkort/ovrigapokemonkort/pokemon-tcg-30th-celebration-booster-bundle-max-1-per-hushall",
      priceOre: 79900,
      stock: "in",
      quantity: 37,
      stockText: "20+ i lager",
      imageUrl: "https://www.spelochsant.se/uploads/images/product_images/563697_450x450.jpg",
    });
  });

  it("platt slug utan kategoriväg fungerar", () => {
    expect(parseSosProduct({ ...base, slug: "pokemon-tcg-mega-evolution-pitch-black-booster-bundle" })?.url).toBe(
      "https://www.spelochsant.se/produkt/pokemon-tcg-mega-evolution-pitch-black-booster-bundle"
    );
  });

  it("⛔ 0 kr ⇒ price null, annonsen behålls", () => {
    const p = parseSosProduct({ ...base, price: "0" });
    expect(p).not.toBeNull();
    expect(p!.priceOre).toBeNull();
  });

  it("decimalpris och -1-saldo (slutsåld) läses utan att döma på saldot", () => {
    const p = parseSosProduct({ ...base, price: "99.50", stock: { class: "red_bomb", text: "Ej i lager", quantity: "-1" }, buy_button: BTN_WATCH });
    expect(p!.priceOre).toBe(9950);
    expect(p!.quantity).toBe(-1);
    expect(p!.stock).toBe("out");
  });

  it("saknat id/namn/slug ⇒ null", () => {
    expect(parseSosProduct({ ...base, id: undefined })).toBeNull();
    expect(parseSosProduct({ ...base, name: "" })).toBeNull();
    expect(parseSosProduct({ ...base, slug: "" })).toBeNull();
  });
});

describe("SpelOchSantAdapter.validateResult", () => {
  const a = new SpelOchSantAdapter();
  const ok: RawProductData = {
    externalId: "sos-1",
    title: "Pokemon TCG X",
    url: "https://www.spelochsant.se/produkt/x",
    price: 9900,
    currency: "SEK",
    stockStatus: StockStatus.IN_STOCK,
    raw: {},
  };
  it("godkänner pris i öre och price null (0 kr-fällan)", () => {
    expect(a.validateResult({ ...ok })).toBe(true);
    expect(a.validateResult({ ...ok, price: null })).toBe(true);
  });
  it("fäller 0, negativt och decimalt öre", () => {
    expect(a.validateResult({ ...ok, price: 0 })).toBe(false);
    expect(a.validateResult({ ...ok, price: -5 })).toBe(false);
    expect(a.validateResult({ ...ok, price: 99.5 })).toBe(false);
  });
});
