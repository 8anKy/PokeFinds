/**
 * DOLDA FUNKTIONER (ägarbeslut 2026-10-26: "dölj tills jag vill ha tillbaka dem").
 * Koden ligger kvar orörd — slå på igen genom att sätta värdet till false här.
 *
 * - `giveaway`: sidan ger 404 (admin ser den ändå) och Mer-raden visas inte.
 *   Lotterna räknas fortfarande ur aktiviteten, så inget går förlorat.
 * - `headerDiscord`: bara Discord-knappen i SIDHUVUDET — övriga Discordlänkar finns kvar.
 * - `streak`: inget kort på Utforska, inget firande, och ingen ny dag bokförs
 *   (`recordActivity` svarar null). Påfyllning redan intjänad denna månad behålls.
 */
export const HIDDEN_FEATURES = {
  giveaway: true,
  headerDiscord: true,
  streak: true,
} as const;
