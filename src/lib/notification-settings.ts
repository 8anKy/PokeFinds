/**
 * EN LÄSARE FÖR `User.notificationSettings` (2026-08-14).
 *
 * Kolumnen är otypad JSON skriven av flera versioner av inställningssidan, och
 * den lästes på TRE ställen med var sin handskriven parser (notifications.ts,
 * /installningar, och nu adminpanelen). Två av dem kände inte ens till samma
 * fält: notifications.ts läser bara `email`/`push`, resten läser även
 * `allRestocks`. Att lägga till en fjärde kopia hade garanterat drift — samma
 * skäl som `isSealedCategory` samlades på ett ställe 2026-08-06.
 *
 * ⛔ **DEFAULTVÄRDENA ÄR PRODUKTBESLUT, INTE KODSTIL.** `email: true` betyder att
 *    en användare som aldrig rört inställningarna FÅR mejl, och `push: false`
 *    att hen inte får push förrän en enhet registrerats. De speglar
 *    `@default` i schema.prisma; ändras de här utan att kolumnens default
 *    ändras börjar befintliga och nya konton bete sig olika.
 *
 * ⛔ **KASTAR ALDRIG.** En trasig rad får inte sänka vare sig larmutskicket
 *    eller inställningssidan för just den användaren — samma regel som
 *    `favoriteSetIds()` i user-preferences.ts.
 */

export interface NotificationSettings {
  /** Master-toggle för e-post. Respekteras i dispatchPendingAlerts. */
  email: boolean;
  /** Native push (APNs/FCM). Kräver dessutom en registrerad PushToken. */
  push: boolean;
  /** Pro-opt-in: restock-larm för VILKEN sealed-produkt som helst. */
  allRestocks: boolean;
}

export const NOTIFICATION_DEFAULTS: NotificationSettings = {
  email: true,
  push: false,
  allRestocks: false,
};

/** Läser kolumnen till ett komplett objekt. Okända/felaktiga fält → default. */
export function parseNotificationSettings(json: unknown): NotificationSettings {
  if (typeof json !== "object" || json === null) return { ...NOTIFICATION_DEFAULTS };
  const o = json as Record<string, unknown>;
  return {
    email: typeof o.email === "boolean" ? o.email : NOTIFICATION_DEFAULTS.email,
    push: typeof o.push === "boolean" ? o.push : NOTIFICATION_DEFAULTS.push,
    allRestocks:
      typeof o.allRestocks === "boolean"
        ? o.allRestocks
        : NOTIFICATION_DEFAULTS.allRestocks,
  };
}
