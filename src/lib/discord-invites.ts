/**
 * Egen Discord-inbjudan för restock-tipset, skild från den i header/mejl.
 *
 * ⛔ VARFÖR INTE BARA `DISCORD_URL`: Discord räknar användningar PER INBJUDNINGSKOD
 * (Serverinställningar → Inbjudningar). Delar tipset kod med alla andra ytor går det
 * aldrig att se om skylten levererar — man ser bara att någon gick med. Med en egen
 * kod är svaret gratis: ingen route, ingen räknare, ingen Neon-väckning. Alternativet
 * (`/api/go/discord?from=…` som loggar klicket) hade kostat en DB-skrivning per klick,
 * och en väckning är minst 300 s debiterad tid ([[project-neon-cost-model-corrected]]).
 *
 * SÅ HÄR FYLLER DU I: Discord → Serverinställningar → Inbjudningar → skapa en länk,
 * sätt "Upphör aldrig" + obegränsat antal användningar, döp den till "bevakningstips"
 * och klistra in koden i `WATCH_INVITE_CODE`. Tills dess används standardkoden och
 * allt fungerar — bara utan mätning.
 */

/**
 * Den ursprungliga, alltid giltiga inbjudan (samma som `DISCORD_URL`). ⛔ Byt aldrig
 * ut den mot en kod som kan upphöra: den är fallback, och en trasig inbjudan syns
 * först när någon klickar.
 */
const DEFAULT_INVITE_CODE = "kpgmdEebgW";

/** Tipsets egen kod. Tom sträng ⇒ fallback ovan. */
const WATCH_INVITE_CODE = "";

/**
 * Landningssidans egen kod (`/discord`). Den sidan finns för att fångas upp av
 * Google på frågor som "pokemon tcg sverige discord" — utan en egen kod går det
 * inte att skilja en besökare som HITTADE oss via sökning från en som redan var
 * inne i appen och klickade på headerns Discord-ikon. Det är hela mätpunkten för
 * om SEO-arbetet betalar sig, och den kostar ingenting att sätta.
 * Tom sträng ⇒ fallback ovan (allt fungerar, bara utan mätning).
 */
const LANDING_INVITE_CODE = "";

/** Inbjudnings-URL för tipset som visas när en bevakning just skapats. */
export function watchTipInviteUrl(): string {
  return `https://discord.gg/${WATCH_INVITE_CODE || DEFAULT_INVITE_CODE}`;
}

/** Inbjudnings-URL för landningssidan /discord. */
export function landingInviteUrl(): string {
  return `https://discord.gg/${LANDING_INVITE_CODE || DEFAULT_INVITE_CODE}`;
}
