import { describe, expect, it } from "vitest";
import { expansionSetJoin } from "@/lib/cm-expansion-join";

/**
 * Vakt mot container-expansionsfällan (2026-08-09): CM:s expansion 1645 rymmer
 * 1 094 tins från tjugo år, och EN felmärkt produkt i den räckte för att
 * "enhälligt" föreslå 300 fel-etiketter. Kravet är dubbelriktat: expansionens
 * etiketterade måste vara ense OCH hela målsetet måste bo i expansionen.
 */
describe("expansionSetJoin", () => {
  const exp = new Map<number, number>([
    // set-expansionen 6601 (30th Celebration)
    [895551, 6601], [895553, 6601], [895745, 6601],
    // container-expansionen 1645 (tins från alla eror)
    [399294, 1645], [669614, 1645], [605849, 1645],
    // Mega Evolutions egen expansion
    [900001, 9001], [900002, 9001],
  ]);

  it("mappar en äkta set-expansion (enhällig + hela setet bor där)", () => {
    const join = expansionSetJoin(
      [
        { setId: "s30", idProduct: 895551 },
        { setId: "s30", idProduct: 895553 },
        { setId: null, idProduct: 895745 },
      ],
      exp
    );
    expect(join.get(6601)).toBe("s30");
  });

  it("avvisar en container-expansion: den enda rösten är en felmärkning vars set bor någon annanstans", () => {
    const join = expansionSetJoin(
      [
        // Rillaboom-tinnen: felmärkt Mega Evolution, bor i containern 1645
        { setId: "me", idProduct: 399294 },
        // Mega Evolutions riktiga produkter bor i 9001
        { setId: "me", idProduct: 900001 },
        { setId: "me", idProduct: 900002 },
      ],
      exp
    );
    expect(join.has(1645)).toBe(false);
    // och 9001 → me faller OCKSÅ (setet spretar över två expansioner) — hellre
    // oetiketterad än fel-etiketterad.
    expect(join.has(9001)).toBe(false);
  });

  it("avvisar spretande röster inom en expansion", () => {
    const join = expansionSetJoin(
      [
        { setId: "a", idProduct: 895551 },
        { setId: "b", idProduct: 895553 },
      ],
      exp
    );
    expect(join.has(6601)).toBe(false);
  });

  it("hoppar över rader utan setId eller utan känd expansion", () => {
    const join = expansionSetJoin(
      [
        { setId: null, idProduct: 895551 },
        { setId: "s30", idProduct: null },
        { setId: "s30", idProduct: 12345 }, // okänt idProduct
      ],
      exp
    );
    expect(join.size).toBe(0);
  });
});
