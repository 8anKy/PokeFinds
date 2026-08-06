import { NextResponse, type NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";
import createMiddleware from "next-intl/middleware";
import { routing } from "@/i18n/routing";
import { BLOCKED_BOTS } from "@/lib/blocked-bots";
import {
  AUTH_HINT_COOKIE,
  AUTH_HINT_MAX_AGE,
  authHintAction,
  sessionCookieCandidates,
} from "@/lib/session-cookie";

const intlMiddleware = createMiddleware(routing);

const MODERATOR_ROLES = new Set(["MODERATOR", "ADMIN", "SUPERADMIN"]);

// Lågvärdes-crawlers (Applebot m.fl.) svepte hela ~20k-produktkatalogen var par
// sekund → varje slug = DB-render → Neon-computen scale-to-zero aldrig. robots.txt
// blockerar dem men hedras först när boten läst om den (~1 dygn) och vissa
// (Bytespider) struntar i robots helt. 403 här stoppar DB-renders DIREKT, före all
// rendering. Google/Bing är medvetet INTE med (dem vill vi ha för SEO).
// Håll listan i takt med verkligheten: varje ny AI-/SEO-crawler som sveper katalogen
// kostar ~50 Neon-frågor per produktsida och håller computen vaken (Launch kan inte
// somna snabbare än 5 min, så en träff var 5:e minut = betald compute dygnet runt).
// Google/Bing/DuckDuckGo är medvetet INTE med — dem vill vi ha för SEO. Länkförhands-
// visare (facebookexternalhit, Twitterbot, Slackbot, Discordbot, LinkedInBot, WhatsApp)
// är också utanför: de hämtar EN delad URL, inte hela katalogen.
// META HAR FLERA UA:er — att blocka en räcker inte (mätt 2026-07-26 i Railways
// httpLogs): `meta-externalagent` 403:ades korrekt efter 1e33f63, men systern
// `meta-webindexer` saknades i listan och svepte vidare med 200 — 12,6 MB av
// 16,2 MB total egress (78 %) på 12,6 h, mot /en/-katalogen. Bulk-indexerare
// blockas; användarinitierade hämtare (facebookexternalhit, meta-externalfetcher
// = EN delad URL) lämnas kvar med flit. Truncera ALDRIG en UA vid analys: Metas
// crawlers döljer namnet i ett "(compatible; …)"-suffix EFTER en helt vanlig
// Chrome-sträng, så en avhuggen UA ser ut som en riktig besökare.
// Själva listan ligger i @/lib/blocked-bots så den kan regressionstestas.

const PROTECTED_PREFIXES = [
  "/dashboard",
  "/bevakningar",
  "/installningar",
  "/onboarding",
  "/admin",
];

// Tar bort ev. /en-prefix så skydds-kollen fungerar likadant på båda språken.
// Returnerar [avskalad väg, prefix] där prefix = "" (sv) eller "/en".
function splitLocale(pathname: string): [string, string] {
  for (const l of routing.locales) {
    if (l === routing.defaultLocale) continue;
    if (pathname === `/${l}`) return ["/", `/${l}`];
    if (pathname.startsWith(`/${l}/`)) return [pathname.slice(l.length + 1), `/${l}`];
  }
  return [pathname, ""];
}

/**
 * Rättar `fo_auth`-hinten mot den riktiga sessionscookien. Se lib/session-cookie.ts
 * för VARFÖR den måste sättas här och inte från klienten (WebKit kapar
 * `document.cookie` till 7 dygn → iPhone-användare kastades ut ur appen var sjunde
 * dygn med en fullt levande session). Skriver bara när de två är oense.
 */
function syncAuthHint(req: NextRequest, res: NextResponse): NextResponse {
  const hasSession = sessionCookieCandidates().some((n) => req.cookies.has(n));
  const hasHint = req.cookies.get(AUTH_HINT_COOKIE)?.value === "1";
  const action = authHintAction(hasSession, hasHint);
  if (action === "set") {
    // ⛔ INTE httpOnly — hela poängen är att klient-chrome (header, tabbar,
    // AuthHintGate) kan läsa den utan att anropa /api/auth/session.
    res.cookies.set(AUTH_HINT_COOKIE, "1", {
      path: "/",
      maxAge: AUTH_HINT_MAX_AGE,
      sameSite: "lax",
    });
  } else if (action === "clear") {
    res.cookies.set(AUTH_HINT_COOKIE, "", { path: "/", maxAge: 0, sameSite: "lax" });
  }
  return res;
}

export async function middleware(req: NextRequest) {
  const ua = req.headers.get("user-agent") ?? "";
  if (BLOCKED_BOTS.test(ua)) {
    return new NextResponse(null, { status: 403 });
  }

  const { pathname, search } = req.nextUrl;
  const [path, prefix] = splitLocale(pathname);

  // Publika sidor auth-gatas inte — låt next-intl sköta locale-routing direkt.
  const isProtected = PROTECTED_PREFIXES.some((p) => path === p || path.startsWith(p + "/"));
  if (!isProtected) {
    return syncAuthHint(req, intlMiddleware(req));
  }

  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });

  if (!token) {
    // Behåll EXAKT samma origin + locale-prefix — annars cross-origin/språkbyte.
    const loginUrl = req.nextUrl.clone();
    loginUrl.pathname = `${prefix}/logga-in`;
    loginUrl.search = "";
    loginUrl.searchParams.set("callbackUrl", pathname + search);
    const res = NextResponse.redirect(loginUrl);
    res.cookies.set("fo_auth", "", { maxAge: 0, path: "/" });
    return res;
  }

  if (path.startsWith("/admin")) {
    const role = typeof token.role === "string" ? token.role : "";
    if (!MODERATOR_ROLES.has(role)) {
      return NextResponse.redirect(new URL(`${prefix}/dashboard`, req.url));
    }
  }

  // Autentiserad OK → låt next-intl sätta locale-context/rewrite.
  return syncAuthHint(req, intlMiddleware(req));
}

export const config = {
  // Kör på alla sidvägar (så next-intl kan locale-routa + bot-403:an täcker allt);
  // hoppa api, _next, _vercel och filer med punkt (robots.txt, bilder, sw.js …).
  matcher: ["/((?!api|_next|_vercel|.*\\..*).*)"],
};
