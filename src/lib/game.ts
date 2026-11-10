/**
 * KORTSPELEN I KATALOGEN (2026-11-10, One Piece steg 1). Ren modul — delas av server och klient.
 *
 * URL-parametern heter `spel` (svenska, som resten av katalogens parametrar): saknas den är
 * spelet Pokémon. ⛔ Default är ALLTID Pokémon — en befintlig länk, ett cachat flöde eller ett
 * anrop som inte vet om spelfiltret ska se exakt det katalogen visade före One Piece.
 */
import type { Game } from "@prisma/client";

export const GAMES = ["POKEMON", "ONE_PIECE"] as const satisfies readonly Game[];
export const DEFAULT_GAME: Game = "POKEMON";

/** URL-värde ↔ spel. Pokémon har inget URL-värde (default). */
const SLUG_BY_GAME: Record<Game, string> = { POKEMON: "pokemon", ONE_PIECE: "one-piece" };

export const GAME_LABEL: Record<Game, string> = { POKEMON: "Pokémon", ONE_PIECE: "One Piece" };

export function gameFromParam(value: string | null | undefined): Game {
  const v = (value ?? "").trim().toLowerCase();
  if (v === "one-piece" || v === "one_piece" || v === "onepiece") return "ONE_PIECE";
  return DEFAULT_GAME;
}

/** `spel`-parameterns värde för ett spel; `null` = utelämna (Pokémon). */
export function gameParam(game: Game): string | null {
  return game === DEFAULT_GAME ? null : SLUG_BY_GAME[game];
}

/** Språkfiltret betyder bara något där spelet finns på flera språk (One Piece: bara engelska). */
export function gameHasLanguageChoice(game: Game): boolean {
  return game === "POKEMON";
}
