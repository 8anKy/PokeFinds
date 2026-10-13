/**
 * CLI-wrapper för veckopushen om samlingen (steg i scrape-all.yml — jobbet avgör
 * själv om det är rätt veckodag — eller manuellt).
 *
 *   npx tsx scripts/portfolio-push-run.ts                         # bara på rätt veckodag
 *   npx tsx scripts/portfolio-push-run.ts --dry-run --force       # räkna allt, skicka inget
 *   npx tsx scripts/portfolio-push-run.ts --force --user=<id>     # EN skarp provnotis
 *
 * Se src/jobs/portfolio-push.ts.
 */
import { exitJob } from "../src/lib/job-exit";
import { runPortfolioPush } from "../src/jobs/portfolio-push";

const force = process.argv.includes("--force");
const dryRun = process.argv.includes("--dry-run");
const onlyUserId = process.argv.find((a) => a.startsWith("--user="))?.slice("--user=".length);

runPortfolioPush(new Date(), { force, dryRun, onlyUserId })
  .catch((e) => {
    console.error("[portfolio-push] misslyckades:", e);
    process.exitCode = 1;
  })
  .finally(() => void exitJob(process.exitCode === 1 ? 1 : 0));
