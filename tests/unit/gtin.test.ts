import { describe, it, expect } from "vitest";
import { normalizeGtin, isValidGtinChecksum, sameGtin, gtinConflict, formatGtin } from "@/lib/gtin";
import { gtinFromJsonLd, productNameFromHtml } from "@/scrapers/gtin-source";

/**
 * Alla värden nedan är RIKTIGA, avlästa ur butikernas feeds 2026-07-13.
 * Byt aldrig ut dem mot påhittade koder — poängen är att skydda mot exakt de
 * former butikerna faktiskt skickar.
 */
describe("normalizeGtin", () => {
  it("normaliserar Dragon's Lairs Shopify-barcode (12-siffrig UPC-A) till GTIN-14", () => {
    // dragonslair.se /products/{handle}.js → variants[0].barcode
    expect(normalizeGtin("196214142671")).toBe("00196214142671");
    expect(normalizeGtin("196214142138")).toBe("00196214142138");
  });

  it("normaliserar japanska JAN-koder (13-siffriga EAN)", () => {
    // 4521329… = Pokémon Japan. Skiljer påse från display:
    expect(normalizeGtin("4521329432267")).toBe("04521329432267"); // Nihil Zero Booster (påse)
    expect(normalizeGtin("4521329432274")).toBe("04521329432274"); // Nihil Zero Booster Display (box)
    expect(normalizeGtin("4521329432267")).not.toBe(normalizeGtin("4521329432274"));
  });

  it("KRITISKT: samma kod med och utan ledande nolla blir IDENTISK", () => {
    // Alphaspel skriver BÅDA formerna. En rå strängjämförelse hade delat produkten.
    expect(normalizeGtin("0196214135017")).toBe(normalizeGtin("196214135017"));
  });

  it("KRITISKT: Webhallens eans[]-array (samma kod i två kodningar) ger ETT värde", () => {
    // webhallen.com/api/product/337665 → eans: ["0820650809439", "820650809439"]
    const fromArray = normalizeGtin(["0820650809439", "820650809439"]);
    expect(fromArray).toBe(normalizeGtin("820650809439"));
    expect(fromArray).not.toBeNull();
  });

  it("KRITISKT: MaxGamings fält heter gtin8 men värdena är 12–13 siffror", () => {
    // En 8-siffrig längdvalidering hade kastat 100% av MaxGamings data.
    expect(normalizeGtin("196214114845")).toBe("00196214114845");
    expect(normalizeGtin("4521329462127")).toBe("04521329462127");
  });

  it("avvisar butikernas påhittade MPN/artikelnummer", () => {
    expect(normalizeGtin("POK-AB-EYE-BB")).toBeNull(); // MaxGaming hittade på denna
    expect(normalizeGtin("POK10407-101-b")).toBeNull();
    expect(normalizeGtin("sunmoon_box")).toBeNull();
    expect(normalizeGtin("23W84C")).toBeNull();
  });

  it("avvisar butiks-interna löpnummer (för korta för att vara GTIN)", () => {
    expect(normalizeGtin("165140")).toBeNull(); // Dragon's Lairs egen räknare
    expect(normalizeGtin("238046")).toBeNull(); // Alphaspels slug-id
    expect(normalizeGtin("2042")).toBeNull(); // Swepokes Quickbutik-radid
  });

  it("avvisar tomt, null och odefinierat", () => {
    expect(normalizeGtin(null)).toBeNull();
    expect(normalizeGtin(undefined)).toBeNull();
    expect(normalizeGtin("")).toBeNull();
    expect(normalizeGtin("   ")).toBeNull();
    expect(normalizeGtin([])).toBeNull();
  });

  it("avvisar koder med FEL checksiffra (butikens tryckfel blir aldrig katalognyckel)", () => {
    // 196214142671 är giltig; ändra sista siffran → måste avvisas.
    expect(normalizeGtin("196214142671")).not.toBeNull();
    expect(normalizeGtin("196214142672")).toBeNull();
  });

  it("accepterar siffror även när feeden dekorerar dem", () => {
    expect(normalizeGtin(" 196214142671 ")).toBe("00196214142671");
    expect(normalizeGtin(196214142671)).toBe("00196214142671");
  });
});

describe("isValidGtinChecksum", () => {
  it("godkänner riktiga koder i alla GTIN-längder", () => {
    expect(isValidGtinChecksum("196214142671")).toBe(true); // GTIN-12
    expect(isValidGtinChecksum("4521329432267")).toBe(true); // GTIN-13
    expect(isValidGtinChecksum("00196214142671")).toBe(true); // GTIN-14
  });
  it("underkänner fel checksiffra och ogiltiga längder", () => {
    expect(isValidGtinChecksum("196214142672")).toBe(false);
    expect(isValidGtinChecksum("1962141")).toBe(false);
    expect(isValidGtinChecksum("abc")).toBe(false);
  });
});

describe("gtinConflict — merge-vakten", () => {
  const pack = normalizeGtin("4521329432267")!;
  const display = normalizeGtin("4521329432274")!;

  it("SANN när båda har kod och de skiljer sig (påse ≠ display)", () => {
    expect(gtinConflict(pack, display)).toBe(true);
  });

  it("FALSK när koderna är samma (även om ledande nollor skilde i feeden)", () => {
    expect(gtinConflict(normalizeGtin("0196214135017"), normalizeGtin("196214135017"))).toBe(false);
  });

  it("KRITISKT: saknad kod är ALDRIG en konflikt", () => {
    // Samlarhobby skickar null, Swepoke inget alls, DL:s äldre sortiment saknar.
    // Tolkas frånvaro som "olika produkt" blockerar vi korrekta länkar — och en
    // falskt blockerad länk är VÄRRE än en felmatch, för den syns aldrig.
    expect(gtinConflict(pack, null)).toBe(false);
    expect(gtinConflict(null, display)).toBe(false);
    expect(gtinConflict(null, null)).toBe(false);
    expect(gtinConflict(pack, undefined)).toBe(false);
  });
});

describe("sameGtin", () => {
  it("kräver att BÅDA har kod", () => {
    expect(sameGtin(normalizeGtin("196214142671"), normalizeGtin("0196214142671"))).toBe(true);
    expect(sameGtin(normalizeGtin("196214142671"), null)).toBe(false);
    expect(sameGtin(null, null)).toBe(false);
  });
});

describe("formatGtin", () => {
  it("visar utan ledande nollor", () => {
    expect(formatGtin("00196214142671")).toBe("196214142671");
    expect(formatGtin(null)).toBeNull();
  });
});

/**
 * Tvetydighetsvakterna. Båda kommer från RIKTIGA fel som backfillen avslöjade
 * 2026-07-13 — inte hypotetiska.
 */
describe("gtinFromJsonLd — tvetydighet ger INGEN kod", () => {
  const ld = (obj: unknown) => `<script type="application/ld+json">${JSON.stringify(obj)}</script>`;

  it("läser gtin ur ett schema.org Product-block", () => {
    expect(gtinFromJsonLd(ld({ "@type": "Product", gtin: "196214105133" }))).toBe("00196214105133");
  });

  it("läser MaxGamings felnamngivna gtin8 (12–13 siffror)", () => {
    expect(gtinFromJsonLd(ld({ "@type": "Product", gtin8: "4521329462127" }))).toBe("04521329462127");
  });

  it("hittar Product inuti @graph", () => {
    expect(gtinFromJsonLd(ld({ "@graph": [{ "@type": "WebPage" }, { "@type": "Product", gtin12: "196214141049" }] }))).toBe(
      "00196214141049"
    );
  });

  it("KRITISKT: två OLIKA koder på samma sida → ingen kod (gissa aldrig)", () => {
    const html = ld({ "@type": "Product", gtin: "196214139114" }) + ld({ "@type": "Product", gtin: "196214139176" });
    expect(gtinFromJsonLd(html)).toBeNull();
  });

  it("samma kod upprepad i flera block är INTE tvetydigt", () => {
    const html = ld({ "@type": "Product", gtin: "196214139114" }) + ld({ "@type": "Product", gtin13: "196214139114" });
    expect(gtinFromJsonLd(html)).toBe("00196214139114");
  });

  it("trasig JSON-LD dödar inte hämtningen", () => {
    expect(gtinFromJsonLd(`<script type="application/ld+json">{ trasig`)).toBeNull();
  });

  it("ingen JSON-LD alls → null", () => {
    expect(gtinFromJsonLd("<html><body>inget här</body></html>")).toBeNull();
  });
});

describe("productNameFromHtml — rent butiksnamn vid källan", () => {
  const ld = (obj: unknown) => `<script type="application/ld+json">${JSON.stringify(obj)}</script>`;

  it("tar schema.org name — skräpet ligger i description, inte i name", () => {
    // MaxGaming: name är rent, description börjar "Observera: Max 2 boxar per kund."
    const html = ld({
      "@type": "Product",
      name: "Pokémon Mega Evolution Elite Trainer Box",
      description: "Observera: Max 2 boxar per kund. Elite Trainer Box med 9 boosters…",
    });
    expect(productNameFromHtml(html)).toBe("Pokémon Mega Evolution Elite Trainer Box");
  });

  it("flera OLIKA namn på sidan → null (gissa aldrig vilken variant som avses)", () => {
    const html =
      ld({ "@type": "Product", name: "Mega Gengar ex Tin" }) +
      ld({ "@type": "Product", name: "Mega Clefable ex Tin" });
    expect(productNameFromHtml(html)).toBeNull();
  });

  it("ingen JSON-LD → null (auto-importen faller tillbaka på feedens titel)", () => {
    expect(productNameFromHtml("<html><body>inget</body></html>")).toBeNull();
  });
});
