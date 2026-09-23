import { NextResponse } from "next/server";
import { pageCacheReclaimStatus, readCgroupMemoryBytes, readCgroupMemoryStat } from "@/lib/memory-recycle";

// Liveness-check för uptime-monitorn. MEDVETET ingen DB-fråga: en monitor som
// pingar var minut skulle annars hålla Neon vaken dygnet runt = onödig compute.
// Detta bekräftar bara att app-processen svarar.
export const dynamic = "force-dynamic";

// `mem` (MB) finns för att skilja Node-processens RSS från det Railway fakturerar:
// `cgroup` är containerns minne enligt kerneln — SAMMA tal som Railways graf och
// faktura (och som `memory-recycle.ts` beslutar på). Grafen växer med upptiden
// TROTS heap-taket i Dockerfile (0,3 → ~1 GB på tre dygn, mätt 2026-08-29);
// skillnaden `cgroup − rss` är sidcache/fragmentering. Ingen DB, inga hemligheter.
export function GET() {
  const m = process.memoryUsage();
  const cg = readCgroupMemoryBytes();
  const stat = readCgroupMemoryStat();
  const mb = (n: number) => Math.round(n / 1048576);
  return NextResponse.json({
    status: "ok",
    time: new Date().toISOString(),
    uptimeH: Math.round(process.uptime() / 360) / 10,
    mem: {
      rss: mb(m.rss),
      heapUsed: mb(m.heapUsed),
      external: mb(m.external),
      arrayBuffers: mb(m.arrayBuffers),
      cgroup: cg === null ? null : mb(cg),
      // anon = processminne, file = sidcache (se memory-recycle.ts, "SIDCACHEN RÄKNAS").
      anon: stat ? mb(stat.anon) : null,
      file: stat ? mb(stat.file) : null,
      reclaim: pageCacheReclaimStatus(),
    },
  });
}
