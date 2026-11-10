import { describe, it, expect } from "vitest";
import { gameFromParam, gameParam, gameHasLanguageChoice, DEFAULT_GAME } from "../../src/lib/game";

describe("kortspelet i katalogens URL", () => {
  it("saknad eller okänd parameter är ALLTID Pokémon", () => {
    expect(gameFromParam(undefined)).toBe("POKEMON");
    expect(gameFromParam("")).toBe("POKEMON");
    expect(gameFromParam("magic")).toBe("POKEMON");
    expect(DEFAULT_GAME).toBe("POKEMON");
  });
  it("one-piece i olika stavningar", () => {
    expect(gameFromParam("one-piece")).toBe("ONE_PIECE");
    expect(gameFromParam("ONE_PIECE")).toBe("ONE_PIECE");
    expect(gameFromParam("onepiece")).toBe("ONE_PIECE");
  });
  it("Pokémon har inget URL-värde, så gamla länkar är oförändrade", () => {
    expect(gameParam("POKEMON")).toBeNull();
    expect(gameParam("ONE_PIECE")).toBe("one-piece");
    expect(gameFromParam(gameParam("ONE_PIECE"))).toBe("ONE_PIECE");
  });
  it("språkvalet finns bara för Pokémon", () => {
    expect(gameHasLanguageChoice("POKEMON")).toBe(true);
    expect(gameHasLanguageChoice("ONE_PIECE")).toBe(false);
  });
});
