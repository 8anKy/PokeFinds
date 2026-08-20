import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as setComposition from "@/lib/set-composition";
import {
  computeSetComposition,
  countCardsWithRarity,
  type CompositionCard,
  type SetCompositionRow,
} from "@/lib/set-composition";

function card(rarity: string | null, priceOre: number | null = null): CompositionCard {
  return { rarity, priceOre };
}

/** Bygger n kort av samma sällsynthet, med priserna i tur och ordning. */
function cards(rarity: string | null, prices: (number | null)[]): CompositionCard[] {
  return prices.map((p) => card(rarity, p));
}

function rowFor(
  result: { rows: SetCompositionRow[] },
  rarity: string | null
): SetCompositionRow {
  const row = result.rows.find((r) => r.rarity === rarity);
  if (!row) throw new Error(`Ingen rad för sällsynthet ${String(rarity)}`);
  return row;
}

describe("computeSetComposition — median", () => {
  it("udda antal priser → mittvärdet", () => {
    const result = computeSetComposition(cards("Rare", [10000, 50000, 30000]));
    expect(rowFor(result, "Rare").medianPriceOre).toBe(30000);
  });

  it("jämnt antal priser → snittet av de två mittersta, avrundat till HELA ÖRE", () => {
    const result = computeSetComposition(cards("Rare", [10000, 20000, 30000, 40100]));
    // (20000 + 30000) / 2
    expect(rowFor(result, "Rare").medianPriceOre).toBe(25000);
  });

  it("jämnt antal med udda summa avrundas — aldrig ett halvt öre", () => {
    const result = computeSetComposition(cards("Rare", [100, 101]));
    const median = rowFor(result, "Rare").medianPriceOre!;
    expect(median).toBe(101);
    expect(Number.isInteger(median)).toBe(true);
  });

  it("sorterar priserna NUMERISKT — inte som strängar", () => {
    // Strängsortering hade gett ["1000", "200", "30000"] och medianen 200.
    const result = computeSetComposition(cards("Rare", [1000, 200, 30000]));
    expect(rowFor(result, "Rare").medianPriceOre).toBe(1000);
  });
});

describe("computeSetComposition — okänt pris är inte noll", () => {
  it("en tier utan ETT ENDA prissatt kort ger null, aldrig 0", () => {
    const result = computeSetComposition(cards("Common", [null, null, null]));
    const row = rowFor(result, "Common");
    expect(row.medianPriceOre).toBeNull();
    expect(row.totalPriceOre).toBeNull();
    // ⛔ Hela poängen: "0 kr" läses som gratis, "–" som "vi vet inte".
    expect(row.medianPriceOre).not.toBe(0);
    expect(row.totalPriceOre).not.toBe(0);
    expect(row.pricedCount).toBe(0);
    expect(row.count).toBe(3);
  });

  it("okända priser räknas ALDRIG in som nollor i medianen", () => {
    // Med nollor hade medianen av [0, 0, 1000] blivit 0.
    const result = computeSetComposition(cards("Rare", [null, null, 1000]));
    const row = rowFor(result, "Rare");
    expect(row.medianPriceOre).toBe(1000);
    expect(row.totalPriceOre).toBe(1000);
    expect(row.pricedCount).toBe(1);
    expect(row.count).toBe(3);
  });

  it("0 öre och negativa belopp behandlas som OKÄNT, inte som ett pris", () => {
    const result = computeSetComposition(cards("Rare", [0, -500, 4000]));
    const row = rowFor(result, "Rare");
    expect(row.medianPriceOre).toBe(4000);
    expect(row.totalPriceOre).toBe(4000);
    expect(row.pricedCount).toBe(1);
  });

  it("summan räknas på råvärdena, inte på medianen × antal", () => {
    const result = computeSetComposition(cards("Rare", [100, 101, 999999]));
    const row = rowFor(result, "Rare");
    expect(row.totalPriceOre).toBe(1000200);
    expect(row.medianPriceOre).toBe(101);
  });

  it("pricedCount rapporteras vid sidan av count — delvis data syns", () => {
    const result = computeSetComposition(cards("Illustration Rare", [500, null, 700, null]));
    const row = rowFor(result, "Illustration Rare");
    expect(row.count).toBe(4);
    expect(row.pricedCount).toBe(2);
    expect(result.cardCount).toBe(4);
    expect(result.pricedCardCount).toBe(2);
  });
});

describe("computeSetComposition — andelar", () => {
  it("andelarna summerar till 1 över alla tiers", () => {
    const result = computeSetComposition([
      ...cards("Common", [100, 200, 300, 400, 500, 600, 700]),
      ...cards("Rare", [1000, 2000, 3000]),
      ...cards("Illustration Rare", [50000]),
      card(null, 900),
    ]);
    const sum = result.rows.reduce((acc, r) => acc + r.share, 0);
    expect(sum).toBeCloseTo(1, 10);
  });

  it("andelen är BRÅKDEL (0–1), inte procent, och är count / cardCount", () => {
    const result = computeSetComposition([
      ...cards("Common", [null, null, null]),
      ...cards("Rare", [null]),
    ]);
    expect(rowFor(result, "Common").share).toBeCloseTo(0.75, 10);
    expect(rowFor(result, "Rare").share).toBeCloseTo(0.25, 10);
    for (const row of result.rows) {
      expect(row.share).toBeCloseTo(row.count / result.cardCount, 10);
    }
  });

  it("tomt underlag ger inga rader alls — ingen division med noll", () => {
    const result = computeSetComposition([]);
    expect(result.rows).toEqual([]);
    expect(result.cardCount).toBe(0);
    expect(result.pricedCardCount).toBe(0);
  });
});

describe("computeSetComposition — visningsordning", () => {
  it("FÄRRE KORT FÖRST — chase-tiern överst utan att någon scrollar", () => {
    const result = computeSetComposition([
      ...cards("Common", [100, 100, 100, 100, 100, 100]),
      ...cards("Rare", [1000, 1000, 1000]),
      ...cards("Illustration Rare", [50000]),
    ]);
    expect(result.rows.map((r) => r.rarity)).toEqual([
      "Illustration Rare",
      "Rare",
      "Common",
    ]);
  });

  it("okänd sällsynthet hamnar ALLTID sist, även när den är minst", () => {
    const result = computeSetComposition([
      ...cards("Common", [100, 100, 100]),
      ...cards("Rare", [1000, 1000]),
      card(null, 900),
    ]);
    expect(result.rows.map((r) => r.rarity)).toEqual(["Rare", "Common", null]);
  });

  it("lika många kort → dyrast median först, prislös tier sist", () => {
    const result = computeSetComposition([
      ...cards("Billig", [1000, 1000]),
      ...cards("Dyr", [90000, 90000]),
      ...cards("Prislös", [null, null]),
    ]);
    expect(result.rows.map((r) => r.rarity)).toEqual(["Dyr", "Billig", "Prislös"]);
  });

  it("samma antal och samma median → alfabetiskt, så ordningen är deterministisk", () => {
    const result = computeSetComposition([
      ...cards("Beta", [null, null]),
      ...cards("Alfa", [null, null]),
    ]);
    expect(result.rows.map((r) => r.rarity)).toEqual(["Alfa", "Beta"]);
  });
});

describe("computeSetComposition — sällsynthetens identitet", () => {
  it("skiftläge och blanksteg fälls ihop, men etiketten hittas aldrig på", () => {
    const result = computeSetComposition([
      card("Rare Holo", 100),
      card("rare holo ", 200),
      card("  Rare Holo", 300),
    ]);
    expect(result.rows).toHaveLength(1);
    // Första stavningen vi såg är den vi visar — ingen ordlista, ingen gissning.
    expect(result.rows[0].rarity).toBe("Rare Holo");
    expect(result.rows[0].count).toBe(3);
  });

  it("tom sträng och whitespace är samma sak som ingen sällsynthet", () => {
    const result = computeSetComposition([card(null, 100), card("", 200), card("   ", 300)]);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].rarity).toBeNull();
    expect(result.rows[0].count).toBe(3);
  });
});

describe("countCardsWithRarity", () => {
  const set: CompositionCard[] = [
    ...cards("Common", [100, 100, 100, 100]),
    ...cards("Rare", [1000, 1000]),
    card(null, 500),
  ];

  it("svarar hur många kort i setet som delar sällsyntheten", () => {
    expect(countCardsWithRarity(set, "Common")).toBe(4);
    expect(countCardsWithRarity(set, "Rare")).toBe(2);
  });

  it("normaliserar precis som tabellen — samma tal på båda ytorna", () => {
    expect(countCardsWithRarity(set, " common ")).toBe(4);
  });

  it("okänd sällsynthet räknas som okänd, inte som noll träffar", () => {
    expect(countCardsWithRarity(set, null)).toBe(1);
    expect(countCardsWithRarity(set, "  ")).toBe(1);
  });

  it("en sällsynthet setet inte har ger 0", () => {
    expect(countCardsWithRarity(set, "Hyper Rare")).toBe(0);
  });
});

/**
 * ⛔ REGRESSIONSVAKT: MODULEN FÅR ALDRIG BÖRJA RÄKNA DRAGCHANSER.
 *
 * Sammansättningen finns just för att dragchanser inte går att ta fram ärligt
 * (se filhuvudet i `src/lib/set-composition.ts`). Den frestande genvägen är
 * "ett delat med antalet kort i sällsyntheten" — den är ingen sannolikhet,
 * eftersom paket samlas från tryckark, och den är som mest fel för de set
 * samlare bryr sig mest om. Testerna nedan finns för att en framtida utvecklare
 * inte ska kunna smyga in den utan att bygget blir rött.
 */
describe("⛔ inga dragchanser", () => {
  const SOURCE = readFileSync(
    fileURLToPath(new URL("../../src/lib/set-composition.ts", import.meta.url)),
    "utf8"
  );

  /** Kod utan kommentarer — brasklapparna i texten får inte fälla vakten. */
  const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

  it("källan innehåller ingen division av 1 med något — ingen 1/n någonstans", () => {
    expect(CODE).not.toMatch(/(^|[^\w.$])1\s*\/\s*[A-Za-z_$(]/);
  });

  it("inget exporterat namn låter som odds", () => {
    const forbidden = [
      "odds",
      "pullrate",
      "pull_rate",
      "probab",
      "chance",
      "likelihood",
      "sannolik",
      "dragchans",
      "hitrate",
    ];
    for (const name of Object.keys(setComposition)) {
      const flat = name.toLowerCase().replace(/[^a-z_]/g, "");
      for (const word of forbidden) {
        expect(flat, `exporten "${name}" låter som en dragchans`).not.toContain(word);
      }
    }
  });

  it("ingen rad bär ett tal som ser ut som 1 delat med radens antal", () => {
    // Underlaget är valt så att 1/count skiljer sig från VARJE fält i raden:
    // 2 kort (1/2 = 0,5 mot andelen 0,1), 8 kort (0,125 mot 0,4), 10 (0,1 mot 0,5).
    const result = computeSetComposition([
      ...cards("Illustration Rare", [90000, 120000]),
      ...cards("Rare", [4000, 4100, 4200, 4300, 4400, 4500, 4600, 4700]),
      ...cards("Common", [100, 110, 120, 130, 140, 150, 160, 170, 180, 190]),
    ]);
    expect(result.cardCount).toBe(20);

    for (const row of result.rows) {
      const lookalike = 1 / row.count;
      const values = [
        row.count,
        row.pricedCount,
        row.share,
        row.medianPriceOre,
        row.totalPriceOre,
      ].filter((v): v is number => typeof v === "number");
      for (const value of values) {
        expect(
          value,
          `raden "${row.rarity}" bär ett tal som ser ut som en dragchans`
        ).not.toBeCloseTo(lookalike, 10);
      }
    }
  });

  it("exporterar bara sammansättning — inga oväntade funktioner", () => {
    expect(Object.keys(setComposition).sort()).toEqual([
      "computeSetComposition",
      "countCardsWithRarity",
    ]);
  });
});
