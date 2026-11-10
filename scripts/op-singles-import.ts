/**
 * One Piece-singlar ur leverantören (src/jobs/op-singles-import.ts). Körs nattligen i cardmarket-refresh.
 *
 *   railway run npx tsx scripts/op-singles-import.ts            (torrkörning)
 *   railway run npx tsx scripts/op-singles-import.ts --apply    (skriver kort, produkter, offers)
 *
 * Efteråt: `scripts/recompute-price-cache.ts` så katalogen visar dem direkt (annars i natt).
 */
import { ensureDbAwake } from "../src/lib/db";
import { exitJob } from "../src/lib/job-exit";
import { runOnePieceSinglesImport } from "../src/jobs/op-singles-import";

async function main() {
  const apply = process.argv.includes("--apply");
  await ensureDbAwake();
  const res = await runOnePieceSinglesImport({ apply });
  if (res.samples.length) console.log(`\nUrval:\n  + ${res.samples.join("\n  + ")}`);
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => exitJob());
