/**
 * CLI-wrapper för den frekventa restock-pollen (var 30:e min i GitHub Actions).
 * Kärnlogik i src/jobs/restock-poll.ts. Env (DATABASE_URL, RESEND_API_KEY) från process.env.
 *   npx tsx scripts/restock-poll-run.ts
 */
import { prisma } from "../src/lib/db";
import { runRestockPoll } from "../src/jobs/restock-poll";

runRestockPoll()
  .then((r) =>
    console.log(
      `Klart: ${r.candidates} kandidater, ${r.checked} probeade, ${r.restocked} restocks, ${r.alertsSent} alerts.`
    )
  )
  .catch((e) => {
    console.error("Misslyckades:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
