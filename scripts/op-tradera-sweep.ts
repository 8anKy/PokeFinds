/**
 * One Piece på Tradera (src/jobs/op-tradera-sweep.ts). Torrkörning utan --apply.
 * Körs som steg i tradera-sweep.yml (Neon är redan vaken där).
 */
import "./load-env";
import { ensureDbAwake } from "../src/lib/db";
import { exitJob } from "../src/lib/job-exit";
import { recomputeProductPriceCache } from "../src/services/products";
import { runOnePieceTraderaSweep } from "../src/jobs/op-tradera-sweep";

async function main() {
  const apply = process.argv.includes("--apply") || process.env.OP_TRADERA_APPLY === "1";
  await ensureDbAwake();
  const res = await runOnePieceTraderaSweep({ apply });
  if (apply && (res.written > 0 || res.retired > 0)) await recomputeProductPriceCache();
}
main().then(() => exitJob(0)).catch((e) => { console.error(e); return exitJob(1); });
