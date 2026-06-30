import { NextResponse, type NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";

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

export async function middleware(req: NextRequest) {
  const ua = req.headers.get("user-agent") ?? "";
  if (BLOCKED_BOTS.test(ua)) {
    return new NextResponse(null, { status: 403 });
  }

  const { pathname, search } = req.nextUrl;

  // Publika sidor (inkl. /produkter, /sets) auth-gatas inte — släpp igenom efter
  // bot-kollen ovan. Bara de skyddade prefixen kräver inloggning.
  if (!PROTECTED_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"))) {
    return NextResponse.next();
  }

  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });

  if (!token) {
    // Behåll EXAKT samma origin som inkommande request (www vs apex) — annars blir
    // omdirigeringen cross-origin och Capacitor-WebView:en kastar ut den till Safari.
    const loginUrl = req.nextUrl.clone();
    loginUrl.pathname = "/logga-in";
    loginUrl.search = "";
    loginUrl.searchParams.set("callbackUrl", pathname + search);
    const res = NextResponse.redirect(loginUrl);
    // Ingen giltig session men klient-hinten `fo_auth` kan vara kvar (utgången
    // session rensar den inte) → chrome tror "inloggad" medan servern säger nej =
    // omdirigerings-flimmer. Rensa hinten så klient och server är överens.
    res.cookies.set("fo_auth", "", { maxAge: 0, path: "/" });
    return res;
  }

  if (pathname.startsWith("/admin")) {
    const role = typeof token.role === "string" ? token.role : "";
    if (!MODERATOR_ROLES.has(role)) {
      return NextResponse.redirect(new URL("/dashboard", req.url));
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/bevakningar/:path*",
    // /samling + /skanna gatas på sid-nivå (server-redirect / klient-gate) i stället
    // för här — middleware-redirecten följdes som en HÅRD navigering → Capacitor
    // kastade ut den till Safari. Sid-nivå-redirect (som /mer) stannar i appen.
    "/installningar/:path*",
    "/onboarding/:path*",
    "/admin/:path*",
    // Crawl-tunga publika ytor — bara för bot-403:an ovan (auth-gatas inte).
    // Produktsidorna är den dyra ytan (~20k DB-renders); sets renderar per slug med.
    "/produkter/:path*",
    "/sets/:path*",
  ],
};
