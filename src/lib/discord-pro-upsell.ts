/**
 * PRO-FÖRSPRÅNGET I DISCORDS BUTIKSKANAL (ägarbeslut 2026-11-23).
 *
 * Butiksvaror (SF-Bok, Webhallens butiker) postas DIREKT i Pro-kanalen och
 * `FREE_STORE_ALERT_DELAY_MINUTES` senare i den publika butikskanalen, med raden
 * "Pro-medlemmar fick larmet 15 min tidigare". Onlinekanalerna och communityts
 * butiksrapporter är INTE fördröjda (ägarbeslut samma dag).
 *
 * ⛔ Talet är en KONSTANT, inte env — texten i inlägget vaktas mot det i
 *    `tests/unit/discord-pro-upsell.test.ts` (samma mönster som gratiskontots 4 min).
 * ⛔ "tidigare", aldrig "för 15 min sedan": kopian går ut TIDIGAST efter 15 min (lanen
 *    kan vara mitt i ett jobbyte), och inlägget står kvar i kanalen i dagar.
 * Ren modul: Discord-lanen är DB-fri och får importera den.
 */

/** Minuter mellan Pro-kanalens inlägg och den publika kopian. */
export const FREE_STORE_ALERT_DELAY_MINUTES = 15;

/**
 * BARA DE HÄR BUTIKERNA FÖRDRÖJS (ägarbeslut 2026-11-24): SF-Bok har fyra butiker med litet saldo
 * som tar slut inom kvarten, och ingen annan server har dem — där är försprånget värt något.
 * Webhallen har ~30 butiker (saldot tar sällan slut på en kvart) och en konkurrent postar samma
 * butikssaldon, så en fördröjning där skickar bara gratismedlemmarna dit. Webhallens butiksvaror
 * postas därför i Pro-kanalen (med ortspingar) OCH i den publika samtidigt, utan Pro-raden.
 * `"delayedStores":[…]` i DISCORD_RESTOCK_CHANNELS skriver över listan (tom lista = ingen fördröjs).
 */
export const DELAYED_STORE_NAMES: readonly string[] = ["SF-Bok"];

/** Är butiken fördröjd? `list` = konfigurationens lista (redan normaliserad), annars konstanten. */
export function isDelayedStoreName(storeName: string | null | undefined, list?: readonly string[] | null): boolean {
  const key = (storeName ?? "").trim().toLowerCase();
  if (!key) return false;
  return (list ?? DELAYED_STORE_NAMES).some((n) => n.trim().toLowerCase() === key);
}

/** Äldre Pro-inlägg än så här kopieras inte — ett butikssaldo från i förmiddags är ingen nyhet. */
export const FREE_STORE_ALERT_MAX_AGE_MINUTES = 60;

const PRICING_PATH = "/priser";

/** Fältet i den fördröjda kopian. `proChannelId` = Pro-butikskanalen (klickbar för Pro). */
export function proHeadStartField(proChannelId: string | null | undefined) {
  return {
    name: "Scoutr Pro",
    value:
      `Pro-medlemmar fick larmet ${FREE_STORE_ALERT_DELAY_MINUTES} min tidigare` +
      (proChannelId ? ` i <#${proChannelId}>.` : "."),
    inline: false,
  } as const;
}

/** Det av en embed som kopian rör: fälten. Resten följer med orört. */
interface EmbedWithFields {
  fields?: { name: string; value: string; inline?: boolean }[];
}

const APP_FIELD_NAME = "Ladda ner Scoutr";

/**
 * Lägger Pro-raden i en färdig embed — FÖRE "Ladda ner Scoutr", som ska stå sist.
 * Idempotent: en embed som redan bär raden lämnas orörd.
 */
export function withProHeadStart<T extends EmbedWithFields>(embed: T, proChannelId: string | null | undefined): T {
  const field = proHeadStartField(proChannelId);
  const fields = [...(embed.fields ?? [])];
  if (fields.some((f) => f.name === field.name)) return embed;
  const appAt = fields.findIndex((f) => f.name === APP_FIELD_NAME);
  fields.splice(appAt >= 0 ? appAt : fields.length, 0, { ...field });
  return { ...embed, fields };
}

/**
 * "Skaffa Pro"-knappen under inlägget. En LÄNKKNAPP (style 5): kräver ingen
 * interaktions-endpoint och fungerar i alla klienter.
 */
export function proUpsellComponents(siteUrl: string) {
  return [
    {
      type: 1,
      components: [{ type: 2, style: 5, label: "Skaffa Pro", url: `${siteUrl.replace(/\/$/, "")}${PRICING_PATH}` }],
    },
  ] as const;
}
