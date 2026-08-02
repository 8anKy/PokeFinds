import { describe, expect, it } from "vitest";
import {
  ALT_SCORE_WINDOW,
  MAX_ALTERNATIVES,
  pickAlternatives,
  type AlternativeLike,
} from "@/lib/scan-alternatives";

function card(over: Partial<AlternativeLike> & { cardId: string; score: number }): AlternativeLike {
  return { productId: null, name: "Raboot", sameArt: false, ...over };
}

describe("pickAlternatives", () => {
  const match = { cardId: "raboot-27", productId: null, score: 1.15 };

  it("visar omtryck med SAMMA KONST även när poängen ligger långt under träffen", () => {
    // Fältfallet: träffen fick förtroendebonusen (ART_TRUST 1,15) och syskonet
    // hamnade långt utanför fönstret. Utan den här regeln gick #37 inte att välja.
    const out = pickAlternatives(
      [
        card({ cardId: "raboot-27", score: 1.15 }),
        card({ cardId: "raboot-37", score: 0.31, sameArt: true }),
      ],
      match
    );
    expect(out.map((c) => c.cardId)).toEqual(["raboot-37"]);
  });

  it("gallrar bort kort med ANNAN konst som ligger utanför poängfönstret", () => {
    const out = pickAlternatives(
      [
        card({ cardId: "raboot-27", score: 1.15 }),
        // Samma NAMN men annan konst, långt under → ska INTE visas. Det var
        // hela poängen med att byta namnregeln mot konstregeln.
        card({ cardId: "raboot-other-art", score: 0.4, sameArt: false }),
      ],
      match
    );
    expect(out).toHaveLength(0);
  });

  it("behåller kort med annan konst som ligger INOM fönstret", () => {
    const inside = match.score - ALT_SCORE_WINDOW + 0.01;
    const out = pickAlternatives(
      [card({ cardId: "raboot-27", score: 1.15 }), card({ cardId: "nära", score: inside })],
      match
    );
    expect(out.map((c) => c.cardId)).toEqual(["nära"]);
  });

  it("lägger omtrycken FÖRST, även när ett annat kort har högre poäng", () => {
    const out = pickAlternatives(
      [
        card({ cardId: "raboot-27", score: 1.15 }),
        card({ cardId: "hög-poäng", score: 1.1 }),
        card({ cardId: "omtryck", score: 0.2, sameArt: true }),
      ],
      match
    );
    expect(out[0].cardId).toBe("omtryck");
  });

  it("skiljer TRYCKNINGAR av samma kort — träffen filtreras på produkt, inte bara cardId", () => {
    // Base-korten delar cardId över tre produkter. Ett `cardId !==`-filter hade
    // slängt ut precis de rader användaren behöver för att säga "min är 1st Ed".
    const out = pickAlternatives(
      [
        card({ cardId: "base-4", productId: "unlimited", score: 1.0, sameArt: true }),
        card({ cardId: "base-4", productId: "shadowless", score: 0.99, sameArt: true }),
      ],
      { cardId: "base-4", productId: "unlimited", score: 1.0 }
    );
    expect(out.map((c) => c.productId)).toEqual(["shadowless"]);
  });

  it("kapar listan vid MAX_ALTERNATIVES", () => {
    const many = Array.from({ length: 20 }, (_, i) =>
      card({ cardId: `x${i}`, score: 0.1, sameArt: true })
    );
    const out = pickAlternatives([card({ cardId: "m", score: 1 }), ...many], {
      cardId: "m",
      productId: null,
      score: 1,
    });
    expect(out).toHaveLength(MAX_ALTERNATIVES);
  });

  it("utan träff (ingen match) mäts fönstret mot listans bästa kandidat", () => {
    const out = pickAlternatives(
      [card({ cardId: "a", score: 0.8 }), card({ cardId: "b", score: 0.75 }), card({ cardId: "c", score: 0.2 })],
      null
    );
    expect(out.map((c) => c.cardId)).toEqual(["a", "b"]);
  });

  it("saknad sameArt-flagga (bildmatchning kördes inte) faller tillbaka på fönstret", () => {
    const out = pickAlternatives(
      [
        { cardId: "m", productId: null, name: "Raboot", score: 1.0 },
        { cardId: "lågt", productId: null, name: "Raboot", score: 0.1 },
      ],
      { cardId: "m", productId: null, score: 1.0 }
    );
    expect(out).toHaveLength(0);
  });
});
