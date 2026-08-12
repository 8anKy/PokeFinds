/**
 * Kreatörsspårning: `?ref=EMMA` → cookie → `User.creatorCodeId` vid registrering.
 *
 * Poängen är att attributionen ska överleva HELA vägen från TikTok-klicket till
 * kontot, även när personen bläddrar runt i katalogen i en vecka först och även
 * om hen aldrig köper Pro. Rabatten (Stripe promotion code) är en SEPARAT sak som
 * bara gäller webbkassan — den här modulen vet inget om pengar.
 *
 * ⛔ **COOKIEN MÅSTE SÄTTAS AV SERVERN.** WebKit kapar sedan Safari 13.1 alla
 * cookies skapade via `document.cookie` till 7 DYGN — iPhone-Safari, Chrome på iOS
 * OCH vår Capacitor-app (allt är WKWebView). Ett attributionsfönster som tyst
 * krymper till en vecka på ungefär halva trafiken är precis den sortens fel som
 * bara syns som "kreatören verkar ha slutat leverera". Samma lärdom som
 * `fo_auth`-hinten 2026-08-06, se lib/session-cookie.ts.
 *
 * ⛔ **INGEN DB-SLAGNING I MIDDLEWARE.** Koden valideras inte mot CreatorCode
 * förrän vid registreringen. Middleware kör på VARJE sidvisning, och en fråga där
 * hade väckt Neon för varje anonym besökare och crawler — exakt det som höll
 * computen vaken dygnet runt 2026-07-07. En påhittad kod kostar oss en cookie och
 * upplöses till null vid registreringen.
 */

/** Server-satt, läsbar av klienten (koden är publik marknadsföring, ingen hemlighet). */
export const CREATOR_REF_COOKIE = "fo_ref";

/**
 * Attributionsfönster: 30 dygn. Branschstandard för affiliate, och tillräckligt
 * långt för det verkliga mönstret (ser klippet på telefonen, skapar konto senare
 * vid datorn). Längre fönster tillskriver kreatören folk som hittat hit på annat
 * sätt; kortare missar den fördröjda registreringen som är hela poängen.
 */
export const CREATOR_REF_MAX_AGE = 60 * 60 * 24 * 30;

/** Query-parametern i kreatörslänken: https://www.foilio.se/?ref=EMMA */
export const CREATOR_REF_PARAM = "ref";

/** Längdtak. Cookien är osignerad indata — den ska aldrig kunna bli en nyttolast. */
export const CREATOR_CODE_MAX_LENGTH = 32;

/**
 * Normalisera en kod till kanonisk form: VERSALER, bara A–Z, 0–9, bindestreck och
 * understreck. Returnerar null när ingenting användbart återstår.
 *
 * ⛔ Versalisering är inte kosmetik: koden trycks i en video, skrivs av för hand
 * och klistras in i olika kapitalisering, och `CreatorCode.code` är unik. Utan EN
 * kanonisk form blir "emma" och "EMMA" två olika kreatörer.
 *
 * ⛔ Tecken utanför mängden KASTAS, de gör inte koden ogiltig — en länk som fått
 * med ett efterföljande skiljetecken från en TikTok-bio ("?ref=EMMA.") ska
 * fortfarande tillskrivas Emma. Blir resultatet tomt eller för långt → null.
 */
export function normalizeCreatorCode(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const cleaned = raw.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, "");
  if (!cleaned) return null;
  if (cleaned.length > CREATOR_CODE_MAX_LENGTH) return null;
  return cleaned;
}

/** Vad middleware ska göra med ref-cookien vid den här sidvisningen. */
export type CreatorRefAction = { type: "set"; value: string } | { type: "none" };

/**
 * Ren dom: en länk bär `?ref=`, vad händer med cookien?
 *
 * ⛔ **SISTA KLICKET VINNER.** Bär besökaren redan Emmas cookie och klickar på
 * Kalles länk skrivs cookien om till Kalle. Det är branschens standardmodell
 * (last-touch) och den enda som går att förklara för en kreatör: "personen kom
 * hit på DIN länk och skapade konto". First-touch hade gjort Kalles klick
 * osynligt trots att det var hans video som fick personen att registrera sig.
 *
 * ⛔ **SAMMA KOD SKRIVER INTE OM COOKIEN.** Utan den här jämförelsen hade varje
 * sidvisning i samma besök förlängt fönstret med 30 nya dygn, dvs en cookie som
 * aldrig går ut för den som bläddrar regelbundet. Fönstret ska räknas från
 * KLICKET, inte från senaste besöket.
 */
export function creatorRefAction(
  paramValue: string | null | undefined,
  currentCookie: string | null | undefined
): CreatorRefAction {
  const incoming = normalizeCreatorCode(paramValue);
  if (!incoming) return { type: "none" };
  if (incoming === normalizeCreatorCode(currentCookie)) return { type: "none" };
  return { type: "set", value: incoming };
}
