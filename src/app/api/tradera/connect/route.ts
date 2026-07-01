import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { buildTraderaLoginUrl } from "@/lib/tradera-auth";

export const dynamic = "force-dynamic";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

/** Startar Tradera-kontokoppling: skickar till Tradera-inloggningen med en skey som ekas tillbaka via ruparams. */
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.redirect(new URL("/logga-in", APP_URL));
  }

  const skey = crypto.randomUUID();
  const url = buildTraderaLoginUrl(skey);

  // ponytail: TEMPORÄR — visar URL:en som JSON i stället för att redirecta, så
  // vi kan läsa den utan att webbläsaren döljer Location-headern. Ta bort igen.
  if (req.nextUrl.searchParams.get("debug") === "1") {
    return NextResponse.json({ url });
  }
  // ponytail: TEMPORÄR — riktig 307 inom VÅR EGEN domän (ingen extern trafik) med
  // samma appId=6129-mönster, för att se om något 307-svar tappar/lägger till
  // citattecken i transit, eller om det är specifikt för Tradera. Ta bort igen.
  if (req.nextUrl.searchParams.get("debug") === "2") {
    return NextResponse.redirect(`${APP_URL}/api/tradera/debug-env?echo=1&testAppId=6129`);
  }
  return NextResponse.redirect(url);
}
