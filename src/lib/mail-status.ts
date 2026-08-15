/**
 * Tolkning av Resends leveranshändelser.
 *
 * BAKGRUND (2026-08-15): en feltypad adress vid registreringen är en tyst
 * återvändsgränd — koden studsar, och den som väntar på den ser bara ett tomt
 * kodfält. `suggestEmailCorrection` fångar felstavade DOMÄNER före utskicket,
 * men ett fel i lokaldelen ("hgo@gmail.com") går inte att gissa. Det enda som
 * avslöjar det är vad mottagarens mejlserver faktiskt svarade.
 *
 * Domen är en REN funktion här, inte utspridd i route och klient, för att
 * gränsen mellan "kom aldrig fram" och "vet inte än" ska gå att testa: säger vi
 * "mejlet studsade" om ett mejl som bara är försenat skickar vi tillbaka någon
 * som redan har koden i inkorgen till formuläret.
 */

/**
 * `undeliverable` = mejlet kom inte fram och kommer inte att göra det.
 * `delivered`     = mottagarens server tog emot det.
 * `pending`       = på väg, försenat, eller okänt — säg ingenting till användaren.
 */
export type MailDeliveryStatus = "undeliverable" | "delivered" | "pending";

/**
 * Resends `last_event`. ⛔ `delivery_delayed` är UTTRYCKLIGEN inte terminalt:
 * Resend beskriver det som ett TILLFÄLLIGT fel hos mottagarens server (grålistning
 * m.m.), och mejlet levereras oftast strax därpå. Räknas det som en studs får den
 * som strax får sin kod i stället ett besked om att adressen är fel.
 */
const UNDELIVERABLE_EVENTS = new Set([
  "bounced", // mottagarens server avvisade mejlet
  "failed", // utskicket misslyckades hos Resend
  "suppressed", // adressen ligger på spärrlistan (tidigare studs/spamanmälan)
]);

const DELIVERED_EVENTS = new Set([
  "delivered",
  // Öppning/klick bevisar leverans lika starkt som `delivered`, och är det
  // sista kända tillståndet så fort mottagaren rört mejlet.
  "opened",
  "clicked",
  // Spamanmälan betyder att mejlet KOM FRAM och sedan flaggades. Koden ligger i
  // skräpposten, inte i tomma intet — fel besked vore "adressen finns inte".
  "complained",
]);

/** Rå JSON från `GET https://api.resend.com/emails/{id}`. */
export function interpretResendEvent(lastEvent: unknown): MailDeliveryStatus {
  if (typeof lastEvent !== "string") return "pending";
  const event = lastEvent.toLowerCase();
  if (UNDELIVERABLE_EVENTS.has(event)) return "undeliverable";
  if (DELIVERED_EVENTS.has(event)) return "delivered";
  // "sent", "queued", "scheduled", "delivery_delayed" och allt Resend hittar på
  // i framtiden: okänt är PENDING, aldrig en studs. Ett falskt studsbesked
  // avbryter en registrering som var på väg att lyckas.
  return "pending";
}
