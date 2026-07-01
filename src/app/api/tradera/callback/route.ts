import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { fetchTraderaToken } from "@/lib/tradera-auth";

export const dynamic = "force-dynamic";

const SKEY_COOKIE = "tradera_skey";
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

/** Accept URL för Tradera token-login (Option 2): byter userId+skey mot en riktig token. */
export async function GET(req: NextRequest) {
  const settingsUrl = new URL("/installningar", APP_URL);

  const session = await auth();
  const skey = req.cookies.get(SKEY_COOKIE)?.value;
  const traderaUserId = req.nextUrl.searchParams.get("userId");

  if (!session?.user || !skey || !traderaUserId) {
    settingsUrl.searchParams.set("tradera", "fel");
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
    settingsUrl.searchParams.set("tradera", "fel");
  }

  const res = NextResponse.redirect(settingsUrl);
  res.cookies.delete({ name: SKEY_COOKIE, path: "/api/tradera" });
  return res;
}
