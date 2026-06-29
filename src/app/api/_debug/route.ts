import { NextResponse } from "next/server";
import { getRedis } from "@/lib/queue";

// TILLFÄLLIG felsökning av reload-loopen i WebView:en. Klienten POST:ar sin
// pathname vid varje sidladdning → vi ser sekvensen av URL:er som loopar.
// TA BORT när loopen är löst.
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const { path, ua } = (await req.json()) as { path?: string; ua?: string };
    const r = getRedis();
    if (r) {
      await r.lpush("debug:nav", `${new Date().toISOString()} ${path ?? "?"} ${ua ?? ""}`);
      await r.ltrim("debug:nav", 0, 99);
    }
  } catch {
    // tyst
  }
  return NextResponse.json({ ok: true });
}

export async function GET() {
  const r = getRedis();
  const list = r ? await r.lrange("debug:nav", 0, 99) : [];
  return NextResponse.json({ list });
}
