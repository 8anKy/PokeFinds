import { describe, expect, it } from "vitest";
import {
  bucketGradedAsks,
  buildGradedSearchQuery,
  titleCarriesNumber,
  titleFitsSet,
  type EbayItemSummary,
  type GradedAskProduct,
} from "@/lib/graded-ask";
import { priceOreFromUsd } from "@/lib/exchange-rate";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * ⛔ SÖKNINGEN ÄR FUZZY — varje träff måste bevisa sig. Testerna nedan är
 * tvåsidiga: rätt kort med läsbart betyg ska ge en rad, och fel nummer, fel
 * språk, lotter, auktioner och okänt betyg ska INTE ge någon — hellre en tom
 * tabell än ett främmande pris. `bucketGradedAsks` är ren (ingen DB, ingen
 * nätverk) just för att kunna vaktas så här.
 */

const charizard: GradedAskProduct = {
  id: "p1",
  language: "EN",
  variantLabel: null,
  card: { name: "Charizard ex", number: "199", set: { name: "Obsidian Flames", totalCards: 197 } },
};

function item(
  title: string,
  value: string,
  extra: Partial<EbayItemSummary> = {}
): EbayItemSummary {
  return {
    itemId: `v1|${Math.random().toString(36).slice(2)}|0`,
    title,
    price: { value, currency: "USD" },
    itemWebUrl: "https://www.ebay.com/itm/1",
    buyingOptions: ["FIXED_PRICE"],
    ...extra,
  };
}

describe("buildGradedSearchQuery", () => {
  it("namn + nummer, Japanese för JP", () => {
    expect(buildGradedSearchQuery(charizard)).toBe("Charizard ex 199");
    expect(buildGradedSearchQuery({ ...charizard, language: "JP" })).toBe("Charizard ex 199 Japanese");
  });
});

describe("titleCarriesNumber", () => {
  it("kräver produktens nummer — X/Y-formen vinner, bart nummer duger", () => {
    expect(titleCarriesNumber("Charizard ex 199/197 Obsidian Flames PSA 10", "199")).toBe(true);
    expect(titleCarriesNumber("Charizard ex #199 PSA 10", "199")).toBe(true);
    expect(titleCarriesNumber("Charizard ex 125/197 PSA 10", "199")).toBe(false);
    // Bokstavssuffix skiljer kort åt ("115a" ≠ "115") och kräver X/Y-formen.
    expect(titleCarriesNumber("Pikachu 115a/108 PSA 9", "115a")).toBe(true);
    expect(titleCarriesNumber("Pikachu 115/108 PSA 9", "115a")).toBe(false);
  });
});

describe("titleFitsSet", () => {
  const typhlosion: GradedAskProduct = {
    id: "p2",
    language: "EN",
    variantLabel: null,
    card: { name: "Typhlosion", number: "17", set: { name: "Neo Genesis", totalCards: 111 } },
  };

  it("X/Y: nämnaren måste vara setets tryckta total", () => {
    expect(titleFitsSet("Typhlosion 17/111 Neo Genesis PSA 6", typhlosion)).toBe(true);
    // Samma namn + nummer i ett modernt set — eBays sök tar båda.
    expect(titleFitsSet("Typhlosion 17/162 Temporal Forces PSA 6", typhlosion)).toBe(false);
    // Okänd total (0) ⇒ ingen dom på nämnaren.
    expect(
      titleFitsSet("Typhlosion 17/162 PSA 6", { ...typhlosion, card: { ...typhlosion.card, set: { name: "Neo Genesis", totalCards: 0 } } })
    ).toBe(true);
  });

  it("bart nummer: setnamnets utpekande ord måste stå i titeln", () => {
    expect(titleFitsSet("2000 Pokemon Neo Genesis #17 Typhlosion PSA 6", typhlosion)).toBe(true);
    expect(titleFitsSet("Pokemon Typhlosion #17 Holo PSA 6", typhlosion)).toBe(false);
    // "151" är setets namn — eBay-titlar skriver "MEW EN-151".
    const mew151 = { ...charizard, card: { ...charizard.card, set: { name: "151", totalCards: 165 } } };
    expect(titleFitsSet("2023 POKEMON MEW EN-151 SPECIAL ILLUSTRATION RARE #199 CHARIZARD EX PSA 7", mew151)).toBe(true);
    // Era-ord bevisar inget: "Scarlet & Violet" står i varje SV-set.
    const svBase = { ...charizard, card: { ...charizard.card, set: { name: "Scarlet & Violet", totalCards: 198 } } };
    expect(titleFitsSet("Charizard ex #199 Scarlet & Violet PSA 10", svBase)).toBe(false);
    expect(titleFitsSet("Charizard ex 199/198 Scarlet & Violet PSA 10", svBase)).toBe(true);
  });

  it("bucketGradedAsks kastar annonser ur fel set", () => {
    const rows = bucketGradedAsks(
      [
        item("Typhlosion 17/111 Neo Genesis PSA 6", "300"),
        item("Typhlosion 17/162 Temporal Forces PSA 6", "25"),
        item("Typhlosion #17 PSA 6", "20"),
      ],
      typhlosion
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].amount).toBe(300);
  });
});

describe("bucketGradedAsks", () => {
  it("bucketar per bolag+betyg och behåller billigaste", () => {
    const rows = bucketGradedAsks(
      [
        item("Charizard ex 199/197 Obsidian Flames PSA 10 Gem Mint", "349.99"),
        item("PSA 10 Charizard ex 199/197 SIR Obsidian Flames", "299.00"),
        item("Charizard ex 199/197 PSA 9 Mint", "120.00"),
        item("Charizard ex 199/197 CGC 10 Pristine", "410.00"),
      ],
      charizard
    );
    const psa10 = rows.find((r) => r.issuer === "PSA" && r.gradeTenths === 100)!;
    expect(psa10.amount).toBe(299);
    expect(psa10.listingCount).toBe(2);
    expect(psa10.title).toContain("PSA 10 Charizard");
    expect(rows.find((r) => r.issuer === "PSA" && r.gradeTenths === 90)?.amount).toBe(120);
    expect(rows.find((r) => r.issuer === "CGC" && r.gradeTenths === 100)?.amount).toBe(410);
    expect(rows).toHaveLength(3);
  });

  it("kastar fel nummer, lotter, auktioner, okänt betyg och fel språk", () => {
    const rows = bucketGradedAsks(
      [
        // Fel kort — eBay matchar gärna på namnet ensamt.
        item("Charizard ex 125/197 Obsidian Flames PSA 10", "50"),
        // Lott.
        item("Lot of 3 Charizard ex 199/197 PSA 10", "900"),
        item("2x Charizard ex 199/197 PSA 10", "600"),
        // Auktion utan fastpris — nuvarande bud är inte ett begärt pris.
        item("Charizard ex 199/197 PSA 10", "1.00", { buyingOptions: ["AUCTION"] }),
        // Bolag utan betyg.
        item("Charizard ex 199/197 PSA graded", "80"),
        // Japanskt exemplar på en EN-produkt.
        item("Charizard ex 199/197 Japanese PSA 10", "150"),
        // Aspirationsspråk — ograderat kort.
        item("Charizard ex 199/197 PSA 10 candidate ungraded", "40"),
        // Nollpris.
        item("Charizard ex 199/197 PSA 10", "0"),
      ],
      charizard
    );
    expect(rows).toHaveLength(0);
  });

  it("'Mega Charizard X' är ett kortnamn, inte en kvantitet", () => {
    const rows = bucketGradedAsks(
      [item("Mega Charizard X 108/106 XY Flashfire PSA 9", "60")],
      { ...charizard, card: { name: "Mega Charizard X", number: "108", set: { name: "Flashfire", totalCards: 106 } } }
    );
    expect(rows).toHaveLength(1);
  });

  it("tryckningen måste stämma — 1st Edition bär inte Unlimiteds pris", () => {
    const unlimited = { ...charizard, card: { name: "Charizard", number: "4", set: { name: "Base", totalCards: 102 } } };
    const rows = bucketGradedAsks(
      [
        item("Charizard 4/102 Base Set 1st Edition PSA 8", "5000"),
        item("Charizard 4/102 Base Set Unlimited PSA 8", "900"),
      ],
      unlimited
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].amount).toBe(900);
  });

  it("blandade valutor i samma grupp räknas inte ihop", () => {
    const rows = bucketGradedAsks(
      [
        item("Charizard ex 199/197 PSA 10", "300"),
        item("Charizard ex 199/197 PSA 10", "250", { price: { value: "250", currency: "EUR" } }),
      ],
      charizard
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].currency).toBe("USD");
    expect(rows[0].listingCount).toBe(1);
  });
});

describe("priceOreFromUsd", () => {
  it("samma nollvakt som EUR-vägen", () => {
    const rates = { usdToOre: 1050 };
    expect(priceOreFromUsd(1, rates)).toBe(1050);
    expect(priceOreFromUsd(0, rates)).toBeNull();
    expect(priceOreFromUsd(0.0001, rates)).toBeNull();
    expect(priceOreFromUsd(NaN, rates)).toBeNull();
    expect(priceOreFromUsd(null, rates)).toBeNull();
  });
});

describe("workflow", () => {
  it("eBay-svepet är ett STEG i tradera-sold-sync, aldrig egen cron", () => {
    const yml = readFileSync(join(process.cwd(), ".github/workflows/tradera-sold-sync.yml"), "utf8");
    expect(yml).toMatch(/scripts\/graded-ask-sweep\.ts/);
    expect(yml).toMatch(/EBAY_CLIENT_ID/);
  });
});
