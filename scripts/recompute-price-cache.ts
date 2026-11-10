/**
 * Räknar om det denormaliserade lägstapriset (`Product.lowestPriceOre`) NU, utan att vänta på
 * nattens cardmarket-refresh. Katalogen döljer produkter utan lägstapris — behövs när produkter
 * skapats/avdolts efter nattens körning (One Piece-lanseringen 2026-11-10).
 *
 *   railway run npx tsx scripts/recompute-price-cache.ts
 *
 * Samma funktion som nattkedjan anropar; skriver bara lowestPriceOre, rör inga offers/larm.
 */
import { ensureDbAwake } from "../src/lib/db";
import { exitJob } from "../src/lib/job-exit";
import { recomputeProductPriceCache } from "../src/services/products";

async function main() {
  await ensureDbAwake();
  const t = Date.now();
  await recomputeProductPriceCache();
  console.log(`Lägstapriser omräknade på ${((Date.now() - t) / 1000).toFixed(1)} s.`);
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => exitJob());
