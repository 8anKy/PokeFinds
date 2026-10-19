import { NextResponse } from "next/server";
import { routing } from "@/i18n/routing";
import { LOCALE_COOKIE_NAME } from "@/lib/locale-cookie";

/**
 * Språkvalet sparas av SERVERN (2026-10-20). Språkväljaren skrev `NEXT_LOCALE` med
 * `document.cookie`, och WebKit kapar ALLA script-skrivna cookies till 7 dygn
 * (iPhone-Safari, Chrome på iOS och appens WKWebView) — valet "fastnade inte",
 * det föll tillbaka efter en vecka. Samma fälla som `fo_auth` (auth-accounts.md).
 * En cookie satt med `Set-Cookie` får den livslängd vi anger.
 *
 * ⛔ Anropas av `locale-switcher.tsx` EFTER `router.replace`: next-intls klientrouter
 * skriver samma cookie synkront i det anropet, och den SENASTE skrivningen avgör om
 * cookien är kapad. Ingen DB, ingen session — bara ett vitlistat språk.
 */
export async function POST(req: Request) {
  const { locale } = (await req.json().catch(() => ({}))) as { locale?: unknown };
  if (typeof locale !== "string" || !(routing.locales as readonly string[]).includes(locale)) {
    return NextResponse.json({ error: "Okänt språk." }, { status: 400 });
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(LOCALE_COOKIE_NAME, locale, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
  });
  return res;
}
