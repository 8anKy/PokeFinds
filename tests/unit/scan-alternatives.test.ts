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

  it("visar BILDENS topplista även när texten vann på ett trunkerat namn", () => {
    // Fältfallet: modellen läste "Komala" på ett kort som heter "Larry's
    // Komala". Texten matchade Komala 185 EXAKT och slog bilden. Vinnaren delar
    // varken namn eller konst med rätt kort, så bara artRank räddar det.
    const out = pickAlternatives(
      [
        card({ cardId: "komala-185", name: "Komala", score: 1.2 }),
        card({ cardId: "larrys-komala-175", name: "Larry's Komala", score: 0.3, artRank: 1 }),
      ],
      { cardId: "komala-185", productId: null, score: 1.2 }
    );
    expect(out.map((c) => c.cardId)).toEqual(["larrys-komala-175"]);
  });

  it("sorterar bildens topp efter dess EGEN rangordning, inte efter slutpoäng", () => {
    const out = pickAlternatives(
      [
        card({ cardId: "m", score: 1.2 }),
        card({ cardId: "art2", score: 0.9, artRank: 2 }),
        card({ cardId: "art1", score: 0.3, artRank: 1 }),
      ],
      { cardId: "m", productId: null, score: 1.2 }
    );
    expect(out.map((c) => c.cardId)).toEqual(["art1", "art2"]);
  });

  it("gallrar bort ORELATERADE kort som ligger utanför poängfönstret", () => {
    const out = pickAlternatives(
      [
        card({ cardId: "raboot-27", score: 1.15 }),
        // Annat namn, annan konst, långt under → ingen förväxlingsrisk.
        card({ cardId: "scorbunny", name: "Scorbunny", score: 0.4, sameArt: false }),
      ],
      { ...match, name: "Raboot" }
    );
    expect(out).toHaveLength(0);
  });

  it("visar SAMMA NAMN i andra set — de har poäng 0 och föll ur varje fönster", () => {
    // MÄTT mot prod 2026-08-04: en bildavgjord skanning av Mudbray #107 gav
    // Terrakion #54 och Tyrunt #44 (bildens tvåa och trea, 0,26 mot träffens
    // 1,45) medan alla fyra andra Mudbray kastades — servern skickade dem, med
    // poäng 0 just för att poängen inte kom ur en matchning, och fönstret mäter
    // avstånd till träffen. 0 ligger per definition utanför.
    const out = pickAlternatives(
      [
        card({ cardId: "mudbray-107", name: "Mudbray", score: 1.45 }),
        card({ cardId: "terrakion-54", name: "Terrakion", score: 0.267, artRank: 2 }),
        card({ cardId: "mudbray-91", name: "Mudbray", score: 0 }),
        card({ cardId: "mudbray-96", name: "Mudbray", score: 0 }),
      ],
      { cardId: "mudbray-107", productId: null, score: 1.45, name: "Mudbray" }
    );
    expect(out.map((c) => c.cardId)).toEqual(["terrakion-54", "mudbray-91", "mudbray-96"]);
  });

  it("bildens topp ligger FÖRE namnsyskonen — den ordningen är fältbevisad", () => {
    // Komala-fallet: med ett trunkerat namn är syskonen en lista över FEL kort
    // medan bilden pekar rätt. Namnregeln får inte tränga undan den.
    const out = pickAlternatives(
      [
        card({ cardId: "komala-185", name: "Komala", score: 1.2 }),
        card({ cardId: "komala-annat-set", name: "Komala", score: 0 }),
        card({ cardId: "larrys-komala", name: "Larry's Komala", score: 0.3, artRank: 1 }),
      ],
      { cardId: "komala-185", productId: null, score: 1.2, name: "Komala" }
    );
    expect(out[0].cardId).toBe("larrys-komala");
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
