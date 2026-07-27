/**
 * stock-verify: läser lagerstatus ur butikens EGEN produktsida när en offer försvunnit
 * ur feeden. Reglerna som måste hålla:
 *   - tvetydig sida (flera produkter, olika svar) → null, aldrig en gissning
 *   - ?variant=… gäller DEN variantens lager, inte sidans (sortimentssidor säljer flera SKU:er)
 *   - okänd/utebliven availability → null → anroparen behåller UNKNOWN
 */
import { describe, expect, it } from "vitest";
import { StockStatus } from "@prisma/client";
import {
  statusAfterVerify,
  stockFromJsonLd,
  stockFromShopifyJs,
  STORE_STOCK_STRATEGY,
} from "@/scrapers/stock-verify";

const ld = (obj: unknown) => `<html><script type="application/ld+json">${JSON.stringify(obj)}</script></html>`;
const product = (availability: string, name = "Pokémon ETB") => ({
  "@type": "Product",
  name,
  offers: { "@type": "Offer", price: "899.00", priceCurrency: "SEK", availability },
});

describe("stockFromJsonLd", () => {
  it("läser slutsåld (Shinycards/Spelexperten skriver full schema.org-URL)", () => {
    expect(stockFromJsonLd(ld(product("https://schema.org/OutOfStock")))).toBe(StockStatus.OUT_OF_STOCK);
  });

  it("läser i lager (bart värde utan URL-prefix)", () => {
    expect(stockFromJsonLd(ld(product("InStock")))).toBe(StockStatus.IN_STOCK);
  });

  it("förhandsbokning blir PREORDER, inte i lager", () => {
    expect(stockFromJsonLd(ld(product("http://schema.org/PreOrder")))).toBe(StockStatus.PREORDER);
  });

  it("hittar produkten inuti @graph", () => {
    expect(stockFromJsonLd(ld({ "@graph": [{ "@type": "WebPage" }, product("InStock")] }))).toBe(
      StockStatus.IN_STOCK
    );
  });

  it("flera produkter som säger OLIKA saker → null (vi vet inte vilken som är vår)", () => {
    const html = ld([product("InStock", "Vår vara"), product("OutOfStock", "Relaterad vara")]);
    expect(stockFromJsonLd(html)).toBeNull();
  });

  it("flera produkter som säger SAMMA sak → svaret duger", () => {
    const html = ld([product("OutOfStock", "A"), product("OutOfStock", "B")]);
    expect(stockFromJsonLd(html)).toBe(StockStatus.OUT_OF_STOCK);
  });

  it("ingen JSON-LD alls → null (ingen gissning)", () => {
    expect(stockFromJsonLd("<html><body>Slutsåld</body></html>")).toBeNull();
  });

  it("okänt availability-värde → null", () => {
    expect(stockFromJsonLd(ld(product("https://schema.org/MadeToOrder")))).toBeNull();
  });

  it("trasig JSON-LD dödar inte uppslaget", () => {
    expect(stockFromJsonLd('<script type="application/ld+json">{trasig</script>')).toBeNull();
  });
});

describe("stockFromShopifyJs", () => {
  const variants = [
    { id: 1, available: false },
    { id: 2, available: true },
  ];

  it("?variant=… gäller DEN variantens lager — inte sidans", () => {
    expect(stockFromShopifyJs({ available: true, variants }, 1)).toBe(StockStatus.OUT_OF_STOCK);
    expect(stockFromShopifyJs({ available: true, variants }, 2)).toBe(StockStatus.IN_STOCK);
  });

  it("naken produkt-URL: i lager om NÅGON variant finns (samma regel som adaptern)", () => {
    expect(stockFromShopifyJs({ variants }, null)).toBe(StockStatus.IN_STOCK);
    expect(stockFromShopifyJs({ variants: [{ id: 1, available: false }] }, null)).toBe(
      StockStatus.OUT_OF_STOCK
    );
  });

  it("efterfrågad variant borta ur butiken → null, inte slutsåld", () => {
    expect(stockFromShopifyJs({ available: false, variants }, 999)).toBeNull();
  });

  it("faller tillbaka på produktens available när varianter saknas", () => {
    expect(stockFromShopifyJs({ available: false, variants: [] }, null)).toBe(StockStatus.OUT_OF_STOCK);
  });

  it("tomt svar → null", () => {
    expect(stockFromShopifyJs({}, null)).toBeNull();
  });
});

describe("statusAfterVerify — ett uteblivet svar är ingen upplysning", () => {
  it("svar från butiken vinner alltid", () => {
    expect(statusAfterVerify(StockStatus.IN_STOCK, StockStatus.OUT_OF_STOCK)).toBe(StockStatus.OUT_OF_STOCK);
    expect(statusAfterVerify(StockStatus.UNKNOWN, StockStatus.IN_STOCK)).toBe(StockStatus.IN_STOCK);
  });

  it("inget svar: ett känt slutsåld skrivs INTE över med okänd (429 ≠ ny kunskap)", () => {
    expect(statusAfterVerify(StockStatus.OUT_OF_STOCK, null)).toBe(StockStatus.OUT_OF_STOCK);
  });

  it("inget svar: obackat 'i lager' faller till UNKNOWN som förut", () => {
    expect(statusAfterVerify(StockStatus.IN_STOCK, null)).toBe(StockStatus.UNKNOWN);
    expect(statusAfterVerify(StockStatus.PREORDER, null)).toBe(StockStatus.UNKNOWN);
    expect(statusAfterVerify(StockStatus.LIMITED, null)).toBe(StockStatus.UNKNOWN);
  });

  it("inget svar på en redan okänd offer ändrar ingenting", () => {
    expect(statusAfterVerify(StockStatus.UNKNOWN, null)).toBe(StockStatus.UNKNOWN);
  });
});

describe("STORE_STOCK_STRATEGY", () => {
  it("Swepoke frågas ALDRIG — produktsidan renderas av Alpine.js i webbläsaren", () => {
    expect(STORE_STOCK_STRATEGY.Swepoke).toBe("none");
  });

  it("marknadsplatser har ingen lagerstatus att fråga om", () => {
    expect(STORE_STOCK_STRATEGY.Tradera).toBe("none");
    expect(STORE_STOCK_STRATEGY.Cardmarket).toBe("none");
  });
});
