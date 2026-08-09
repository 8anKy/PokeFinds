/**
 * Kör runJapaneseSealedRefresh från CLI (samma kod som dagliga 13:00-jobbet).
 * ⛔ load-env FÖRST: judgeSameProduct felar TYST utan ANTHROPIC_API_KEY —
 * auto-mappningen kräver då nära-exakt namn (≥0.9) och nya JP-SKU:er förblir olänkade.
 *
 * Kör:  node scripts/with-prod-db.mjs npx tsx scripts/run-jp-refresh.ts
 */
import "./load-env";
import { requireEnv } from "./load-env";

requireEnv("ANTHROPIC_API_KEY");

async function main() {
  const { runJapaneseSealedRefresh } = await import("../src/jobs/cardmarket-refresh");
  const res = await runJapaneseSealedRefresh();
  console.log(JSON.stringify(res, null, 2));
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
