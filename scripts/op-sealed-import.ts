/**
 * One Piece sealed ur leverantören (src/jobs/op-sealed-import.ts).
 *
 *   railway run npx tsx scripts/op-sealed-import.ts            (torrkörning: vad skulle skapas)
 *   railway run npx tsx scripts/op-sealed-import.ts --apply    (skriver; nya produkter DOLDA)
 *
 * ⛔ Kör inte --apply förrän varje Pokémon-jobb filtrerar `game: "POKEMON"` (steg 2 i planen).
 */
import { ensureDbAwake } from "../src/lib/db";
import { exitJob } from "../src/lib/job-exit";
import { runOnePieceSealedImport } from "../src/jobs/op-sealed-import";

async function main() {
  const apply = process.argv.includes("--apply");
  await ensureDbAwake();
  const res = await runOnePieceSealedImport({ apply });
  for (const t of res.createdTitles) console.log(`  + ${t}`);
  if (res.filteredSamples.length) console.log(`\nFälld (urval):\n  - ${res.filteredSamples.join("\n  - ")}`);
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => exitJob());
