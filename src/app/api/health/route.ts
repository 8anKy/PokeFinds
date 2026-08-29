import { NextResponse } from "next/server";

// Liveness-check för uptime-monitorn. MEDVETET ingen DB-fråga: en monitor som
// pingar var minut skulle annars hålla Neon vaken dygnet runt = onödig compute.
// Detta bekräftar bara att app-processen svarar.
export const dynamic = "force-dynamic";

// `mem` (MB) finns för att skilja Node-processens RSS från det Railway fakturerar:
// Railways minnesgraf växer med upptiden TROTS heap-taket i Dockerfile (0,3 → ~1 GB
// på tre dygn, mätt 2026-08-29). Hypotesen är att cgroup-minnet räknar kernelns
// sidcache för de ISR-filer Next skriver vid varje kall render (~5 000/dygn, aldrig
// rensade). Stämmer den är RSS här mycket lägre än grafen. Ingen DB, inga hemligheter.
export function GET() {
  const m = process.memoryUsage();
  const mb = (n: number) => Math.round(n / 1048576);
  return NextResponse.json({
    status: "ok",
    time: new Date().toISOString(),
    uptimeH: Math.round(process.uptime() / 360) / 10,
    mem: { rss: mb(m.rss), heapUsed: mb(m.heapUsed), external: mb(m.external), arrayBuffers: mb(m.arrayBuffers) },
  });
}
