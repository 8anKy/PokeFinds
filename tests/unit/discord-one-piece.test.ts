import { describe, it, expect } from "vitest";
import { classifyDiscordListing } from "../../src/lib/discord-restock-filter";
import { resolveRestockChannelId } from "../../src/lib/discord-restock";

const ctx = { setNames: new Set<string>() };
const verdict = (title: string) => classifyDiscordListing({ title, url: "https://x.se/products/a" }, ctx);

describe("Discord: One Piece-annonser (2026-11-10)", () => {
  it("engelsk sealed One Piece går igenom och märks ONE_PIECE", () => {
    const v = verdict("One Piece TCG: The Time of Battle Booster Box (OP-16)");
    expect(v.ok).toBe(true);
    expect(v.game).toBe("ONE_PIECE");
    expect(verdict("One Piece Card Game: ST32 Starter Deck - Green Roronoa Zoro").ok).toBe(true);
  });
  it("⛔ japansk, case, tillbehör och merch postas aldrig", () => {
    expect(verdict("One Piece TCG: The Time of Battle Booster Box (OP-16) - Japansk").ok).toBe(false);
    expect(verdict("[JP] One Piece · Card Game Display - Royal Bloodline (OP-10)").ok).toBe(false);
    expect(verdict("One Piece OP-16 Booster Box Case").ok).toBe(false);
    expect(verdict("One Piece TCG: Official Sleeves Volume 17 (70 pack)").ok).toBe(false);
    expect(verdict("UltraPop One Piece Läsk Luffy Citron Jordgubb 330 ml").ok).toBe(false);
  });
  it("Pokémon påverkas inte", () => {
    const v = verdict("Pokémon TCG: Destined Rivals Booster Box");
    expect(v.ok).toBe(true);
    expect(v.game).toBeUndefined();
  });
});

describe("Discord: kanalval för One Piece", () => {
  const config = {
    setChannels: {},
    seriesChannels: {},
    languageChannels: {},
    defaultChannelId: "pokemon-default",
    priceChannelId: "prices",
    storeChannelId: "stores",
    onePieceChannelId: "onepiece",
  };
  const post = { setName: null, series: null, language: "EN", storeOnly: false, previousPriceOre: null };
  it("One Piece ⇒ One Piece-kanalen, även prissänkningar", () => {
    expect(resolveRestockChannelId({ ...post, game: "ONE_PIECE" }, config)).toBe("onepiece");
    expect(resolveRestockChannelId({ ...post, game: "ONE_PIECE", previousPriceOre: 50000, priceOre: 40000 }, config)).toBe("onepiece");
  });
  it("butiksvaror går till butikskanalen som för Pokémon", () => {
    expect(resolveRestockChannelId({ ...post, game: "ONE_PIECE", storeOnly: true }, config)).toBe("stores");
  });
  it("⛔ utan One Piece-kanal postas inget — aldrig i en Pokémon-kanal", () => {
    expect(resolveRestockChannelId({ ...post, game: "ONE_PIECE" }, { ...config, onePieceChannelId: null })).toBeNull();
  });
  it("Pokémon routas som förut", () => {
    expect(resolveRestockChannelId(post, config)).toBe("pokemon-default");
  });
});
