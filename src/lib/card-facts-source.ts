/**
 * KORTFAKTA UR KÄLLORNA — ren normalisering av TCGdex- och pokemontcg.io-svar till
 * de kolumner `Card` bär (artist, types, weakness, retreatCost, regulationMark,
 * dexId, flavorText). Ingen hämtning här; `scripts/backfill-card-facts.ts` och
 * importen anropar och skriver.
 *
 * ⛔ `null`/tom lista = "källan vet inte", aldrig "kortet saknar". Skrivningen
 * gör COALESCE(nytt, gammalt) så en tunn källa aldrig raderar en fyllig.
 */

import type { TcgCard } from "@/scrapers/adapters/pokemontcg-adapter";

export interface CardFactsPatch {
  artist: string | null;
  hp: number | null;
  types: string[];
  weaknessType: string | null;
  weaknessValue: string | null;
  retreatCost: number | null;
  regulationMark: string | null;
  dexId: number | null;
  flavorText: string | null;
}

/** Det ur ett TCGdex-kortsvar vi läser (`/v2/en/cards/<id>`). */
export interface TcgdexCardLike {
  illustrator?: string | null;
  hp?: number | null;
  types?: string[] | null;
  weaknesses?: { type: string; value?: string | null }[] | null;
  retreat?: number | null;
  regulationMark?: string | null;
  dexId?: number[] | null;
  description?: string | null;
}

const clean = (s: string | null | undefined): string | null => {
  const t = s?.trim();
  return t ? t : null;
};

const intOrNull = (n: unknown): number | null =>
  typeof n === "number" && Number.isFinite(n) ? Math.trunc(n) : null;

export function factsFromTcgdex(c: TcgdexCardLike): CardFactsPatch {
  const w = c.weaknesses?.[0];
  return {
    artist: clean(c.illustrator),
    hp: intOrNull(c.hp),
    types: (c.types ?? []).map((t) => t.trim()).filter(Boolean),
    weaknessType: clean(w?.type),
    weaknessValue: clean(w?.value),
    retreatCost: intOrNull(c.retreat),
    regulationMark: clean(c.regulationMark),
    dexId: intOrNull(c.dexId?.[0]),
    flavorText: clean(c.description),
  };
}

/** pokemontcg.io: HP är en sträng ("90"), retreatCost en lista av energisymboler. */
export function factsFromPokemontcg(c: TcgCard): CardFactsPatch {
  const hp = c.hp != null ? parseInt(c.hp, 10) : NaN;
  const w = c.weaknesses?.[0];
  return {
    artist: clean(c.artist),
    hp: Number.isFinite(hp) && hp > 0 ? hp : null,
    types: (c.types ?? []).map((t) => t.trim()).filter(Boolean),
    weaknessType: clean(w?.type),
    weaknessValue: clean(w?.value),
    retreatCost: Array.isArray(c.retreatCost) ? c.retreatCost.length : null,
    regulationMark: clean(c.regulationMark),
    dexId: intOrNull(c.nationalPokedexNumbers?.[0]),
    flavorText: clean(c.flavorText),
  };
}

/** Sant när patchen bär något alls — tomma svar skrivs inte. */
export function hasAnyFact(p: CardFactsPatch): boolean {
  return (
    p.artist != null ||
    p.hp != null ||
    p.types.length > 0 ||
    p.weaknessType != null ||
    p.retreatCost != null ||
    p.regulationMark != null ||
    p.dexId != null ||
    p.flavorText != null
  );
}

/**
 * TCGdex nollfyller kortid:n OLIKA per set ("sv08-001" men "swsh1-1"), så id:t
 * gissas aldrig: setlistan (`/v2/en/sets/<id>` → `cards[].localId`) slås upp
 * på NORMALISERAT nummer (inledande nollor bort, gemener).
 */
export const normalizeCardNumber = (n: string): string =>
  n.trim().toLowerCase().replace(/^0+(?=\d)/, "");

export function tcgdexIdMap(cards: { id: string; localId: string }[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const c of cards) m.set(normalizeCardNumber(c.localId), c.id);
  return m;
}
