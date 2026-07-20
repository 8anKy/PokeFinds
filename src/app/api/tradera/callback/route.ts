import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { TRADERA_CONNECT_COOKIE } from "@/lib/tradera-auth";

export const dynamic = "force-dynamic";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

/**
 * Accept URL för Tradera token-login (Option 3): Tradera lägger token/exp/userId
 * direkt i URL:en. Kräver "Display token on return URL" = PÅ i appinställningarna.
 */
export async function GET(req: NextRequest) {
  const settingsUrl = new URL("/installningar", APP_URL);

  const session = await auth();
  const token = req.nextUrl.searchParams.get("token");
  const exp = req.nextUrl.searchParams.get("exp");
  const traderaUserId = req.nextUrl.searchParams.get("userId");

  // ponytail: felkoden i URL:en (inte bara loggar) så vi kan diagnostisera utan
  // Railway-loggåtkomst — ta bort igen när flödet är verifierat i produktion.
  if (!session?.user) {
    settingsUrl.searchParams.set("tradera", "fel-ingen-session");
    return NextResponse.redirect(settingsUrl);
  }
  // Saknas token → "Display token on return URL" är troligen AV i appinställningarna.
  if (!token || !traderaUserId) {
    settingsUrl.searchParams.set("tradera", "fel-ingen-token");
    return NextResponse.redirect(settingsUrl);
  }
  // CSRF-vakt: kakan sätts bara av /api/tradera/connect. Utan den har användaren
  // inte själv startat kopplingen (t.ex. en smidd länk med någon annans token) →
  // avvisa istället för att binda kontot. Se connect/route.ts.
  if (!req.cookies.get(TRADERA_CONNECT_COOKIE)?.value) {
    settingsUrl.searchParams.set("tradera", "fel-ej-startad");
    return NextResponse.redirect(settingsUrl);
  }

  await prisma.user.update({
    where: { id: session.user.id },
    data: {
      traderaUserId,
      traderaToken: token,
      traderaTokenExpiresAt: exp ? new Date(exp) : null,
    },
  });
  settingsUrl.searchParams.set("tradera", "ansluten");

  const res = NextResponse.redirect(settingsUrl);
  res.cookies.set(TRADERA_CONNECT_COOKIE, "", { path: "/api/tradera", maxAge: 0 });
  return res;
}
