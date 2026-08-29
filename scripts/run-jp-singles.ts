/**
 * Kör importen/prisuppdateringen av JAPANSKA SINGLAR (samma kod som dagliga
 * 13:00-jobbet kör via runCardmarketRefresh).
 *
 *   node scripts/with-prod-db.mjs npx tsx scripts/run-jp-singles.ts            # allt (~280 anrop)
 *   MAX_PAGES=3 node scripts/with-prod-db.mjs npx tsx scripts/run-jp-singles.ts  # provkörning
 *
 * ⛔ load-env FÖRST: with-prod-db skickar bara DATABASE_URL; nyckeln läses ur .env.
 */
import "./load-env";
import { requireEnv } from "./load-env";

requireEnv("CARDMARKET_RAPIDAPI_KEY");

async function main() {
  const { ensureDbAwake, prisma } = await import("../src/lib/db");
  const { runJapaneseSinglesRefresh } = await import("../src/jobs/jp-singles-refresh");
  await ensureDbAwake();
  const maxPages = Number(process.env.MAX_PAGES) || undefined;
  const res = await runJapaneseSinglesRefresh({ maxPages });
  console.log(JSON.stringify(res, null, 2));
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
