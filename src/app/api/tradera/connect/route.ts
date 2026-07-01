import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { buildTraderaLoginUrl } from "@/lib/tradera-auth";

export const dynamic = "force-dynamic";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

/** Startar Tradera-kontokoppling: skickar till Tradera-inloggningen med en skey som ekas tillbaka via ruparams. */
export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.redirect(new URL("/logga-in", APP_URL));
  }

  const skey = crypto.randomUUID();
  return NextResponse.redirect(buildTraderaLoginUrl(skey));
}
