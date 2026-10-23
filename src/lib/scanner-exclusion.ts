import type { Prisma } from "@prisma/client";
import uniqueCmIds from "@/data/scanner-unique-cm-cards.json";

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

/**
 * UNDANTAGET (2026-10-23, ägaren: "skannern ska känna alla kort"): Cardmarket-only-kort som
 * INTE är ett omtryck — inget vanligt kort med samma namn och språk, och konsten liknar inget
 * kort i skannerns index (< 0,9). Ancient Mew hade annars inte gått att skanna alls.
 * Listan är INCHECKAD och räknas fram av scripts/build-scanner-unique-cards.ts — en tabell
 * vakterna kan granska, aldrig en dom i en request.
 */
export const SCANNER_UNIQUE_CM_IDS: readonly string[] = uniqueCmIds as string[];

export const SCANNER_EXCLUDED_CARD: Prisma.CardWhereInput = {
  OR: [
    { AND: [{ tcgExternalId: { startsWith: CM_ONLY_EXTERNAL_PREFIX } }, { tcgExternalId: { notIn: [...SCANNER_UNIQUE_CM_IDS] } }] },
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
    {
      OR: [
        { tcgExternalId: null },
        { NOT: { tcgExternalId: { startsWith: CM_ONLY_EXTERNAL_PREFIX } } },
        ...(SCANNER_UNIQUE_CM_IDS.length ? [{ tcgExternalId: { in: [...SCANNER_UNIQUE_CM_IDS] } }] : []),
      ],
    },
    { NOT: { set: { name: { startsWith: PRIZE_PACK_SET_PREFIX } } } },
  ],
};
