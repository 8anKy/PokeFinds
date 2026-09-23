/**
 * GET /api/feature-preview?feature=APP_TOUR — får den här besökaren se en funktion
 * som ligger i förhandsvisning (lib/feature-preview.ts)?
 *
 * Finns för KLIENT-ytor som monteras i den ISR-cachade rot-layouten (den guidade
 * turen): där får ingen `auth()` köras, så grinden måste frågas efteråt. Läser bara
 * sessionens JWT (roll + e-post) och env — ingen egen databasfråga.
 */
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { previewAllowedFor, type PreviewFeature } from "@/lib/feature-preview";

export const dynamic = "force-dynamic";

const CLIENT_FEATURES = new Set<PreviewFeature>(["APP_TOUR"]);

export async function GET(req: Request) {
  const feature = new URL(req.url).searchParams.get("feature") as PreviewFeature | null;
  if (!feature || !CLIENT_FEATURES.has(feature)) return NextResponse.json({ allowed: false });
  const session = await auth().catch(() => null);
  const allowed = previewAllowedFor(feature, session?.user ?? null);
  return NextResponse.json({ allowed }, { headers: { "Cache-Control": "private, no-store" } });
}
