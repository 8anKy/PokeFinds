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

/**
 * Spelens loggor i spelväljaren (2026-11-11). Identifierare för vilket spel man bläddrar i
 * (referensbruk, som butiksloggorna). Pokémon = Wikimedia Commons "International Pokémon logo",
 * One Piece = Bandais vita logga från en.onepiece-cardgame.com — båda omgjorda till PNG, 96 px höga
 * (`public/game-logos/`). Den färgade One Piece-loggan är svart text och syns inte på vår svarta yta.
 */
export const GAME_LOGO: Record<Game, string> = {
  POKEMON: "/game-logos/pokemon.png",
  ONE_PIECE: "/game-logos/one-piece.png",
};

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

/** Enhetens senast valda kortspel i katalogen (localStorage). Bara ett val — ingen användardata. */
export const GAME_STORAGE_KEY = "foilio:catalog-game:v1";

/**
 * Spara valet. ⛔ VARJE spelväljare måste anropa den (2026-11-11): desktopens knappar bytte bara
 * URL:en, så "Pokémon" gav en bar /produkter och minnet skickade tillbaka till One Piece.
 */
export function rememberGame(game: Game): void {
  try {
    if (game === DEFAULT_GAME) localStorage.removeItem(GAME_STORAGE_KEY);
    else localStorage.setItem(GAME_STORAGE_KEY, gameParam(game) ?? "");
  } catch {
    /* privat läge / full lagring — valet gäller ändå för den här sidan */
  }
}
