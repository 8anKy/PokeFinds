/**
 * NAMNBYTET FOILIO → SCOUTR (2026-10): foilio.se finns kvar som ANDRA värd på samma
 * Railway-tjänst. Webbläsare och sökmotorer får en 301 till samma sida på scoutr.se;
 * de installerade apparna får INTE det.
 *
 * ⛔ VARFÖR APPARNA UNDANTAS: 1.4 och äldre laddar `https://foilio.se` (bakat i bygget)
 *    och har bara foilio.se i Capacitors `allowNavigation`. En 301 till scoutr.se hade
 *    öppnat Safari/Chrome i stället för appen för VARJE användare tills de uppdaterat.
 *    Den tvingade uppdateringen (app-release.json `minVersion`) flyttar dem; därefter kan
 *    undantaget tas bort och foilio.se bli en ren omdirigering.
 * ⛔ App-igenkänningen är medvetet GENERÖS: hellre en webbläsare för mycket som får
 *    stanna på foilio.se (sidans canonical pekar ändå på scoutr.se) än en app som
 *    kastas ut ur WebView:en. Taggen `FoilioApp/` finns från 1.2; äldre byggen känns
 *    igen på WebView-signaturen (Android `; wv)`, iOS WKWebView saknar `Safari/`).
 * ⛔ PÅ/AV = env `LEGACY_HOST_REDIRECT_TO` (t.ex. `https://scoutr.se`). Osatt ⇒ ingen
 *    omdirigering alls, båda värdarna serverar sajten som förut.
 * ⛔ Middleware-matchern hoppar redan över `/api`, `/_next` och filer med punkt — dvs.
 *    `/.well-known/*` (AASA/assetlinks för gamla appars länkar), webhooks som ännu pekar
 *    på foilio.se, robots.txt och sitemapen. Det är avsiktligt.
 */
export const LEGACY_HOSTS = new Set(["foilio.se", "www.foilio.se"]);

export function isNativeAppUserAgent(ua: string): boolean {
  if (/(?:Foilio|Scoutr)App\//.test(ua)) return true;
  if (/Android/.test(ua) && /; wv\)/.test(ua)) return true;
  if (/\b(?:iPhone|iPad|iPod)\b/.test(ua) && !/Safari\//.test(ua)) return true;
  return false;
}

/**
 * Mål-URL för en begäran mot en gammal värd, eller null (ingen omdirigering).
 * `target` = env-värdet, t.ex. "https://scoutr.se".
 */
export function legacyHostRedirect(
  host: string | null | undefined,
  pathAndSearch: string,
  userAgent: string,
  target: string | null | undefined
): string | null {
  const to = target?.trim().replace(/\/+$/, "");
  if (!to || !host) return null;
  if (!LEGACY_HOSTS.has(host.toLowerCase().replace(/:\d+$/, ""))) return null;
  if (isNativeAppUserAgent(userAgent)) return null;
  return `${to}${pathAndSearch.startsWith("/") ? pathAndSearch : `/${pathAndSearch}`}`;
}
