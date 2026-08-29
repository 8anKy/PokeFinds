/**
 * Japanska singlar (2026-08-29): det enda sök-URL som får bära ett pris, och
 * namn-/titelformen som gör att skannern föredrar EN vid lika läsning.
 */
import { describe, expect, it } from "vitest";
import {
  cardmarketJpSearchUrl,
  cardmarketSearchUrl,
  isCardmarketJpSearchUrl,
  isDirectOfferUrl,
} from "@/lib/marketplace-urls";
import { DIRECT_URL_SQL } from "@/services/products";
import {
  cleanJpEpisodeName,
  jpCardName,
  jpProductTitle,
  normalizeJpRarity,
} from "@/jobs/jp-singles-refresh";

describe("Cardmarket JP-sök som prisbärande länk", () => {
  const jp = cardmarketJpSearchUrl("Venusaur ex");

  it("bygger en namnsök förfiltrerad till japanska annonser, utan vårt (JP)-suffix", () => {
    expect(jp).toBe("https://www.cardmarket.com/en/Pokemon/Products/Search?searchString=Venusaur%20ex&language=7");
    expect(cardmarketJpSearchUrl("Venusaur ex (JP)")).toBe(jp);
  });

  it("är det ENDA sök-URL som räknas som prisbärande", () => {
    expect(isCardmarketJpSearchUrl(jp)).toBe(true);
    expect(isDirectOfferUrl(jp)).toBe(true);
    // Den vanliga CM-söken (site=1, inget språk) är fortfarande en söklänk.
    expect(isDirectOfferUrl(cardmarketSearchUrl("Venusaur ex"))).toBe(false);
    // Engelskt språkfilter räddar inte en söklänk.
    expect(isDirectOfferUrl(jp.replace("language=7", "language=1"))).toBe(false);
    expect(isDirectOfferUrl(jp.replace("language=7", "language=70"))).toBe(false);
    // Tradera-/butikssök är orörda.
    expect(isDirectOfferUrl("https://www.tradera.com/search?q=venusaur&language=7")).toBe(false);
  });

  it("SQL-spegeln bär samma undantag och är parenteserad (den konsumeras efter AND)", () => {
    const sql = DIRECT_URL_SQL.trim();
    expect(sql.startsWith("(")).toBe(true);
    expect(sql.endsWith(")")).toBe(true);
    expect(sql).toContain("cardmarket.com/");
    expect(sql).toContain("/products/search?");
    expect(sql).toContain("language=7");
    expect(sql).toContain("prices.pokemontcg.io/cardmarket");
  });
});

describe("JP-namn och titlar", () => {
  it("kortnamn = engelska namnet + (JP); titel = namn · set nummer/tryckt total", () => {
    expect(jpCardName("Tropius")).toBe("Tropius (JP)");
    // Setkoden stannar på setet, inte i titeln — samma form som EN-singlarna.
    expect(jpProductTitle("Tropius", "Abyss Eye (M5)", "1", 81)).toBe("Tropius (JP) · Abyss Eye 1/81");
    expect(jpProductTitle("Pikachu", "Scarlet & Violet Promos (SVP)", "1", 0)).toBe("Pikachu (JP) · Scarlet & Violet Promos 1");
    expect(jpProductTitle("Roselia", "Sword", "1", 60)).toBe("Roselia (JP) · Sword 1/60");
  });

  it("leverantörens '(Japanese)' i setnamnet tas bort — språket bär kolumnen", () => {
    expect(cleanJpEpisodeName("30th Celebration (Japanese)")).toBe("30th Celebration");
    expect(cleanJpEpisodeName("Abyss Eye")).toBe("Abyss Eye");
  });

  it("sällsynthet normaliseras till Title Case", () => {
    expect(normalizeJpRarity("SECRET RARE")).toBe("Secret Rare");
    expect(normalizeJpRarity("rare")).toBe("Rare");
    expect(normalizeJpRarity("Double Rare")).toBe("Double Rare");
    expect(normalizeJpRarity(null)).toBe("Unknown");
  });
});
