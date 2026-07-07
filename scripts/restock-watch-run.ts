/**
 * CLI-wrapper för den frekventa restock-bevakningen (GitHub Actions var 10:e min).
 *
 * Ändringsgrind: fs/crypto bor HÄR (ett fristående tsx-script som Next INTE buntar),
 * inte i runner.ts/restock.ts (de dras in i Next-bundlen via instrumentation → node-
 * builtins går inte att bunta där). Vi hämtar feeden, jämför dess fingeravtryck mot
 * förra körningens (cachat mellan Actions-körningar) och kör BARA DB-fasen om något
 * flippat → Neon sover på oförändrade körningar. Se src/lib/feed-fingerprint.ts.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { prisma } from "../src/lib/db";
import { runRestockScan, type RestockSourceInfo } from "../src/scrapers/runner";
import { feedFingerprint } from "../src/lib/feed-fingerprint";

const fpFile = process.env.RESTOCK_FINGERPRINT_FILE;
let currentFp: string | null = null;

// Källistan cachas på disk bredvid fingeravtrycket (samma actions/cache-katalog).
// Utan detta väckte redan källist-uppslaget Neon på VARJE körning — på 2-min-
// snabbfilen betyder det att computen ALDRIG får sina 5 min idle → aldrig
// scale-to-zero. Med cachen är en oförändrad körning ren HTTP. TTL 24h så en
// ändrad restockWatch-config i admin slår igenom inom ett dygn.
const SOURCES_TTL_MS = 24 * 60 * 60 * 1000;
const srcFile = fpFile ? `${fpFile}.sources.json` : null;

function readCachedSources(): RestockSourceInfo[] | null {
  if (!srcFile || !existsSync(srcFile)) return null;
  try {
    const parsed = JSON.parse(readFileSync(srcFile, "utf8")) as {
      at?: number;
      sources?: RestockSourceInfo[];
    };
    if (
      typeof parsed.at === "number" &&
      Date.now() - parsed.at < SOURCES_TTL_MS &&
      Array.isArray(parsed.sources) &&
      parsed.sources.length > 0 &&
      // Cache från före rotatingFeed-fältet (2026-07-07) saknar flaggan → hämta om.
      parsed.sources.every((s) => typeof s === "object" && s !== null && "rotatingFeed" in s)
    ) {
      return parsed.sources;
    }
  } catch (e) {
    console.warn("[restock-watch] Kunde inte läsa källcachen:", e instanceof Error ? e.message : e);
  }
  return null;
}

async function main() {
  const shouldProcess = (fetched: { sourceName: string; items: { url: string; stockStatus: any }[] }[]) => {
    if (!fpFile) return true;
    currentFp = feedFingerprint(fetched.flatMap((f) => f.items));
    try {
      if (existsSync(fpFile) && readFileSync(fpFile, "utf8").trim() === currentFp) {
        console.log("[restock-watch] Oförändrad feed — hoppar över DB-fasen (Neon sover).");
        return false;
      }
    } catch (e) {
      console.warn("[restock-watch] Kunde inte läsa fingerprint-filen:", e instanceof Error ? e.message : e);
    }
    return true;
  };

  // Snabb-fil: RESTOCK_ONLY_SOURCES=Manatörsk (komma-lista) begränsar skanningen till
  // butiker som gör snabba slutsälj-drops. Utelämnas = alla restock-watch-källor.
  const onlySources = process.env.RESTOCK_ONLY_SOURCES?.split(",").map((s) => s.trim()).filter(Boolean);
  const cachedSources = readCachedSources();
  if (cachedSources) console.log(`[restock-watch] Källista från cache (${cachedSources.length} källor) — ingen DB för uppslaget.`);
  const r = await runRestockScan({ onlySources, shouldProcess, sources: cachedSources ?? undefined });

  // Färsk källista (hämtad från DB denna körning) → cacha den för nästa körning.
  if (srcFile && !cachedSources && r.sourceList?.length) {
    try {
      mkdirSync(dirname(srcFile), { recursive: true });
      writeFileSync(srcFile, JSON.stringify({ at: Date.now(), sources: r.sourceList }));
    } catch (e) {
      console.warn("[restock-watch] Kunde inte skriva källcachen:", e instanceof Error ? e.message : e);
    }
  }

  // Skriv nytt avtryck bara när vi FAKTISKT körde DB-fasen (annars är det oförändrat).
  if (fpFile && currentFp && !r.skipped) {
    try {
      mkdirSync(dirname(fpFile), { recursive: true });
      writeFileSync(fpFile, currentFp);
    } catch (e) {
      console.warn("[restock-watch] Kunde inte skriva fingerprint-filen:", e instanceof Error ? e.message : e);
    }
  }
}

main()
  .catch((e) => { console.error("Misslyckades:", e); process.exit(1); })
  .finally(() => prisma.$disconnect());
