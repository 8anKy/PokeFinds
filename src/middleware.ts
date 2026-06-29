import { NextResponse, type NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";

const MODERATOR_ROLES = new Set(["MODERATOR", "ADMIN", "SUPERADMIN"]);

export async function middleware(req: NextRequest) {
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
  const { pathname, search } = req.nextUrl;

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
  ],
};
