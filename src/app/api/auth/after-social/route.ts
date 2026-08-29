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
 */
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.redirect(new URL("/logga-in?error=OAuthCallback", req.url));
  }
  const raw = req.nextUrl.searchParams.get("next") ?? "";
  const next = /^\/(?!\/)/.test(raw) ? raw : "/produkter";
  const target = session.user.onboardingCompleted ? next : "/onboarding";
  return NextResponse.redirect(new URL(target, req.url));
}
