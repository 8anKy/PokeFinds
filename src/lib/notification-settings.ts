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
  /**
   * Veckobrevet (src/jobs/weekly-digest.ts). Gäller ALLA konton, inte bara Pro.
   *
   * ⛔ EGEN SPAK, INTE `email`. Veckobrevet är appens första ICKE-transaktionella
   * massutskick: den som vill ha sina restock-larm men inte ett nyhetsbrev måste
   * kunna säga just det. Låg brevet under `email` vore enda avanmälan att stänga
   * av larmen också — dvs. att stänga av det man betalat för.
   * `email` är fortfarande MASTER: är den av skickas inget veckobrev heller.
   */
  weekly: boolean;
  /**
   * Nyhetsmejl (scripts/send-release-notes.ts): ett mejl per släpp om vad som
   * är nytt. Egen spak av samma skäl som `weekly` — den som vill ha sina larm
   * men inte produktnyheter måste kunna säga just det. `email` är master.
   *
   * ⛔ Nyckeln finns MEDVETET INTE i kolumnens `@default`: saknad nyckel läses
   * som PÅ både här och i utskickets SQL (`coalesce(..., true)`), så befintliga
   * och nya konton beter sig lika utan migration. Skrivs först när användaren
   * rör reglaget eller avregistrerar sig.
   */
  news: boolean;
}

export const NOTIFICATION_DEFAULTS: NotificationSettings = {
  email: true,
  push: false,
  allRestocks: false,
  // Opt-out, inte opt-in: brevet är kontots egen sammanfattning (samlingens
  // värde, dina bevakningar) och inte reklam från tredje part. Speglar
  // `@default` på User.notificationSettings — ändras det ena måste det andra med.
  weekly: true,
  // Opt-out: nyheter om tjänsten mottagaren redan har konto på (befintlig
  // kundrelation), aldrig tredje part. Ett mejl per släpp, med avanmälan.
  news: true,
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
    weekly: typeof o.weekly === "boolean" ? o.weekly : NOTIFICATION_DEFAULTS.weekly,
    news: typeof o.news === "boolean" ? o.news : NOTIFICATION_DEFAULTS.news,
  };
}
