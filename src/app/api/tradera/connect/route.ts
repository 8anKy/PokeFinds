import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { auth } from "@/lib/auth";
import { buildTraderaLoginUrl, TRADERA_CONNECT_COOKIE } from "@/lib/tradera-auth";

export const dynamic = "force-dynamic";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

/** Startar Tradera-kontokoppling: skickar till Tradera-inloggningen (Option 3 — token kommer tillbaka i Accept URL:en). */
export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.redirect(new URL("/logga-in", APP_URL));
  }

  const res = NextResponse.redirect(buildTraderaLoginUrl());
  // CSRF-vakt: Tradera Option 3 kan inte eka tillbaka en state-param (Accept URL:en
  // är fast i appinställningarna), så callbacken kräver istället bevis på att
  // användaren själv startade kopplingen härifrån nyss. En smidd callback-länk
  // skickad till ett offer saknar kakan → avvisas.
  res.cookies.set(TRADERA_CONNECT_COOKIE, randomBytes(16).toString("hex"), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api/tradera",
    maxAge: 15 * 60,
  });
  return res;
}
