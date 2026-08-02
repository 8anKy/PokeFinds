/**
 * Streckkodsvägens GRIND: rå avläsning → kanonisk GTIN-14, eller ingenting.
 *
 * Testerna handlar bara om den rena tolkningen — ingen DOM, ingen databas.
 * `BarcodeDetector` finns inte i Node och behöver inte finnas: felen som gör ont
 * i produktion sitter i tolkningen av siffrorna, inte i webbläsar-API:t.
 *
 * GTIN-koderna nedan är RIKTIGA Pokémon-koder, avlästa ur butikernas feeds
 * 2026-07-13 (samma uppsättning som tests/unit/gtin.test.ts). Byt aldrig ut dem
 * mot påhittade — poängen är att skydda mot de former asken faktiskt bär.
 */
import { describe, expect, it } from "vitest";
import { normalizeGtin } from "@/lib/gtin";
import {
  BARCODE_FORMATS,
  barcodeSupported,
  expandUpcE,
  gtinFromBarcode,
} from "@/services/scanner/barcode";

describe("gtinFromBarcode — EAN-13/UPC-A rakt av", () => {
  it("normaliserar en 12-siffrig UPC-A (TPCi 196214…) till GTIN-14", () => {
    expect(gtinFromBarcode("196214142671", "upc_a")).toBe("00196214142671");
  });

  it("normaliserar en 13-siffrig japansk JAN-kod (Pokémon Japan 4521329…)", () => {
    expect(gtinFromBarcode("4521329432267", "ean_13")).toBe("04521329432267");
  });

  it("KRITISKT: samma kod med och utan ledande nolla ger IDENTISK nyckel", () => {
    // Katalogen lagrar GTIN-14. Läser kameran 13 siffror och butiken skrev 12
    // måste båda landa på samma rad — annars ger en riktig ask noll träffar.
    expect(gtinFromBarcode("0196214135017", "ean_13")).toBe(
      gtinFromBarcode("196214135017", "upc_a")
    );
  });

  it("ger samma nyckel som katalogens egen normalisering", () => {
    // Vakt mot att streckkodsvägen någonsin får en EGEN normalisering: nyckeln
    // MÅSTE komma ur @/lib/gtin, annars driver klient och katalog isär tyst.
    for (const code of ["196214142671", "4521329432274", "0820650809439"]) {
      expect(gtinFromBarcode(code)).toBe(normalizeGtin(code));
    }
  });

  it("skiljer påse från display — en siffra isär är två produkter", () => {
    expect(gtinFromBarcode("4521329432267", "ean_13")).not.toBe(
      gtinFromBarcode("4521329432274", "ean_13")
    );
  });
});

describe("gtinFromBarcode — en felläst kod ger INGENTING", () => {
  it("avvisar fel checksiffra (annars hamnar fel ask i någons samling)", () => {
    // 196214142671 är giltig; ändra sista siffran → måste bli null.
    expect(gtinFromBarcode("196214142671", "upc_a")).not.toBeNull();
    expect(gtinFromBarcode("196214142672", "upc_a")).toBeNull();
  });

  it("avvisar avläsningar som inte är streckkoder alls", () => {
    expect(gtinFromBarcode("POK-AB-EYE-BB")).toBeNull();
    expect(gtinFromBarcode("165140")).toBeNull(); // butikens egen räknare, för kort
    expect(gtinFromBarcode("")).toBeNull();
    expect(gtinFromBarcode(null)).toBeNull();
    expect(gtinFromBarcode(undefined)).toBeNull();
  });

  it("avvisar en kod som är för lång för att vara GTIN", () => {
    expect(gtinFromBarcode("196214142671196214")).toBeNull();
  });
});

/**
 * UPC-E är den fälla som gör att "läs koden och normalisera" inte räcker: den
 * 8-siffriga strängen är INTE en giltig GTIN-8 — checksiffran är den
 * EXPANDERADE UPC-A-kodens. Utan expansionen faller varje UPC-E-märkt ask på
 * checksiffran och rapporteras som "ingen kod".
 */
describe("expandUpcE — GS1:s expansionstabell", () => {
  it("expanderar det kanoniska paret (sista datasiffra 0–2)", () => {
    // Dokumenterat par: UPC-E 04252614 ↔ UPC-A 042100005264.
    expect(expandUpcE("04252614")).toBe("042100005264");
  });

  it("täcker alla fyra grenarna i tabellen", () => {
    expect(expandUpcE("01234531")).toBe("012300000451"); // sista siffra 3
    expect(expandUpcE("01234543")).toBe("012340000053"); // sista siffra 4
    expect(expandUpcE("01234572")).toBe("012345000072"); // sista siffra 5–9
  });

  it("expanderar bara nummersystem 0 och 1 — annat är ingen UPC-E", () => {
    expect(expandUpcE("54252614")).toBeNull();
  });

  it("kräver exakt 8 siffror", () => {
    expect(expandUpcE("0425261")).toBeNull();
    expect(expandUpcE("042100005264")).toBeNull();
  });

  it("expansionen VALIDERAR inte — checksiffran prövas av normalizeGtin", () => {
    // Grinden ska sitta på ETT ställe. Expansionen packar bara upp.
    const bogus = expandUpcE("04252619"); // fel checksiffra, samma form
    expect(bogus).toBe("042100005269");
    expect(normalizeGtin(bogus)).toBeNull();
  });
});

describe("gtinFromBarcode — 8 siffror tolkas ALDRIG på gissning", () => {
  it("expanderar när detektorn säger upc_e", () => {
    expect(gtinFromBarcode("04252614", "upc_e")).toBe("00042100005264");
  });

  it("KRITISKT: expanderar INTE utan formatuppgift", () => {
    // En 8-siffrig sträng är antingen EAN-8 (giltig som den är) eller UPC-E
    // (måste expanderas), och innehållet skiljer dem inte åt. "Prova båda" hade
    // i ~1 fall av 10 gett en UPC-E som råkar klara GTIN-8-checksumman — dvs en
    // TYST felaktig produktkod. Hellre ingen träff än fel ask.
    expect(gtinFromBarcode("04252614")).toBeNull();
    expect(gtinFromBarcode("04252614", "ean_8")).toBeNull();
  });

  it("en redan expanderad upc_e-avläsning faller igenom till vanliga vägen", () => {
    // Vissa plattformar lämnar UPC-E i 12-siffrig form. Villkoret är därför
    // BÅDE format och längd — inte formatet ensamt.
    expect(gtinFromBarcode("042100005264", "upc_e")).toBe("00042100005264");
  });
});

describe("plattformsstöd", () => {
  it("barcodeSupported() är falskt utan BarcodeDetector (Node = iOS-fallet)", () => {
    // iOS/Safari saknar API:t helt. Att svaret är ett ärligt `false` — och inte
    // ett kastat fel — är hela poängen: gränssnittet ska kunna välja bort läget.
    expect(barcodeSupported()).toBe(false);
  });

  it("efterfrågade format är de fyra som står på en Pokémon-ask", () => {
    expect([...BARCODE_FORMATS]).toEqual(["ean_13", "upc_a", "ean_8", "upc_e"]);
  });
});
