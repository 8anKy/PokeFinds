/**
 * Kör EN butikskälla nu, mot samma kärna som nattkedjan (`runScrapeJob`).
 *
 *   node scripts/with-prod-db.mjs npx tsx scripts/run-one-source.ts "Cardshop Sweden"
 *
 * ⛔ RESTOCK_ALERTS_PAUSED sätts till "1" här, precis som i `scrape-all.yml`.
 *    Nattkedjans offer-diff får ALDRIG skapa larm — larmen går via Discord-lanens
 *    hits sedan 2026-09-06, och en manuell körning som skriver dem här hade dubblerat
 *    dem (eller, på en ny butik, larmat om hela sortimentet på en gång).
 */
import { prisma, ensureDbAwake } from "../src/lib/db";
import { runScrapeJob } from "../src/scrapers/runner";

process.env.RESTOCK_ALERTS_PAUSED = "1";

async function main() {
  const name = process.argv[2];
  if (!name) throw new Error('Ange källans namn, t.ex. "Cardshop Sweden".');

  await ensureDbAwake();
  const source = await prisma.scrapeSource.findFirst({ where: { name } });
  if (!source) throw new Error(`Hittade ingen ScrapeSource med namnet "${name}".`);

  console.log(`Kör "${source.name}" (${source.type}) …`);
  const t0 = Date.now();
  const summary = await runScrapeJob(source.id);
  console.log(
    `klart på ${Math.round((Date.now() - t0) / 1000)}s — status=${summary.status} ` +
      `hittade=${summary.itemsFound} uppdaterade=${summary.itemsUpdated} fel=${summary.errorCount}`
  );

  const job = await prisma.scrapeJob.findUnique({ where: { id: summary.jobId } });
  for (const line of ((job?.logs as string[] | null) ?? []).slice(-40)) console.log(`  ${line}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
