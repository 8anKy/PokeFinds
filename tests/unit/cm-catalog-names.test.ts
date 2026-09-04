import { describe, expect, it } from "vitest";
import { backfillCardmarketIds, buildCmIdByName, cmCatalogNameKey } from "@/lib/cm-catalog-names";

/**
 * Vakt för glappet som gjorde ett HELT NYTT set omöjligt att importera: Cardmarket
 * hade Delta Reign 2026-08-20 med alla 18 idProduct satta, RapidAPI publicerade
 * samma produkter med `cardmarket_id: null`, och varje väg in i katalogen
 * (huvudloopen, RECENT_DAYS-läget, gratis-katalog-fallbacken, cardmarket-refresh)
 * kräver ett id. Återfinnandet sker på EXAKT namn — testerna nedan vaktar att det
 * inte glider över i gissning.
 */
describe("cmCatalogNameKey", () => {
  it("normaliserar bara skiftläge och blanktecken", () => {
    expect(cmCatalogNameKey("  Delta Reign   Booster  Box ")).toBe("delta reign booster box");
    expect(cmCatalogNameKey("Delta Reign: Seel 3-Pack Blister")).toBe("delta reign: seel 3-pack blister");
  });

  it("slår INTE ihop namn som skiljer sig på ett ord", () => {
    // "30th Celebration Booster" och "30th Celebration JP Booster" är olika
    // produkter i olika expansioner — nyckeln får aldrig radera skillnaden.
    expect(cmCatalogNameKey("30th Celebration Booster")).not.toBe(
      cmCatalogNameKey("30th Celebration JP Booster")
    );
  });
});

describe("buildCmIdByName", () => {
  it("mappar unika namn till sitt idProduct", () => {
    const map = buildCmIdByName([
      { idProduct: 903956, name: "Delta Reign Booster Box" },
      { idProduct: 903955, name: "Delta Reign Elite Trainer Box" },
    ]);
    expect(map.get("delta reign booster box")).toBe(903956);
    expect(map.size).toBe(2);
  });

  it("KASTAR tvetydiga namn i stället för att gissa", () => {
    const map = buildCmIdByName([
      { idProduct: 300361, name: "Alolan Raichu Box" },
      { idProduct: 311973, name: "Alolan Raichu Box" },
      { idProduct: 903956, name: "Delta Reign Booster Box" },
    ]);
    expect(map.has("alolan raichu box")).toBe(false);
    expect(map.get("delta reign booster box")).toBe(903956);
  });
});

describe("backfillCardmarketIds", () => {
  it("fyller i saknat id ur CM-katalogen", () => {
    const rows = [{ name: "Delta Reign Booster Box", cardmarket_id: null as number | null }];
    const res = backfillCardmarketIds(rows, new Map([["delta reign booster box", 903956]]));
    expect(rows[0].cardmarket_id).toBe(903956);
    expect(res.filled).toBe(1);
  });

  it("rör aldrig en rad som redan har ett id", () => {
    const rows = [{ name: "Delta Reign Booster Box", cardmarket_id: 111 as number | null }];
    backfillCardmarketIds(rows, new Map([["delta reign booster box", 903956]]));
    expect(rows[0].cardmarket_id).toBe(111);
  });

  it("KAPAR aldrig ett id som en annan rad redan äger", () => {
    // Två av våra katalogprodukter på samma idProduct = en av dem visar en
    // FRÄMMANDE prisgraf. Samma unikhetsvakt som fuzzy-grenen i cm-refresh.
    const rows = [
      { name: "Delta Reign Booster Box", cardmarket_id: 903956 as number | null },
      { name: "Delta Reign Booster Box", cardmarket_id: null as number | null },
    ];
    const res = backfillCardmarketIds(rows, new Map([["delta reign booster box", 903956]]));
    expect(rows[1].cardmarket_id).toBeNull();
    expect(res.filled).toBe(0);
    expect(res.skippedTaken).toBe(1);
  });

  it("lämnar okända namn orörda", () => {
    const rows = [{ name: "Delta Reign Booster Pack Art Set", cardmarket_id: null as number | null }];
    const res = backfillCardmarketIds(rows, new Map([["delta reign booster box", 903956]]));
    expect(rows[0].cardmarket_id).toBeNull();
    expect(res.filled).toBe(0);
  });
});
