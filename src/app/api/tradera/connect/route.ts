import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { buildTraderaLoginUrl } from "@/lib/tradera-auth";

export const dynamic = "force-dynamic";

const SKEY_COOKIE = "tradera_skey";

/** Startar Tradera-kontokoppling: skapar en skey, sparar den kort i en cookie, skickar till Tradera-inloggningen. */
export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.redirect(new URL("/logga-in", req.url));
  }

  const skey = crypto.randomUUID();
  const res = NextResponse.redirect(buildTraderaLoginUrl(skey));
  res.cookies.set(SKEY_COOKIE, skey, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 600, // 10 min — hela login-omvägen är klar på sekunder
    path: "/api/tradera",
  });
  return res;
}
