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
import { runRestockScan } from "../src/scrapers/runner";
import { feedFingerprint } from "../src/lib/feed-fingerprint";

const fpFile = process.env.RESTOCK_FINGERPRINT_FILE;
let currentFp: string | null = null;

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
  const r = await runRestockScan({ onlySources, shouldProcess });

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
