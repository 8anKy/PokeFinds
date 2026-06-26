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
    return NextResponse.redirect(loginUrl);
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
    "/samling/:path*",
    "/skanna/:path*",
    "/installningar/:path*",
    "/onboarding/:path*",
    "/admin/:path*",
  ],
};
