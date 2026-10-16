/**
 * "Ladda ner Scoutr"-raden sist i varje larm boten skickar (ägarbeslut 2026-10-16):
 * påfyllningar/prisinlägg, butiksrapporter, butiksnyheter och larm-DM:en.
 *
 * ⛔ ETT FÄLT, INTE SIDFOTEN: Discord renderar inga länkar i en embeds `footer`.
 * ⛔ Inte i /pris-svaret eller köp/sälj-annonserna — de är inga larm.
 * Ren konstant: Discord-lanen är DB-fri och får importera den.
 */
import { APP_STORE_URL, PLAY_STORE_URL } from "@/lib/social-links";

export const DISCORD_APP_FIELD = {
  name: "Ladda ner Scoutr",
  value: `[App Store](${APP_STORE_URL}) · [Google Play](${PLAY_STORE_URL})`,
  inline: false,
} as const;
