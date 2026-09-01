import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * Landning efter Google-/Apple-inloggning (webb OCH app). Klienten vet inte om
 * kontot just skapades eller fanns sedan tidigare — det gör sessionen. Nya
 * konton (onboarding ej gjord) skickas till onboardingen, precis som formulär-
 * registreringen gör; alla andra till `next`.
 *
 * `next` är ÖPPEN INDATA: bara en relativ sökväg på samma origin accepteras
 * ("/…" men inte "//evil" eller "https://…"), annars katalogen.
 *
 * ⛔ ALDRIG `new URL(target, req.url)` här: i en route handler bakom Railways
 * proxy är `req.url` containerns INTERNA adress (localhost:8080), inte
 * foilio.se — Google-inloggningen slutade i "localhost refused to connect"
 * med sessionen korrekt satt (upptäckt 2026-09-01). Middleware ser rätt host;
 * route handlers gör det inte. Bygg alltid mot BASE_URL-mönstret (`||`, inte
 * `??` — tom sträng är felläget).
 */
const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || "https://foilio.se";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.redirect(new URL("/logga-in?error=OAuthCallback", BASE_URL));
  }
  const raw = req.nextUrl.searchParams.get("next") ?? "";
  const next = /^\/(?!\/)/.test(raw) ? raw : "/produkter";
  const target = session.user.onboardingCompleted ? next : "/onboarding";
  return NextResponse.redirect(new URL(target, BASE_URL));
}
