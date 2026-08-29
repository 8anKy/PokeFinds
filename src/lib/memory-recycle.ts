/**
 * MINNESÅTERVINNING — appen startar om SIG SJÄLV när containerns minne vuxit.
 *
 * Railway fakturerar MINNE per GB-minut och det är ~90 % av notan ($5,34 av $5,92
 * est. 2026-08-29; Hobby-krediten är $5). Minnesgrafen är en SÅGTAND: ~0,3 GB direkt
 * efter en deploy, ~1 GB efter tre dygn, toppar på 5–6 GB vid crawler-skurar —
 * TROTS heap-taket (`--max-old-space-size=512`) och `MALLOC_ARENA_MAX=2` i
 * Dockerfile. Tillväxten ligger alltså UTANFÖR V8-heapen (sidcache för ISR-filer,
 * malloc-fragmentering, Prisma-motorn — orsaken är sekundär). Det enda som
 * bevisligen nollar den är en ny process. Så vi ger oss själva en, på vårt villkor.
 *
 * Talet vi läser är cgroup-minnet (`/sys/fs/cgroup/memory.current`) — SAMMA tal
 * Railway mäter och fakturerar, inte Nodes RSS. Finns filen inte (lokalt, Windows,
 * Vercel) gör modulen ingenting.
 *
 * TVÅ GRINDAR, aldrig fler:
 *  - Nattlig: i det tysta fönstret (04:00–04:59 UTC = efter nattkedjan, före
 *    morgontrafiken) och minnet > MEMORY_RECYCLE_MB (700) ⇒ starta om. En gång
 *    per dygn räcker för att kapa sågtanden till dess första dygn.
 *  - Nöd: minnet > MEMORY_RECYCLE_EMERGENCY_MB (3000) när som helst ⇒ starta om.
 *    5–6 GB i sex timmar är $0,10 — små pengar, men det är skräp, inte arbete.
 *    Minst 6 h mellan nödomstarter så en envis skur inte ger en omstartsloop.
 *
 * SÅ HÄR STARTAR VI OM: buffertarna töms först (analytics + klickräknare — samma
 * väg som SIGTERM), sedan `process.exit(1)`. Railways omstartspolicy (ON_FAILURE)
 * startar containern igen på några sekunder; exit 0 hade INTE startats om. Sidor
 * mitt i en request tappas — därav det tysta fönstret för den planerade vägen.
 * ⛔ Kräver att omstartspolicyn står på ON_FAILURE/ALWAYS i Railway (Settings →
 * Deploy). Står den på NEVER blir det här en självdödare.
 *
 * Sätt MEMORY_RECYCLE_MB=0 för att stänga av helt.
 */
import { readFileSync } from "node:fs";

const CGROUP_FILES = [
  "/sys/fs/cgroup/memory.current", // cgroup v2 (Railway)
  "/sys/fs/cgroup/memory/memory.usage_in_bytes", // cgroup v1
];

/** Containerns minne i byte enligt cgroup, eller null utanför en container. */
export function readCgroupMemoryBytes(): number | null {
  for (const file of CGROUP_FILES) {
    try {
      const n = Number(readFileSync(file, "utf8").trim());
      if (Number.isFinite(n) && n > 0) return n;
    } catch {
      /* finns inte här — prova nästa */
    }
  }
  return null;
}

export interface RecycleConfig {
  thresholdMb: number;
  emergencyMb: number;
  quietHourUtc: number;
  minUptimeSec: number;
  emergencySpacingSec: number;
}

export function recycleConfigFromEnv(
  env: Record<string, string | undefined> = process.env
): RecycleConfig {
  return {
    thresholdMb: Number(env.MEMORY_RECYCLE_MB ?? 700),
    emergencyMb: Number(env.MEMORY_RECYCLE_EMERGENCY_MB ?? 3000),
    quietHourUtc: 4,
    minUptimeSec: 3600,
    emergencySpacingSec: 6 * 3600,
  };
}

export type RecycleDecision = "none" | "nightly" | "emergency";

/**
 * Ren beslutsfunktion (testbar): ska processen återvinnas nu?
 * `now` i ms UTC, `lastEmergencyAt` i ms eller null.
 */
export function decideRecycle(
  memoryBytes: number,
  now: number,
  uptimeSec: number,
  lastEmergencyAt: number | null,
  cfg: RecycleConfig
): RecycleDecision {
  if (!(cfg.thresholdMb > 0)) return "none";
  if (uptimeSec < cfg.minUptimeSec) return "none";
  const mb = memoryBytes / 1048576;
  if (
    cfg.emergencyMb > 0 &&
    mb > cfg.emergencyMb &&
    (lastEmergencyAt === null || now - lastEmergencyAt > cfg.emergencySpacingSec * 1000)
  ) {
    return "emergency";
  }
  if (new Date(now).getUTCHours() === cfg.quietHourUtc && mb > cfg.thresholdMb) return "nightly";
  return "none";
}

const CHECK_MS = 10 * 60 * 1000;

/** Startar vakten. Returnerar false om cgroup-talet inte går att läsa (ingen container). */
export function startMemoryRecycler(): boolean {
  const cfg = recycleConfigFromEnv();
  if (!(cfg.thresholdMb > 0)) {
    console.log("[memory-recycle] Avstängd (MEMORY_RECYCLE_MB=0).");
    return false;
  }
  if (readCgroupMemoryBytes() === null) {
    console.log("[memory-recycle] Inget cgroup-minne att läsa — ingen container, vakten startas inte.");
    return false;
  }
  let lastEmergencyAt: number | null = null;
  const timer = setInterval(async () => {
    const bytes = readCgroupMemoryBytes();
    if (bytes === null) return;
    const decision = decideRecycle(bytes, Date.now(), process.uptime(), lastEmergencyAt, cfg);
    if (decision === "none") return;
    if (decision === "emergency") lastEmergencyAt = Date.now();
    console.log(
      `[memory-recycle] ${decision}: cgroup ${Math.round(bytes / 1048576)} MB efter ${Math.round(process.uptime() / 3600)} h — tömmer buffertar och startar om.`
    );
    clearInterval(timer);
    try {
      const { flushAnalyticsEvents } = await import("@/services/analytics");
      await flushAnalyticsEvents();
    } catch {
      /* spårning får aldrig hindra omstarten */
    }
    // Klickräknaren lyssnar på SIGTERM — ge den samma signal innan vi går.
    process.emit("SIGTERM", "SIGTERM");
    setTimeout(() => process.exit(1), 2000);
  }, CHECK_MS);
  timer.unref?.();
  console.log(
    `[memory-recycle] Vakt igång: nattligt tak ${cfg.thresholdMb} MB kl ${String(cfg.quietHourUtc).padStart(2, "0")} UTC, nödtak ${cfg.emergencyMb} MB.`
  );
  return true;
}
