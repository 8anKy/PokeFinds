import { NextResponse, type NextRequest } from "next/server";
import { randomBytes } from "crypto";
import { auth } from "@/lib/auth";
import {
  buildAuthorizeUrl,
  discordLinkingEnabled,
  DISCORD_RETURN_COOKIE,
  DISCORD_RETURN_PATHS,
  DISCORD_STATE_COOKIE,
} from "@/lib/discord";

export const dynamic = "force-dynamic";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

/** Startar Discord-kopplingen: skickar användaren till Discords samtyckesruta. */
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.redirect(new URL("/logga-in", APP_URL));
  }
  if (!discordLinkingEnabled()) {
    const url = new URL("/installningar/kopplingar", APP_URL);
    url.searchParams.set("discord", "fel-avstangd");
    return NextResponse.redirect(url);
  }

  // CSRF: till skillnad från Tradera (som inte kan eka tillbaka någon parameter)
  // stöder Discord `state` — så vi kan göra det ordentligt. Samma slumpvärde
  // skickas till Discord OCH sätts som httpOnly-cookie; callbacken kräver att de
  // är IDENTISKA. En smidd callback-länk saknar cookien och avvisas.
  const state = randomBytes(32).toString("hex");
  const res = NextResponse.redirect(buildAuthorizeUrl(state));
  res.cookies.set(DISCORD_STATE_COOKIE, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api/discord",
    maxAge: 15 * 60,
  });
  // Tillbaka dit kopplingen startades (giveawayn), annars inställningarna.
  // ⛔ Bara vitlistade sökvägar — en fri parameter vore en öppen omdirigering.
  const ret = req.nextUrl.searchParams.get("return");
  if (ret && DISCORD_RETURN_PATHS.includes(ret)) {
    res.cookies.set(DISCORD_RETURN_COOKIE, ret, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/api/discord",
      maxAge: 15 * 60,
    });
  }
  return res;
}
