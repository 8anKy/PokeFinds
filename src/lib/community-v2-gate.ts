/**
 * Grind för forum + meddelanden + Tradera-annonser på profilen ("community v2",
 * byggt 2026-09-03). ⛔ INGET AV DET SYNS FÖR VANLIGA ANVÄNDARE FÖRRÄN ÄGAREN
 * TESTAT — ägarbeslut 2026-09-03: funktionerna ska provas i en TestFlight-
 * byggnad innan någon annan får dem.
 *
 * Tre vägar in, i den här ordningen:
 *   1. `COMMUNITY_V2_PUBLIC=1` (Railway, speglas till NEXT_PUBLIC_ vid BYGGET) —
 *      lanseringsspaken. Öppnar för ALLA: webben och varje appversion.
 *   2. ADMIN/SUPERADMIN-roll i sessionen — ägaren testar på webben och i den
 *      app som redan är installerad (appen är en WebView över foilio.se).
 *   3. En native-byggnad som bär `FoilioApp/<version>` i sin User-Agent
 *      (`appendUserAgent` i capacitor.config.ts, med i binären sedan 1.2).
 *      Ingen tidigare byggnad har taggen, så "taggen finns" = "ny byggnad" —
 *      TestFlight-testare får funktionerna utan att vara admin, App Store-
 *      versionen 1.1 får dem inte. När 1.2 släpps i butiken följer
 *      funktionerna med automatiskt; sätt då också spaken (1) så webben följer.
 *
 * ⛔ Det här är en LANSERINGSGRIND, inte en säkerhetsgräns. En UA går att
 * förfalska; det som skyddar data är fortfarande auth på varje API-rutt.
 * Grinden avgör bara VEM som SER funktionen innan den är klar.
 *
 * Ren fil: ingen DB, ingen Next-import — körs i middleware (edge), i sidor,
 * i API-rutter och på klienten (via cookien nedan). Vaktad av
 * tests/unit/community-v2-gate.test.ts.
 */

/** Prefixet appen lägger sist i sin User-Agent. Versionen följer efter snedstrecket. */
export const NATIVE_UA_TAG = "FoilioApp/";

/**
 * Klientsidans spegel av grinden. Sätts av middleware (icke-httpOnly, som
 * `fo_auth`) när grinden släpper igenom, så att bottenflikar och menyer kan visa
 * "Forum"/"Meddelanden" utan att fråga servern. Bara ett HINT — servern avgör.
 */
export const BETA_COOKIE = "fo_beta";
export const BETA_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

const ADMIN_ROLES = new Set(["ADMIN", "SUPERADMIN"]);

/** Versionen ur `FoilioApp/1.2` i UA:n, annars null. */
export function nativeAppVersion(userAgent: string | null | undefined): string | null {
  if (!userAgent) return null;
  const m = userAgent.match(/FoilioApp\/(\d+(?:\.\d+)*)/);
  return m ? m[1] : null;
}

export interface GateInput {
  userAgent?: string | null;
  role?: string | null;
  /** `COMMUNITY_V2_PUBLIC` — skicka in explicit så testerna slipper env. */
  publicFlag?: string | null | undefined;
}

export function isPublicFlagOn(flag: string | null | undefined): boolean {
  return (flag ?? "").trim() === "1";
}

/** Domen. Ren funktion — samma svar i middleware, sida, API och test. */
export function communityV2Allowed(input: GateInput): boolean {
  if (isPublicFlagOn(input.publicFlag)) return true;
  if (input.role && ADMIN_ROLES.has(input.role)) return true;
  return nativeAppVersion(input.userAgent) !== null;
}

/** Serverns läsning av spaken. `||`-familjen: tom sträng = av. */
export function communityV2PublicFlag(): string | undefined {
  return process.env.COMMUNITY_V2_PUBLIC;
}

/**
 * Var ska den som INTE släpps igenom hamna? "Snart här"-sidan, som redan finns
 * och redan är vad alla andra ser. Ingen 404 — en 404 på /forum hade läst som
 * en trasig länk, "snart här" läser som en plan.
 */
export const GATED_FALLBACK_PATH = "/community";

/** Vägar (utan locale-prefix) som grinden bevakar i middleware. */
export const GATED_PREFIXES = ["/forum", "/meddelanden"] as const;

export function isGatedPath(pathWithoutLocale: string): boolean {
  return GATED_PREFIXES.some((p) => pathWithoutLocale === p || pathWithoutLocale.startsWith(p + "/"));
}
