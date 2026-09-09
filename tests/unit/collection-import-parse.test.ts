/**
 * Den rena halvan av samlingsimporten: filformat, rubriker och cellvärden.
 * Inga databas-mockar här — samma svar ska gälla i webben och native-appen.
 */
import { describe, expect, it, vi, afterEach } from "vitest";
import { parseCsv, rowValue, sniffDelimiter } from "@/lib/csv-parse";
import { autoMapColumns } from "@/lib/import-mapping";
import {
  inferDateOrder,
  moneyToOre,
  normalizeCondition,
  normalizeLanguage,
  normalizePrinting,
  parseImportDate,
  parseImportNumber,
  parseMoney,
  parseQuantity,
} from "@/lib/import-normalize";
import { buildDraftRows, looksSealed } from "@/lib/import-rows";
import { VARIANT_REVERSE_HOLO } from "@/lib/print-variant";

afterEach(() => vi.useRealTimers());

describe("CSV-parsern", () => {
  it("läser svensk Excel-CSV med BOM, semikolon, citat och radbrytning i en cell", () => {
    const parsed = parseCsv(
      '\uFEFFKortnamn;Antal;Anteckning\r\nPikachu;2;"rad 1\r\nrad 2"\r\n'
    );

    expect(parsed.delimiter).toBe(";");
    expect(parsed.headers).toEqual(["Kortnamn", "Antal", "Anteckning"]);
    expect(parsed.rows).toEqual([["Pikachu", "2", "rad 1\nrad 2"]]);
  });

  it("sniffar tabb och bevarar kommatecken inuti fält", () => {
    const text = "Name\tSet\tQuantity\nPikachu, promo\tBase Set\t1";
    expect(sniffDelimiter(text)).toBe("\t");
    expect(parseCsv(text).rows[0]).toEqual(["Pikachu, promo", "Base Set", "1"]);
  });

  it("fyller en saknad avslutande cell med tom sträng vid läsning", () => {
    expect(rowValue(["Pikachu"], 3)).toBe("");
    expect(rowValue(["Pikachu"], null)).toBe("");
  });
});

describe("kolumnmappningen", () => {
  it("tolkar vanliga externa och egenbyggda rubriker utan en appspecifik parser", () => {
    const result = autoMapColumns([
      "Card Name",
      "Set Name",
      "Collector Number",
      "Total Quantity",
      "Variant / Finish",
      "Purchase Price (SEK)",
      "Date Added",
      "Market Value",
    ]);

    expect(result.profile).toBeNull();
    expect(result.mapping).toMatchObject({
      name: 0,
      setName: 1,
      cardNumber: 2,
      quantity: 3,
      printing: 4,
      purchasePrice: 5,
      purchaseDate: 6,
      estimatedValue: 7,
    });
  });

  it("känner igen och mappar Foilios camelCase-backup inklusive öresbeloppen", () => {
    const headers = [
      "name", "quantity", "condition", "language", "purchasePrice",
      "purchaseDate", "estimatedValue", "gradingCompany", "grade", "notes",
      "set", "number", "variant", "tcgId", "slug",
    ];
    const result = autoMapColumns(headers);

    expect(result.profile?.id).toBe("foilio");
    expect(result.moneyUnit).toBe("ore");
    expect(result.mapping.purchasePrice).toBe(4);
    expect(result.mapping.purchaseDate).toBe(5);
    expect(result.mapping.estimatedValue).toBe(6);
    expect(result.mapping.gradingCompany).toBe(7);
    expect(result.mapping.externalId).toBe(13);
  });
});

describe("värdenormaliseringen", () => {
  it("normaliserar skick, språk och tryckning", () => {
    expect(normalizeCondition("NM")).toBe("NEAR_MINT");
    expect(normalizeCondition("Lightly Played")).toBe("EXCELLENT");
    expect(normalizeLanguage("japanska")).toBe("JP");
    expect(normalizeLanguage("Italiano")).toBe("OTHER");
    expect(normalizePrinting("Reverse Holofoil")).toBe(VARIANT_REVERSE_HOLO);
    expect(normalizePrinting("Holofoil")).toBeNull();
  });

  it("läser kortnummer utan att kasta den nollutfyllda kandidaten", () => {
    const parsed = parseImportNumber("#025/165");
    expect(parsed.number).toBe("25");
    expect(parsed.printedTotal).toBe(165);
    expect(parsed.candidates).toContain("025");
    expect(parsed.candidates).toContain("25");
  });

  it("läser europeiska och amerikanska belopp men aldrig noll", () => {
    expect(parseMoney("1.234,50 kr")).toEqual({ amount: 1234.5, currency: "SEK" });
    expect(parseMoney("$1,234.50")).toEqual({ amount: 1234.5, currency: "USD" });
    expect(parseMoney("0 kr").amount).toBeNull();
    expect(moneyToOre(249.5, "major")).toBe(24_950);
    expect(moneyToOre(24_950, "ore")).toBe(24_950);
    expect(parseQuantity("12 st")).toBe(12);
    expect(parseQuantity("-4")).toBe(1);
  });

  it("gissar en datumordning för hela filen och nekar omöjliga datum", () => {
    vi.useFakeTimers().setSystemTime(new Date("2026-09-10T12:00:00Z"));
    expect(inferDateOrder(["04/12/2025", "18/01/2026"])).toBe("dmy");
    expect(inferDateOrder(["12/04/2025", "01/18/2026"])).toBe("mdy");
    expect(parseImportDate("31/02/2026", "dmy")).toBeNull();
    expect(parseImportDate("2026-02-28")?.toISOString()).toBe("2026-02-28T00:00:00.000Z");
  });
});

describe("utkastrader", () => {
  it("behåller raden men släpper ett utländskt inköpspris", () => {
    const parsed = parseCsv(
      "Card Name,Set,Number,Quantity,Condition,Language,Printing,Purchase Price,Market Value,Notes\n" +
      'Pikachu,151,025/165,2,NM,English,Reverse Holo,$12.50,$40.00,"binder, rad 1"'
    );
    const mapping = autoMapColumns(parsed.headers).mapping;
    const built = buildDraftRows(parsed, mapping, { moneyUnit: "major", fileCurrency: "USD" });

    expect(built.droppedForeignPrices).toBe(1);
    expect(built.ignoredMarketValues).toBe(1);
    expect(built.rows[0]).toMatchObject({
      name: "Pikachu",
      setName: "151",
      quantity: 2,
      condition: "NEAR_MINT",
      language: "EN",
      variantLabel: VARIANT_REVERSE_HOLO,
      purchasePrice: null,
      estimatedValue: null,
      notes: "binder, rad 1",
    });
    expect(looksSealed(built.rows[0])).toBe(false);
  });

  it("importerar kronor som öre och identifierar en sealed-rad", () => {
    const parsed = parseCsv(
      "Title;Item Type;Quantity;Purchase Price\nBooster Box;Sealed;1;1 249,50 kr"
    );
    const mapping = autoMapColumns(parsed.headers).mapping;
    const built = buildDraftRows(parsed, mapping, { moneyUnit: "major", fileCurrency: "SEK" });

    expect(built.rows[0].purchasePrice).toBe(124_950);
    expect(looksSealed(built.rows[0])).toBe(true);
  });

  it("återställer marknadsvärdet bara ur Foilios egen öresbackup", () => {
    const parsed = parseCsv("name,estimatedValue\nPikachu,24950");
    const mapping = autoMapColumns(parsed.headers).mapping;
    const built = buildDraftRows(parsed, mapping, {
      moneyUnit: "ore",
      fileCurrency: "SEK",
      trustEstimatedValue: true,
    });

    expect(built.rows[0].estimatedValue).toBe(24_950);
    expect(built.ignoredMarketValues).toBe(0);
  });
});
