/** Tester för normalizeTitle och slugify i src/lib/utils.ts. */
import { describe, expect, it } from "vitest";
import { normalizeTitle, slugify } from "@/lib/utils";

describe("normalizeTitle", () => {
  it("gör gemener och tar bort diakritiska tecken", () => {
    expect(normalizeTitle("Pokémon")).toBe("pokemon");
  });

  it("ersätter specialtecken med mellanslag och kollapsar whitespace", () => {
    expect(normalizeTitle("Pokémon TCG: Booster   Box!")).toBe("pokemon tcg booster box");
  });

  it("behåller setnummer med snedstreck", () => {
    expect(normalizeTitle("Pikachu 25/102 Holo")).toBe("pikachu 25/102 holo");
  });

  it("behåller bindestreck", () => {
    expect(normalizeTitle("Scarlet-Violet ETB")).toBe("scarlet-violet etb");
  });

  it("trimmar inledande/avslutande whitespace", () => {
    expect(normalizeTitle("  Charizard  ")).toBe("charizard");
  });

  it("hanterar svenska tecken (å/ä/ö → a/a/o)", () => {
    expect(normalizeTitle("Låda för Pokémonkort")).toBe("lada for pokemonkort");
  });

  it("returnerar tom sträng för enbart specialtecken", () => {
    expect(normalizeTitle("!!!***")).toBe("");
  });
});

describe("slugify", () => {
  it("skapar url-vänlig slug", () => {
    expect(slugify("Surging Sparks Booster Box")).toBe("surging-sparks-booster-box");
  });

  it("tar bort diakritiska tecken", () => {
    expect(slugify("Pokémon Évolution 151")).toBe("pokemon-evolution-151");
  });

  it("trimmar bindestreck i början och slutet", () => {
    expect(slugify("  Hello World!  ")).toBe("hello-world");
  });

  it("kollapsar flera specialtecken till ett bindestreck", () => {
    expect(slugify("a / b & c")).toBe("a-b-c");
  });

  it("hanterar siffror", () => {
    expect(slugify("Pikachu 25/102")).toBe("pikachu-25-102");
  });
});
