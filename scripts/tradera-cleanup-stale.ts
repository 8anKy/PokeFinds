/**
 * Engångs-städning av föråldrade/felaktiga Tradera-länkar.
 *
 * Bakgrund: tidigare logik kunde pinna fast en BILLIGARE men UTGÅNGEN annons
 * (Tradera-annonser löper ut/säljs) och bumpa lastSeenAt så expiry aldrig slog
 * till → produktsidan länkade till en död/fel annons i dagar. Den durabla fixen
 * (src/jobs/tradera-sweep.ts) skriver nu alltid körningens billigaste LEVANDE
 * annons, men befintliga rader behöver en engångskorrigering.
 *
 * Strategi (inga osäkra API-anrop): kör en FÄRSK svepning (ny logik hämtar
 * levande annonser), notera starttiden, och nollställ sedan varje Tradera-offer
 * med pris vars lastSeenAt är ÄLDRE än starten → den bekräftades inte levande
 * denna körning. Den får en sök-URL (alltid levande) istället för en död länk.
 *
 *   npx tsx scripts/tradera-cleanup-stale.ts          # mot DB i .env
 *   DRY_RUN=1 npx tsx scripts/tradera-cleanup-stale.ts # bara rapport
 *   SKIP_SWEEP=1 npx tsx scripts/tradera-cleanup-stale.ts # nollställ direkt utan svep
 */
import * as fs from "fs";
import * as path from "path";

const envPath = path.join(process.cwd(), ".env");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.+?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

import { StockStatus } from "@prisma/client";
import { prisma } from "../src/lib/db";
import { mapPool } from "../src/lib/concurrency";
import { runTraderaSweep, traderaResetSearchUrl } from "../src/jobs/tradera-sweep";

async function main(): Promise<void> {
  const dryRun = process.env.DRY_RUN === "1";
  const cutoff = new Date();

  if (process.env.SKIP_SWEEP !== "1") {
    console.log("🧹 Steg 1: Färsk Tradera-svepning (ny logik hämtar levande annonser)...\n");
    await runTraderaSweep({ dryRun });
    console.log("");
  }

  const tradera = await prisma.retailer.findFirstOrThrow({ where: { name: "Tradera" } });

  // Offers med pris som INTE bekräftades levande denna körning (lastSeenAt < start).
  const stale = await prisma.offer.findMany({
    where: { retailerId: tradera.id, price: { not: null }, lastSeenAt: { lt: cutoff } },
    select: {
      id: true,
      product: {
        select: {
          title: true, category: true,
          card: { select: { name: true, set: { select: { name: true } } } },
        },
      },
    },
  });

  console.log(`🧹 Steg 2: ${stale.length} ej-levande Tradera-länkar → sök-URL${dryRun ? " (DRY_RUN)" : ""}`);
  if (dryRun || stale.length === 0) {
    await prisma.$disconnect();
    return;
  }

  let reset = 0;
  await mapPool(stale, 8, async (offer) => {
    await prisma.offer.update({
      where: { id: offer.id },
      data: {
        price: null,
        stockStatus: StockStatus.UNKNOWN,
        url: traderaResetSearchUrl(offer.product),
      },
    });
    reset++;
  });

  console.log(`✅ ${reset} offers nollställda till levande sök-URL.`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error("Misslyckades:", e);
  process.exit(1);
});
