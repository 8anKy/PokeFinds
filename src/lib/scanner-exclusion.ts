import type { Prisma } from "@prisma/client";

/**
 * KORT SKANNERN INTE SKA KÄNNA IGEN (2026-10-15).
 *
 * Omtryck med SAMMA konst och SAMMA nummer som originalet — Prize Pack-stämplade
 * kort ("Meganium 010/132" finns både i Lost Origin-setet och i Prize Pack Series
 * Nine), temadäckens stämplade tryckningar, World Championship Decks och startdäck
 * som bara finns på Cardmarket (`tcgExternalId "cm:<idProduct>"`, se
 * scripts/import-cm-only-singles.ts). Varken bilden eller numret skiljer dem från
 * originalet, så i skannerns index hade de bara stulit träffar: ett vanligt kort
 * hade kunnat identifieras som sin stämplade kopia. De finns i katalogen (sök,
 * samling, bevakning) — skannern svarar originalet och användaren kan välja.
 */
export const PRIZE_PACK_SET_PREFIX = "Play! Pokémon Prize Pack";
export const CM_ONLY_EXTERNAL_PREFIX = "cm:";

export const SCANNER_EXCLUDED_CARD: Prisma.CardWhereInput = {
  OR: [
    { tcgExternalId: { startsWith: CM_ONLY_EXTERNAL_PREFIX } },
    { set: { name: { startsWith: PRIZE_PACK_SET_PREFIX } } },
  ],
};

/**
 * Prisma-villkor: kortet får finnas i skannerns index.
 * ⛔ INTE `{ NOT: SCANNER_EXCLUDED_CARD }`: SQL:s NOT över en nullbar kolumn
 * (`NOT (tcgExternalId LIKE 'cm:%')`) blir NULL för kort UTAN tcgExternalId och
 * fäller dem — MEP-promona och alla TCGdex-påfyllda kort hade försvunnit ur skannern.
 */
export const SCANNER_INCLUDED_CARD: Prisma.CardWhereInput = {
  AND: [
    { OR: [{ tcgExternalId: null }, { NOT: { tcgExternalId: { startsWith: CM_ONLY_EXTERNAL_PREFIX } } }] },
    { NOT: { set: { name: { startsWith: PRIZE_PACK_SET_PREFIX } } } },
  ],
};
