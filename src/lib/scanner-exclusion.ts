import type { Game, Prisma } from "@prisma/client";

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
 * INTE är ett omtryck — inget vanligt kort med samma normaliserade namn, ingen WCD-lek, och
 * konsten liknar inget kort i skannerns index (< 0,9). Ancient Mew hade annars inte gått att
 * skanna alls. Domen är `Card.scannerInclude`, satt av scripts/build-scanner-unique-cards.ts
 * (veckosteg i import-new-sets.yml efter konstavtrycken) — aldrig en dom i en request.
 */
export const SCANNER_EXCLUDED_CARD: Prisma.CardWhereInput = {
  OR: [
    { AND: [{ tcgExternalId: { startsWith: CM_ONLY_EXTERNAL_PREFIX } }, { scannerInclude: false }] },
    { set: { name: { startsWith: PRIZE_PACK_SET_PREFIX } } },
  ],
};

/**
 * SPELEN SKANNERN KÄNNER (2026-11-13). Pokémon alltid; One Piece när `SCANNER_ONE_PIECE=1`
 * (Railway, läses i runtime). Spaken styr TRE saker på en gång — vilka kort engine-sync skickar
 * till skannermotorn, vilka avtryck appens konstindex laddar och vilka kort en skanning får
 * svara med — så av = skannern är Pokémon igen samma sekund, även om motorn redan lärt sig korten.
 * Mätt offline före påslag (220 frågor mot 527 referenser inkl. alternativ konst, motorns recept):
 * rätt kort 100 % mild / 99,1 % hård förvanskning; "SAMPLE"-stämpeln i referensbilderna kostar
 * ingenting (samma tal med bandet maskat).
 */
export const SCANNER_GAMES: Game[] =
  process.env.SCANNER_ONE_PIECE === "1" ? ["POKEMON", "ONE_PIECE"] : ["POKEMON"];

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
        { scannerInclude: true },
      ],
    },
    { NOT: { set: { name: { startsWith: PRIZE_PACK_SET_PREFIX } } } },
    { set: { game: { in: SCANNER_GAMES } } },
  ],
};
