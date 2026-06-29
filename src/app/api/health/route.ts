import { NextResponse } from "next/server";

// Liveness-check för uptime-monitorn. MEDVETET ingen DB-fråga: en monitor som
// pingar var minut skulle annars hålla Neon vaken dygnet runt = onödig compute.
// Detta bekräftar bara att app-processen svarar.
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({ status: "ok", time: new Date().toISOString() });
}
