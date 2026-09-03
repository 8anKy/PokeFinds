import { NextResponse, type NextRequest } from "next/server";
import { encode, getToken, type JWT } from "next-auth/jwt";
import createMiddleware from "next-intl/middleware";
import { routing } from "@/i18n/routing";
import { isBlockedBot } from "@/lib/blocked-bots";
import {
  CREATOR_REF_COOKIE,
  CREATOR_REF_MAX_AGE,
  CREATOR_REF_PARAM,
  creatorRefAction,
} from "@/lib/creator-ref";
import { LOCALE_COOKIE_NAME, dropSetCookie, shouldDropLocaleCookie } from "@/lib/locale-cookie";
import {
  BETA_COOKIE,
  BETA_COOKIE_MAX_AGE,
  GATED_FALLBACK_PATH,
  communityV2Allowed,
  isGatedPath,
} from "@/lib/community-v2-gate";
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
  // Meddelanden och forumets skrivsida kräver konto. Läsvyerna (/forum,
  // /forum/g/…, /forum/t/…) är publika men GRINDADE (se communityGate nedan).
  "/meddelanden",
  "/forum/ny",
  // Sparade/gillade trådar är per definition personliga.
  "/forum/sparade",
];

/**
 * `fo_beta`-hinten: samma idé som `fo_auth` — en icke-httpOnly cookie som
 * klient-chrome (bottenflikar, /mer) läser för att visa Forum/Meddelanden utan
 * att fråga servern. Servern är facit (grinden nedan körs på varje sidvisning);
 * cookien är bara en spegel av det senaste svaret. Skrivs BARA när den är oense
 * med facit — ett `Set-Cookie` gör svaret ocachbart i Railways edge.
 */
function syncBetaHint(req: NextRequest, res: NextResponse, allowed: boolean): NextResponse {
  const has = req.cookies.get(BETA_COOKIE)?.value === "1";
  if (allowed && !has) {
    res.cookies.set(BETA_COOKIE, "1", { path: "/", maxAge: BETA_COOKIE_MAX_AGE, sameSite: "lax" });
  } else if (!allowed && has) {
    res.cookies.set(BETA_COOKIE, "", { path: "/", maxAge: 0, sameSite: "lax" });
  }
  return res;
}

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
 * Fångar kreatörslänkens `?ref=EMMA` i en cookie som lever i 30 dygn, så att
 * attributionen överlever fram till registreringen (som kan ske långt senare, på
 * en annan sida). Se lib/creator-ref.ts för VARFÖR den måste sättas här:
 * `document.cookie` kapas till 7 dygn av WebKit, dvs på ungefär halva trafiken.
 *
 * ⛔ NOLL DB. Koden slås upp mot CreatorCode först vid registreringen — en fråga
 * här hade väckt Neon för varje anonym sidvisning och crawler-träff.
 *
 * ⛔ Parametern lämnas kvar i URL:en med flit. Att strippa den kräver en redirect
 * (en extra rundtur för varje kreatörsklick) och skulle dessutom göra länken
 * omöjlig att felsöka genom att bara titta på adressfältet.
 */
function captureCreatorRef(req: NextRequest, res: NextResponse): NextResponse {
  const action = creatorRefAction(
    req.nextUrl.searchParams.get(CREATOR_REF_PARAM),
    req.cookies.get(CREATOR_REF_COOKIE)?.value
  );
  if (action.type === "set") {
    res.cookies.set(CREATOR_REF_COOKIE, action.value, {
      path: "/",
      maxAge: CREATOR_REF_MAX_AGE,
      sameSite: "lax",
    });
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
  // ⛔ `isBlockedBot`, inte `BLOCKED_BOTS.test` — namnlistan är bara HALVA domen sedan
  // 2026-08-26. Det största svepet den dagen bar inget crawler-namn alls utan en
  // förfalskad webbläsarsträng från 321 roterande IP-adresser; se blocked-bots.ts.
  if (isBlockedBot(ua)) {
    return new NextResponse(null, { status: 403 });
  }

  const { pathname, search } = req.nextUrl;
  const [path, prefix] = splitLocale(pathname);

  // `getToken` (en JWE-dekryptering) körs bara när det FINNS en sessionscookie,
  // så utloggade besökare — merparten av den publika trafiken, och all
  // crawler-trafik — kostar noll krypto. Token:en delas av sessionsförnyelsen,
  // admin-grinden och community-grinden nedan.
  const hasSession = sessionCookieCandidates().some((n) => req.cookies.has(n));
  const token = hasSession ? await getToken({ req, secret: process.env.NEXTAUTH_SECRET }) : null;

  // COMMUNITY-GRINDEN (forum, meddelanden). Lanseringsgrind, inte säkerhet — se
  // lib/community-v2-gate.ts. Den som inte släpps in landar på "snart här".
  const communityAllowed = communityV2Allowed({
    userAgent: ua,
    role: typeof token?.role === "string" ? token.role : null,
    publicFlag: process.env.COMMUNITY_V2_PUBLIC,
  });
  if (isGatedPath(path) && !communityAllowed) {
    const res = NextResponse.redirect(new URL(`${prefix}${GATED_FALLBACK_PATH}`, req.url));
    return syncBetaHint(req, res, false);
  }

  // Publika sidor auth-gatas inte — låt next-intl sköta locale-routing direkt.
  const isProtected = PROTECTED_PREFIXES.some((p) => path === p || path.startsWith(p + "/"));
  if (!isProtected) {
    const res = syncBetaHint(
      req,
      captureCreatorRef(req, syncAuthHint(req, intlMiddleware(req))),
      communityAllowed
    );
    // Sessionen förnyas ÄVEN på publika sidor — annars hade den som mest bläddrar
    // i katalogen loggats ut trots daglig användning.
    if (token) await renewSession(req, res, token);
    // ⛔ SIST AV ALLT, OCH BARA HÄR. next-intl sätter `NEXT_LOCALE` på varje
    // begäran som saknar BÅDE cookien och `Accept-Language` — dvs om och om igen
    // för klienter som inte sparar cookies (crawlers, `curl`), en enda gång för
    // en webbläsare. Ett svar med `Set-Cookie` lagras aldrig av Railways
    // edge-cache (mätt: DYNAMIC→HIT när cookien ströks). Domen
    // — inklusive "aldrig för en inloggad" — bor i lib/locale-cookie.ts, som
    // också förklarar varför det här INTE sparar någon Neon-tid: Next:s egen
    // ISR-cache var redan HIT, så ingen DB-väckning stod på spel. Strykningen
    // måste ligga efter renewSession/syncAuthHint/captureCreatorRef eftersom ett
    // senare `res.cookies.set(...)` bygger om hela Set-Cookie-headern.
    if (shouldDropLocaleCookie(req.headers.get("accept-language"), hasSession)) {
      dropSetCookie(res.headers, LOCALE_COOKIE_NAME);
    }
    return res;
  }

  if (!token) {
    // Behåll EXAKT samma origin + locale-prefix — annars cross-origin/språkbyte.
    const loginUrl = req.nextUrl.clone();
    loginUrl.pathname = `${prefix}/logga-in`;
    loginUrl.search = "";
    loginUrl.searchParams.set("callbackUrl", pathname + search);
    const res = NextResponse.redirect(loginUrl);
    res.cookies.set("fo_auth", "", { maxAge: 0, path: "/" });
    // En kreatörslänk kan peka på en skyddad sida — cookien måste överleva
    // omdirigeringen till inloggningen, annars tappas attributionen precis för
    // den besökare som är på väg att skapa ett konto.
    return captureCreatorRef(req, res);
  }

  if (path.startsWith("/admin")) {
    const role = typeof token.role === "string" ? token.role : "";
    if (!MODERATOR_ROLES.has(role)) {
      return NextResponse.redirect(new URL(`${prefix}/dashboard`, req.url));
    }
  }

  // Autentiserad OK → låt next-intl sätta locale-context/rewrite.
  const res = syncBetaHint(
    req,
    captureCreatorRef(req, syncAuthHint(req, intlMiddleware(req))),
    communityAllowed
  );
  await renewSession(req, res, token);
  return res;
}

export const config = {
  // Kör på alla sidvägar (så next-intl kan locale-routa + bot-403:an täcker allt);
  // hoppa api, _next, _vercel och filer med punkt (robots.txt, bilder, sw.js …).
  matcher: ["/((?!api|_next|_vercel|.*\\..*).*)"],
};
