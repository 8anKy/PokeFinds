/**
 * Frys samlingsvärdet (src/jobs/settle-collection-values.ts). Steg i
 * cardmarket-refresh.yml efter prissteget. Manuellt:
 *   node scripts/with-prod-db.mjs npx tsx scripts/settle-collection-values.ts [--dry]
 */
import { ensureDbAwake } from "../src/lib/db";
import { exitJob } from "../src/lib/job-exit";
import { settleCollectionValues } from "../src/jobs/settle-collection-values";

const dryRun = process.argv.includes("--dry");

ensureDbAwake()
  .then(() => settleCollectionValues({ dryRun }))
  .then((r) =>
    console.log(
      `[settle-values] ${r.dryRun ? "TORRKÖRNING: " : ""}${r.changed} av ${r.scanned} produkter fick nytt samlingsvärde.`
    )
  )
  .catch((e) => {
    console.error("[settle-values] misslyckades:", e);
    process.exitCode = 1;
  })
  .finally(() => void exitJob(process.exitCode === 1 ? 1 : 0));
