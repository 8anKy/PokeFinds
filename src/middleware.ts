import { NextResponse, type NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";
import createMiddleware from "next-intl/middleware";
import { routing } from "@/i18n/routing";

const intlMiddleware = createMiddleware(routing);

const MODERATOR_ROLES = new Set(["MODERATOR", "ADMIN", "SUPERADMIN"]);

// Lågvärdes-crawlers (Applebot m.fl.) svepte hela ~20k-produktkatalogen var par
// sekund → varje slug = DB-render → Neon-computen scale-to-zero aldrig. robots.txt
// blockerar dem men hedras först när boten läst om den (~1 dygn) och vissa
// (Bytespider) struntar i robots helt. 403 här stoppar DB-renders DIREKT, före all
// rendering. Google/Bing är medvetet INTE med (dem vill vi ha för SEO).
const BLOCKED_BOTS =
  /Applebot|GPTBot|ClaudeBot|CCBot|Bytespider|AhrefsBot|SemrushBot|DataForSeoBot|MJ12bot/i;

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
    return intlMiddleware(req);
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
  return intlMiddleware(req);
}

export const config = {
  // Kör på alla sidvägar (så next-intl kan locale-routa + bot-403:an täcker allt);
  // hoppa api, _next, _vercel och filer med punkt (robots.txt, bilder, sw.js …).
  matcher: ["/((?!api|_next|_vercel|.*\\..*).*)"],
};
