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
 *    morgontrafiken) och minnet > MEMORY_RECYCLE_MB (450) ⇒ starta om. En gång
 *    per dygn räcker för att kapa sågtanden till dess första dygn.
 *    ⚠️ 700→450 (2026-08-31): cgroup mätte 541 MB redan 4,5 h efter en deploy —
 *    700 fyrade alltså inte varje natt och dygnssnittet parkerade över 0,5 GB
 *    (> $5/mån för minnet ensamt). Under $5 TOTALT kräver snitt ≤ ~0,42 GB ⇒
 *    taket måste ligga UNDER dygn-1-nivån så omstarten i praktiken blir nattlig.
 *  - Nöd: minnet > MEMORY_RECYCLE_EMERGENCY_MB (koddefault 1000; PROD KÖR 550 via
 *    Railway-env sedan 2026-09-01 — nattlig-enbart parkerade dygnssnittet på ~0,55 GB
 *    och taket fungerar nu som dygnet-runt-kap) när som helst ⇒ starta om.
 *    Det är NÖDGRINDEN som betalar sig, inte den nattliga: per dygn (railway-cost-
 *    report 2026-08-29) kostar en lugn dag ~0,4 GB ≈ $0,14, men 08-22 (2,9 GB snitt,
 *    crawler-skur) kostade $1,01 och 08-28 (1,6 GB) $0,56 — två skurdagar = en
 *    vecka av lugna. 1 GB (sänkt från 1,5 2026-08-31) är ~3× minnet efter boot; en skur förbi det är
 *    skräp, inte arbete. Minst 3 h mellan nödomstarter så en envis skur inte ger
 *    en omstartsloop (värsta fall: ~8 omstarter/dygn, var och en några sekunder).
 *
 * SÅ HÄR STARTAR VI OM: buffertarna töms först (analytics + klickräknare — samma
 * väg som SIGTERM), sedan `process.exit(1)`. Railways omstartspolicy (ON_FAILURE)
 * startar containern igen på några sekunder; exit 0 hade INTE startats om. Sidor
 * mitt i en request tappas — därav det tysta fönstret för den planerade vägen.
 * ⛔ Kräver att omstartspolicyn står på ON_FAILURE/ALWAYS i Railway (Settings →
 * Deploy). Står den på NEVER blir det här en självdödare.
 * ⛔ HÄNDE 2026-08-31: exit(1) kl 04:52 UTC och containern kom ALDRIG tillbaka —
 * sajten låg nere ~6,5 h tills en manuell deploy väckte den. Policyn är därför
 * PINNAD i repo:t via railway.json (restartPolicyType: ALWAYS, sleepApplication:
 * false) — config-as-code vinner över dashboarden vid varje deploy. Ta aldrig
 * bort railway.json utan att först verifiera policyn i dashboarden.
 *
 * Sätt MEMORY_RECYCLE_MB=0 för att stänga av helt.
 */
// Ingen statisk fs-import: instrumentation.ts buntas även för edge-runtimen och webpack
// vägrar "node:fs" där. process.getBuiltinModule (Node ≥ 22.3) laddar modulen utan att
// webpack ser den; saknas den (edge/äldre Node) blir svaret null = "ingen container".
type FsLike = {
  readFileSync(path: string, enc: string): string;
  writeFileSync(path: string, data: string): void;
};
function nodeFs(): FsLike | null {
  const get = (process as unknown as { getBuiltinModule?: (id: string) => unknown }).getBuiltinModule;
  if (typeof get !== "function") return null;
  try {
    return get.call(process, "node:fs") as FsLike;
  } catch {
    return null;
  }
}

const CGROUP_FILES = [
  "/sys/fs/cgroup/memory.current", // cgroup v2 (Railway)
  "/sys/fs/cgroup/memory/memory.usage_in_bytes", // cgroup v1
];

/** Containerns minne i byte enligt cgroup, eller null utanför en container. */
export function readCgroupMemoryBytes(): number | null {
  const fs = nodeFs();
  if (!fs) return null;
  for (const file of CGROUP_FILES) {
    try {
      const n = Number(fs.readFileSync(file, "utf8").trim());
      if (Number.isFinite(n) && n > 0) return n;
    } catch {
      /* finns inte här — prova nästa */
    }
  }
  return null;
}

/**
 * SIDCACHEN RÄKNAS SOM MINNE — OCH FAKTURERAS (mätt 2026-09-23).
 *
 * `memory.current` = Nodes RSS + kernelns sidcache för filerna containern läst och
 * skrivit. ISR-cachen skriver en gzippad sida till volymen per kall render, och varje
 * skriven fil ligger kvar i sidcachen tills kernelns minnestryck vräker den — vilket
 * aldrig kommer: containerns tak ligger långt över det vi använder. Mätt: /api/health
 * rss 580 / cgroup 753 MB en halvtimme efter en deploy, och Railways minnesgraf följer
 * cgroup-talet, inte RSS. Vi betalade alltså $10/GB-mån för en cache som kernel
 * hade släppt gratis, och `exit(1)`-vakten nedan dödade friska processer för den.
 *
 * cgroup v2 har en knapp för just det: att skriva ett antal byte till
 * `memory.reclaim` ber kernel vräka så mycket ur gruppen, sidcache först (utan
 * swap går anonymt minne inte att vräka alls). Vi begär bara den FIL-backade delen
 * ovanför ett litet golv. Går filen inte att skriva (read-only cgroupfs, äldre
 * kernel) noteras felet EN gång och resten av modulen beter sig som förut.
 * Status syns i /api/health (`mem.reclaim`).
 */
const CGROUP_STAT = "/sys/fs/cgroup/memory.stat";
const CGROUP_RECLAIM = "/sys/fs/cgroup/memory.reclaim";
/** Sidcache under golvet lämnas i fred — den är den varma delen (koden, heta sidor). */
const RECLAIM_FLOOR_BYTES = 48 * 1048576;
/** Så här mycket sidcache måste ha samlats innan vi ber om en vräkning. */
const RECLAIM_TRIGGER_BYTES = 96 * 1048576;

export interface CgroupMemoryStat {
  anon: number;
  file: number;
}

/** `anon` + `file` ur cgroup v2:s memory.stat, eller null (v1/ingen container). */
export function readCgroupMemoryStat(): CgroupMemoryStat | null {
  const fs = nodeFs();
  if (!fs) return null;
  try {
    return parseMemoryStat(fs.readFileSync(CGROUP_STAT, "utf8"));
  } catch {
    return null;
  }
}

export function parseMemoryStat(text: string): CgroupMemoryStat | null {
  const values = new Map<string, number>();
  for (const line of text.split("\n")) {
    const [key, value] = line.trim().split(" ");
    if (key && value !== undefined) values.set(key, Number(value));
  }
  const anon = values.get("anon");
  const file = values.get("file");
  if (!Number.isFinite(anon) || !Number.isFinite(file)) return null;
  return { anon: anon as number, file: file as number };
}

/** Hur många byte sidcache vi ska be kernel vräka nu (0 = inget). Ren, testbar. */
export function pageCacheToReclaim(fileBytes: number): number {
  if (!(fileBytes > RECLAIM_TRIGGER_BYTES)) return 0;
  return fileBytes - RECLAIM_FLOOR_BYTES;
}

let reclaimStatus: string = "not-run";
/** För /api/health: "ok", felkoden från första misslyckade försöket, eller "not-run". */
export function pageCacheReclaimStatus(): string {
  return reclaimStatus;
}

/** Ber kernel vräka gruppens överflödiga sidcache. Returnerar vräkta byte (≈), 0 vid inget/fel. */
export function reclaimPageCache(): number {
  if (reclaimStatus !== "not-run" && reclaimStatus !== "ok") return 0; // gick inte förra gången
  const fs = nodeFs();
  const stat = readCgroupMemoryStat();
  if (!fs || !stat) return 0;
  const want = pageCacheToReclaim(stat.file);
  if (want <= 0) return 0;
  try {
    fs.writeFileSync(CGROUP_RECLAIM, String(want));
  } catch (e) {
    // EAGAIN = kernel hann inte vräka ALLT vi bad om — delvis lyckat, inte ett fel.
    const code = (e as { code?: string }).code ?? "error";
    if (code !== "EAGAIN") {
      reclaimStatus = code;
      console.log(`[memory-recycle] memory.reclaim går inte att använda här (${code}) — sidcachen lämnas åt kernel.`);
      return 0;
    }
  }
  const after = readCgroupMemoryStat();
  const freed = after ? Math.max(0, stat.file - after.file) : 0;
  if (reclaimStatus === "not-run") {
    console.log(
      `[memory-recycle] memory.reclaim fungerar: sidcache ${Math.round(stat.file / 1048576)} → ${Math.round((after?.file ?? 0) / 1048576)} MB.`
    );
  }
  reclaimStatus = "ok";
  return freed;
}

const RECLAIM_MS = 2 * 60 * 1000;

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
    thresholdMb: Number(env.MEMORY_RECYCLE_MB ?? 450),
    emergencyMb: Number(env.MEMORY_RECYCLE_EMERGENCY_MB ?? 1000),
    quietHourUtc: 4,
    minUptimeSec: 3600,
    emergencySpacingSec: 3 * 3600,
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
  // Sidcachen töms OFTARE än omstartsvakten tittar: ett crawlersvep skriver ~200 MB
  // ISR-filer i timmen, och varje minut de ligger kvar är fakturerad.
  const reclaimTimer = setInterval(() => {
    try {
      reclaimPageCache();
    } catch {
      /* får aldrig fälla processen */
    }
  }, RECLAIM_MS);
  reclaimTimer.unref?.();
  let lastEmergencyAt: number | null = null;
  const timer = setInterval(async () => {
    // Vräk sidcachen FÖRE beslutet — omstarten ska bara ta det kernel inte kan släppa.
    try {
      reclaimPageCache();
    } catch {
      /* ignoreras */
    }
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
