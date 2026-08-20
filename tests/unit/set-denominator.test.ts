/**
 * Nämnarna för set-komplettering. Rena funktioner — ingen databas, inga mockar.
 * Fallen nedan är MÄTTA i produktion 2026-08-20, inte påhittade.
 */
import { describe, expect, it } from "vitest";
import {
  resolveSetTotals,
  completionPercent,
  SET_FULL_TOTAL_SQL,
} from "@/lib/set-denominator";

describe("resolveSetTotals", () => {
  it("mäter mot HELA setet, inte mot det tryckta talet (Pitch Black)", () => {
    // 84 står på kortet, 120 kort finns. Mot 84 hade en secret rare gett "120 av 84".
    const t = resolveSetTotals({ totalCards: 84, totalCardsFull: 120, cardCount: 120 });
    expect(t.full).toBe(120);
    expect(t.printed).toBe(84);
    expect(t.catalogShort).toBe(false);
  });

  it("tar VÅR lista när uppströms är inaktuell (de sex växande promoseten)", () => {
    // sve: pokemontcg.io:s /sets.total säger 8, vi har 16 riktiga kort.
    const t = resolveSetTotals({ totalCards: 8, totalCardsFull: 8, cardCount: 16 });
    expect(t.full).toBe(16);
    expect(t.catalogShort).toBe(false);
  });

  it("flaggar catalogShort när setet är större än vår lista", () => {
    const t = resolveSetTotals({ totalCards: 159, totalCardsFull: 190, cardCount: 150 });
    expect(t.full).toBe(190);
    expect(t.catalogShort).toBe(true);
  });

  it("saknat facit ⇒ nämnaren blir vår egen lista (MEP Black Star Promos)", () => {
    const t = resolveSetTotals({ totalCards: 93, totalCardsFull: 0, cardCount: 84 });
    expect(t.full).toBe(84);
    expect(t.catalogShort).toBe(false);
  });

  it("noll kort ⇒ null, ALDRIG 0 (de 95 japanska seten)", () => {
    const t = resolveSetTotals({ totalCards: 0, totalCardsFull: 0, cardCount: 0 });
    expect(t.full).toBeNull();
    expect(t.printed).toBeNull();
    expect(t.printings).toBeNull();
  });

  it("master set-nämnaren är vad VI listar, aldrig TCGdex tal", () => {
    const t = resolveSetTotals({
      totalCards: 84,
      totalCardsFull: 120,
      cardCount: 120,
      listedPrintings: 187,
      printingsTotal: 187,
    });
    expect(t.printings).toBe(187);
    expect(t.printingsElsewhere).toBeNull(); // vi listar alla ⇒ ingen not
  });

  it("noten visas när setet har fler tryckningar än vi listar (Pokémon GO)", () => {
    const t = resolveSetTotals({
      totalCards: 78,
      totalCardsFull: 88,
      cardCount: 88,
      listedPrintings: 88,
      printingsTotal: 145,
    });
    expect(t.printings).toBe(88); // nämnaren är fortfarande NÅBAR
    expect(t.printingsElsewhere).toBe(145);
  });

  it("okänt tryckningsfacit ger ingen not", () => {
    const t = resolveSetTotals({
      totalCards: 236,
      totalCardsFull: 258,
      cardCount: 261,
      listedPrintings: 432,
      printingsTotal: 0,
    });
    expect(t.printingsElsewhere).toBeNull();
  });

  it("listar vi inga tryckningar finns ingen master set-rad", () => {
    const t = resolveSetTotals({
      totalCards: 0,
      totalCardsFull: 0,
      cardCount: 0,
      listedPrintings: 0,
      printingsTotal: 145,
    });
    expect(t.printings).toBeNull();
    expect(t.printingsElsewhere).toBeNull();
  });
});

describe("completionPercent", () => {
  it("null nämnare ⇒ null, aldrig 0 %", () => {
    expect(completionPercent(0, null)).toBeNull();
    expect(completionPercent(5, 0)).toBeNull();
  });

  it("räknar och avrundar", () => {
    expect(completionPercent(64, 120)).toBe(53);
    expect(completionPercent(120, 120)).toBe(100);
    expect(completionPercent(0, 120)).toBe(0);
  });

  it("klampar över 100 — en katalog som halkar efter får inte visa 104 %", () => {
    expect(completionPercent(125, 120)).toBe(100);
  });
});

describe("SET_FULL_TOTAL_SQL", () => {
  it("räknar samma sak som resolveSetTotals: GREATEST av facit och vår lista", () => {
    // Vaktar att någon inte tyst byter tillbaka till `CASE WHEN totalCards > 0`,
    // vilket var uttrycket veckobrevet bar innan secret rares räknades med.
    expect(SET_FULL_TOTAL_SQL).toContain("GREATEST");
    expect(SET_FULL_TOTAL_SQL).toContain('s."totalCardsFull"');
    expect(SET_FULL_TOTAL_SQL).toContain("cnt");
    expect(SET_FULL_TOTAL_SQL).not.toContain("totalCards\"");
  });
});
