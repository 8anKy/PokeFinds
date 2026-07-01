import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { fetchTraderaToken } from "@/lib/tradera-auth";

export const dynamic = "force-dynamic";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

/** Accept URL för Tradera token-login (Option 2): byter userId+skey mot en riktig token. */
export async function GET(req: NextRequest) {
  const settingsUrl = new URL("/installningar", APP_URL);

  const session = await auth();
  // skey kommer tillbaka via ruparams (Tradera ekar det okodat), INTE en cookie —
  // en cookie satt på ett redirect-svar överlever inte native-appens WKWebView-omväg.
  const skey = req.nextUrl.searchParams.get("skey");
  const traderaUserId = req.nextUrl.searchParams.get("userId");

  // ponytail: felkoden i URL:en (inte bara loggar) så vi kan diagnostisera utan
  // Railway-loggåtkomst — ta bort igen när flödet är verifierat i produktion.
  if (!session?.user) {
    settingsUrl.searchParams.set("tradera", "fel-ingen-session");
    return NextResponse.redirect(settingsUrl);
  }
  if (!skey) {
    settingsUrl.searchParams.set("tradera", "fel-ingen-skey");
    return NextResponse.redirect(settingsUrl);
  }
  if (!traderaUserId) {
    settingsUrl.searchParams.set("tradera", "fel-ingen-userid");
    return NextResponse.redirect(settingsUrl);
  }

  try {
    const { token, expiresAt } = await fetchTraderaToken(traderaUserId, skey);
    await prisma.user.update({
      where: { id: session.user.id },
      data: { traderaUserId, traderaToken: token, traderaTokenExpiresAt: expiresAt },
    });
    settingsUrl.searchParams.set("tradera", "ansluten");
  } catch (err) {
    console.error("[tradera-callback] FetchToken misslyckades:", err);
    settingsUrl.searchParams.set("tradera", "fel-fetchtoken");
    settingsUrl.searchParams.set(
      "tradera_detail",
      `userId=${traderaUserId} ${(err instanceof Error ? err.message : String(err)).slice(0, 160)}`
    );
  }

  return NextResponse.redirect(settingsUrl);
}
