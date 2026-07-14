/**
 * CLI-wrapper för den frekventa restock-bevakningen (GitHub Actions var 10:e min).
 *
 * Ändringsgrind: fs/crypto bor HÄR (ett fristående tsx-script som Next INTE buntar),
 * inte i runner.ts/restock.ts (de dras in i Next-bundlen via instrumentation → node-
 * builtins går inte att bunta där). Vi hämtar feeden och kör BARA DB-fasen om något
 * flippat → Neon sover på oförändrade körningar.
 *
 * TVÅ GRINDAR:
 *  - RESTOCK_STATE_FILE satt → LAGERDIFF-grinden (src/lib/feed-state-diff.ts). Väcker
 *    Neon bara på riktiga lagerflippar, inte på roterande butikers URL-churn. Se den
 *    filen. Används av 10-min-lanen (11 butiker, 2 roterande).
 *  - Annars → FINGERAVTRYCKS-grinden (src/lib/feed-fingerprint.ts). Oförändrad. Används
 *    av Manatörsk-snabbfilen (1 icke-roterande butik — avtrycket matchar fint där).
 *
 * SKUGGLÄGE (RESTOCK_GATE_SHADOW≠0, default PÅ för lagerdiff-grinden): grinden KÖR ändå
 * alltid DB-fasen, men LOGGAR vad den SKULLE beslutat och jämför mot vad DB-fasen
 * faktiskt hittade. En rad `[SHADOW-MISMATCH]` = grinden hade missat en restock → fixa
 * innan skarp. Noll mismatch under ett dygn → sätt RESTOCK_GATE_SHADOW=0 → grinden
 * hoppar på riktigt och computen sjunker. Samma "torrkör-först"-disciplin som prisstädet.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { prisma } from "../src/lib/db";
import { runRestockScan, type RestockSourceInfo } from "../src/scrapers/runner";
import { feedFingerprint } from "../src/lib/feed-fingerprint";
import {
  actionableChanges,
  buildStateMap,
  type FeedGroup,
  type FeedStateMap,
} from "../src/lib/feed-state-diff";

const fpFile = process.env.RESTOCK_FINGERPRINT_FILE;
const stateFile = process.env.RESTOCK_STATE_FILE;
// Skugga tills verifierad. Sätt RESTOCK_GATE_SHADOW=0 för att låta grinden hoppa skarpt.
const SHADOW = process.env.RESTOCK_GATE_SHADOW !== "0";

let currentFp: string | null = null;
let currentState: FeedStateMap | null = null;
let gateWouldSkip = false; // senaste lagerdiff-beslutet (för skuggjämförelsen efter skanningen)

// Källistan cachas på disk bredvid grind-filen (samma actions/cache-katalog).
// Utan detta väckte redan källist-uppslaget Neon på VARJE körning → aldrig scale-to-zero.
// TTL 24h så en ändrad restockWatch-config i admin slår igenom inom ett dygn.
const SOURCES_TTL_MS = 24 * 60 * 60 * 1000;
const gateFile = stateFile ?? fpFile;
const srcFile = gateFile ? `${gateFile}.sources.json` : null;

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
      parsed.sources.every((s) => typeof s === "object" && s !== null && "rotatingFeed" in s)
    ) {
      return parsed.sources;
    }
  } catch (e) {
    console.warn("[restock-watch] Kunde inte läsa källcachen:", e instanceof Error ? e.message : e);
  }
  return null;
}

function readStateMap(): FeedStateMap | null {
  if (!stateFile || !existsSync(stateFile)) return null;
  try {
    return JSON.parse(readFileSync(stateFile, "utf8")) as FeedStateMap;
  } catch (e) {
    console.warn("[restock-watch] Kunde inte läsa state-filen:", e instanceof Error ? e.message : e);
    return null;
  }
}

async function main() {
  const cachedSources = readCachedSources();
  const rotating = new Set(
    (cachedSources ?? []).filter((s) => s.rotatingFeed).map((s) => s.name),
  );

  // ── LAGERDIFF-grinden ──────────────────────────────────────────────────────
  const stateGate = (groups: FeedGroup[]): boolean => {
    currentState = buildStateMap(groups);
    const prev = readStateMap();
    if (!prev) {
      console.log("[restock-watch] Ingen tidigare state — kör DB-fasen och seedar.");
      gateWouldSkip = false;
      return true;
    }
    const changes = actionableChanges(prev, groups, rotating);
    gateWouldSkip = changes.length === 0;
    const summary = changes.length
      ? changes.slice(0, 5).map((c) => `${c.reason}(${c.key.replace("\t", " ")})`).join(", ") +
        (changes.length > 5 ? ` +${changes.length - 5}` : "")
      : "inga";
    if (SHADOW) {
      console.log(`[restock-watch][SHADOW] Grinden skulle ${gateWouldSkip ? "HOPPA" : "KÖRA"} — lagerflippar: ${summary}. (kör ändå, jämför efteråt)`);
      return true;
    }
    if (gateWouldSkip) {
      console.log("[restock-watch] Inga lagerflippar — hoppar DB-fasen (Neon sover).");
      return false;
    }
    console.log(`[restock-watch] ${changes.length} lagerflipp(ar) → kör DB-fasen: ${summary}`);
    return true;
  };

  // ── FINGERAVTRYCKS-grinden (oförändrad — Manatörsk-lanen) ──────────────────
  const fingerprintGate = (groups: FeedGroup[]): boolean => {
    if (!fpFile) return true;
    currentFp = feedFingerprint(groups.flatMap((f) => f.items));
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

  const shouldProcess = stateFile ? stateGate : fingerprintGate;

  const onlySources = process.env.RESTOCK_ONLY_SOURCES?.split(",").map((s) => s.trim()).filter(Boolean);
  if (cachedSources) console.log(`[restock-watch] Källista från cache (${cachedSources.length} källor) — ingen DB för uppslaget.`);
  const r = await runRestockScan({ onlySources, shouldProcess, sources: cachedSources ?? undefined });

  // SKUGGJÄMFÖRELSE: sa grinden HOPPA men DB-fasen fann faktiskt något? Då hade den missat.
  if (stateFile && SHADOW && gateWouldSkip && (r.restocks > 0 || r.newListings > 0)) {
    console.error(
      `[restock-watch][SHADOW-MISMATCH] Grinden ville HOPPA men DB-fasen fann ${r.restocks} restock(s) + ${r.newListings} nya. ` +
      `Skarp grind hade MISSAT dessa — undersök innan RESTOCK_GATE_SHADOW=0.`,
    );
  } else if (stateFile && SHADOW && gateWouldSkip) {
    console.log("[restock-watch][SHADOW] OK — grinden ville hoppa och DB-fasen fann inget (0 restocks, 0 nya). Skip hade varit säkert.");
  }

  // Färsk källista (hämtad från DB denna körning) → cacha för nästa körning.
  if (srcFile && !cachedSources && r.sourceList?.length) {
    try {
      mkdirSync(dirname(srcFile), { recursive: true });
      writeFileSync(srcFile, JSON.stringify({ at: Date.now(), sources: r.sourceList }));
    } catch (e) {
      console.warn("[restock-watch] Kunde inte skriva källcachen:", e instanceof Error ? e.message : e);
    }
  }

  // LAGERDIFF: skriv state VARJE körning (även skip) så prev alltid = senaste feed.
  // Skip sker bara vid ren rotation/prisbrus → lagerläget är oförändrat → ofarligt.
  if (stateFile && currentState) {
    try {
      mkdirSync(dirname(stateFile), { recursive: true });
      writeFileSync(stateFile, JSON.stringify(currentState));
    } catch (e) {
      console.warn("[restock-watch] Kunde inte skriva state-filen:", e instanceof Error ? e.message : e);
    }
  }

  // FINGERAVTRYCK: skriv bara när DB-fasen FAKTISKT kördes (annars oförändrat).
  if (fpFile && !stateFile && currentFp && !r.skipped) {
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
