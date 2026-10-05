/**
 * UNIVERSAL LINKS / APP LINKS — vilken sida i appen en foilio.se-länk ska öppna.
 *
 * När appen är installerad öppnar telefonen en foilio.se-länk (mejlknappar, Discord,
 * delade länkar) i APPEN i stället för i webbläsaren: iOS via
 * `public/.well-known/apple-app-site-association` + entitlementen
 * `com.apple.developer.associated-domains`, Android via `assetlinks.json` + ett
 * `autoVerify`-intent-filter. Appen får då bara en URL (Capacitor-händelsen
 * `appUrlOpen`) — den här funktionen avgör vart WebView:en ska navigera.
 *
 * Ren och testad (`tests/unit/app-links.test.ts`).
 * ⛔ `/api/*` hör aldrig hemma i appen (OAuth-callbacks, webhooks, JSON) — samma
 *    undantag som AASA-filen. Andra värdar ⇒ null (aldrig en öppen omdirigering).
 */
const APP_HOSTS = new Set(["foilio.se", "www.foilio.se"]);

export function appLinkPath(url: string | null | undefined): string | null {
  if (!url) return null;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || !APP_HOSTS.has(u.hostname)) return null;
  if (u.pathname === "/api" || u.pathname.startsWith("/api/")) return null;
  return `${u.pathname}${u.search}${u.hash}`;
}
