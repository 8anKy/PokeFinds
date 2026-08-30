/**
 * SIGNERAD AVREGISTRERINGSLÄNK — avanmälan som fungerar UTLOGGAD.
 *
 * Veckobrevet är appens första icke-transaktionella massutskick. Den som får det
 * i mobilen, i en mejlklient hen aldrig loggat in i, måste kunna säga nej på ETT
 * klick — inte "logga in på foilio.se och leta upp Inställningar". Därför en
 * HMAC över (userId, typ) i stället för en session.
 *
 * ⛔ INGEN DB-SLAGNING FÖR ATT VALIDERA. Token är självbärande: signaturen är
 *    beviset. En kolumn hade kostat en Neon-läsning per klick i ett läge där
 *    databasen annars sover, och gett noll extra säkerhet.
 *
 * ⛔ TOKEN BÄR `userId`, ALDRIG E-POSTADRESSEN. Kartläggningsregeln från
 *    /glomt-losenord gäller: ingenting i länken — och ingenting i svaret på den —
 *    får gå att använda för att avgöra om en adress har ett konto. Ett opakt cuid
 *    går inte att gissa sig till från en adress, och endpointen svarar likadant
 *    på en giltig som på en förfalskad token.
 *
 * ⛔ HEMLIGHETEN MÅSTE VARA DENSAMMA I JOBBET OCH I WEBBEN. Jobbet (GitHub
 *    Actions) SIGNERAR, appen (Railway) VERIFIERAR. Skiljer de sig är varje
 *    avregistreringslänk i utskicket död — tyst, och upptäckt först av någon som
 *    försökte säga nej och inte kunde. `requireUnsubscribeSecret()` finns för att
 *    jobbet ska kunna VÄGRA skicka i stället för att skicka trasiga länkar.
 */
import crypto from "crypto";

/**
 * Vilken typ av utskick avanmälan gäller. En typ per utskick som inte är
 * transaktionellt: `weekly` = veckobrevet, `news` = nyhetsmejlen per släpp.
 * Typen avgör vilken nyckel i `notificationSettings` som slås av (/api/unsubscribe).
 */
export type UnsubscribeType = "weekly" | "news";

const TYPES: readonly UnsubscribeType[] = ["weekly", "news"];

/**
 * Egen variabel först, NextAuths som reserv. `NEXTAUTH_SECRET` finns redan i
 * appen och är därmed den enda hemlighet som garanterat är satt där; en egen
 * `UNSUBSCRIBE_SECRET` gör det möjligt att rotera den ena utan att logga ut alla.
 */
function secret(): string | null {
  const s = process.env.UNSUBSCRIBE_SECRET || process.env.NEXTAUTH_SECRET;
  return s && s.length > 0 ? s : null;
}

/** Hemligheten, eller ett tydligt fel. Anropas av utskick INNAN första mejlet. */
export function requireUnsubscribeSecret(): string {
  const s = secret();
  if (!s) {
    throw new Error(
      "UNSUBSCRIBE_SECRET/NEXTAUTH_SECRET saknas — utskicket avbryts hellre än " +
        "skickar mejl med avregistreringslänkar som inte går att verifiera."
    );
  }
  return s;
}

/**
 * Nycklar som VERIFIERING accepterar: den nuvarande först, sedan den föregående.
 *
 * ⛔ SIGNERING ANVÄNDER ALDRIG DEN FÖREGÅENDE — bara `secret()`. Listan finns bara
 * för att en hemlighetsrotation inte ska döda länkar som redan ligger i folks
 * inkorgar: tokens har MED FLIT ingen utgångstid (se `createUnsubscribeToken`), så
 * utan det här steget hade varje rotation tystat avanmälan för varje veckobrev som
 * någonsin skickats — tyst, och upptäckt först av någon som försökte säga nej och
 * inte kunde. Infördes 2026-08-25 när `NEXTAUTH_SECRET` roterades (prod körde
 * `.env.example`-platshållaren, publik i ett publikt repo).
 *
 * ⚠️ `UNSUBSCRIBE_SECRET_PREVIOUS` ÄR TILLFÄLLIG. Så länge den är satt kan den som
 * känner den gamla hemligheten fortfarande förfalska en avanmälan (skadan är
 * avgränsad: värsta utfallet är ett stoppat veckobrev, återställbart i
 * Inställningar, och token bär `userId` — ett opakt cuid — aldrig adressen).
 * TA BORT DEN när de gamla utskicken är passerade; sätt aldrig en tredje.
 */
function verificationKeys(): string[] {
  const prev = process.env.UNSUBSCRIBE_SECRET_PREVIOUS;
  return [secret(), prev && prev.length > 0 ? prev : null].filter(
    (k): k is string => typeof k === "string"
  );
}

function sign(payload: string, key: string): string {
  return crypto.createHmac("sha256", key).update(payload).digest("base64url");
}

/**
 * Token = `<typ>.<userId>.<hmac>`. Ingen utgångstid: en avregistreringslänk som
 * slutar fungera är en avanmälan som slutar fungera, och mejlet ligger kvar i
 * inkorgen i åratal.
 */
export function createUnsubscribeToken(userId: string, type: UnsubscribeType): string {
  const key = requireUnsubscribeSecret();
  const payload = `${type}.${userId}`;
  return `${payload}.${sign(payload, key)}`;
}

/**
 * Verifierar en token. Returnerar `null` för allt som inte håller — anroparen ska
 * svara EXAKT likadant i båda fallen (se kartläggningsregeln ovan).
 */
export function verifyUnsubscribeToken(
  token: string | null | undefined
): { userId: string; type: UnsubscribeType } | null {
  const keys = verificationKeys();
  if (keys.length === 0 || !token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [type, userId, sig] = parts;
  if (!userId || !TYPES.includes(type as UnsubscribeType)) return null;

  const actual = Buffer.from(sig, "utf8");
  // Prövar den nuvarande hemligheten först och den föregående sedan — se
  // verificationKeys(). Loopen bryter ALDRIG tidigt på en träff-per-nyckel-basis
  // utöver returen: varje nyckel gör exakt samma arbete oavsett utfall.
  for (const key of keys) {
    const expected = Buffer.from(sign(`${type}.${userId}`, key), "utf8");
    // timingSafeEqual kräver samma längd — olika längd är i sig en icke-match.
    if (expected.length !== actual.length) continue;
    if (crypto.timingSafeEqual(expected, actual)) {
      return { userId, type: type as UnsubscribeType };
    }
  }
  return null;
}

/** Full URL till avregistreringen. `appUrl` = apex, aldrig www (se templates.ts). */
export function unsubscribeUrl(appUrl: string, userId: string, type: UnsubscribeType): string {
  return `${appUrl}/api/unsubscribe?token=${encodeURIComponent(createUnsubscribeToken(userId, type))}`;
}
