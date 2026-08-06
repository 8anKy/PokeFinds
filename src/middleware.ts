import { NextResponse, type NextRequest } from "next/server";
import { encode, getToken, type JWT } from "next-auth/jwt";
import createMiddleware from "next-intl/middleware";
import { routing } from "@/i18n/routing";
import { BLOCKED_BOTS } from "@/lib/blocked-bots";
import {
  AUTH_HINT_COOKIE,
  AUTH_HINT_MAX_AGE,
  SESSION_COOKIE_NAMES,
  authHintAction,
  sessionCookieCandidates,
  sessionCookieOptions,
  shouldRenewSession,
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

/**
 * GLIDANDE SESSION. Skriver om sessionscookien med en färsk utgång så att en
 * användare som faktiskt använder appen aldrig loggas ut av sig själv.
 *
 * ⛔ VARFÖR HÄR OCH INTE I NEXTAUTH: v4 förnyar cookien när sessionen LÄSES, men
 * `getServerSession` får ingen `res` i App Router och kan inte sätta cookies, och
 * appen anropar aldrig `/api/auth/session` (hela poängen med `fo_auth`-hinten).
 * Ingenting förnyade alltså sessionen — alla loggades ut exakt 30 dygn efter login
 * oavsett aktivitet. Middleware är dessutom det billigaste stället: noll DB.
 *
 * ⛔ CHUNKADE COOKIES RÖRS INTE. En JWT > 4 kB delas av NextAuth i `…token.0`,
 * `.1`, … och har då inget oindexerat namn. Skrev vi tillbaka EN cookie skulle de
 * gamla chunkarna ligga kvar och två källor konkurrera om samma session. Våra
 * tokens är några hundra byte, så grenen är teoretisk — men tyst fel om den nås.
 *
 * ⛔ NYTTOLASTEN ÄR ORÖRD. `iat`/`exp`/`jti` sätts om av `encode`; allt annat
 * (`id`, `role`, `planTier`, `refreshedAt`) följer med exakt som det var, så
 * TTL:n för DB-omläsningen i jwt-callbacken påverkas inte.
 */
async function renewSession(req: NextRequest, res: NextResponse, token: JWT): Promise<void> {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) return;

  const cookieName = SESSION_COOKIE_NAMES.find((n) => req.cookies.has(n));
  if (!cookieName) return; // saknas eller chunkad → lämna orörd

  const iat = (token as { iat?: number }).iat;
  if (!shouldRenewSession(iat, Math.floor(Date.now() / 1000))) return;

  try {
    const value = await encode({ token, secret, maxAge: sessionCookieOptions(cookieName).maxAge });
    res.cookies.set(cookieName, value, sessionCookieOptions(cookieName));
  } catch {
    // ⛔ En misslyckad förnyelse får ALDRIG fälla begäran. Den gamla cookien är
    // fortfarande giltig — användaren märker ingenting, och nästa sidladdning
    // försöker igen. Att kasta här hade gett 500 på varje sida för alla inloggade.
  }
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
    const res = syncAuthHint(req, intlMiddleware(req));
    // Sessionen förnyas ÄVEN på publika sidor — annars hade den som mest bläddrar
    // i katalogen loggats ut trots daglig användning. `getToken` (en JWE-dekryptering)
    // körs bara när det FINNS en sessionscookie, så utloggade besökare — merparten
    // av den publika trafiken, och all crawler-trafik — kostar noll krypto.
    if (sessionCookieCandidates().some((n) => req.cookies.has(n))) {
      const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
      if (token) await renewSession(req, res, token);
    }
    return res;
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
  const res = syncAuthHint(req, intlMiddleware(req));
  await renewSession(req, res, token);
  return res;
}

export const config = {
  // Kör på alla sidvägar (så next-intl kan locale-routa + bot-403:an täcker allt);
  // hoppa api, _next, _vercel och filer med punkt (robots.txt, bilder, sw.js …).
  matcher: ["/((?!api|_next|_vercel|.*\\..*).*)"],
};
