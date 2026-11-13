import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Skannerns spelspak (lib/scanner-exclusion.ts): utan SCANNER_ONE_PIECE=1 är skannern Pokémon —
 * engine-sync, konstindexet och kandidatuppslagen delar SAMMA lista, så av betyder av överallt.
 */
describe("SCANNER_GAMES", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("är bara Pokémon utan spaken", async () => {
    vi.stubEnv("SCANNER_ONE_PIECE", "");
    const m = await import("@/lib/scanner-exclusion");
    expect(m.SCANNER_GAMES).toEqual(["POKEMON"]);
    expect(JSON.stringify(m.SCANNER_INCLUDED_CARD)).toContain('"in":["POKEMON"]');
  });

  it("tar med One Piece när spaken är på", async () => {
    vi.stubEnv("SCANNER_ONE_PIECE", "1");
    const m = await import("@/lib/scanner-exclusion");
    expect(m.SCANNER_GAMES).toEqual(["POKEMON", "ONE_PIECE"]);
  });
});
