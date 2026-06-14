/**
 * Rensar bort fejkade seed-offers och ersätter med riktig data.
 *
 * Vad scriptet gör:
 *  1. Tar bort ALLA offers (seed skapade fejkade butikskopplingar)
 *  2. Tar bort PriceObservations från mock-källan
 *  3. Tar bort PriceSnapshots baserade på fejkdata
 *  4. Kör riktiga skrapningar mot alla aktiva källor
 *
 * Körs med: npx tsx scripts/cleanup-fake-offers.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("🧹 Rensar fejkad seed-data...\n");

  // 1. Ta bort alla offers (seed skapade fejkade)
  const deletedOffers = await prisma.offer.deleteMany();
  console.log(`   Raderade ${deletedOffers.count} fejkade offers`);

  // 2. Ta bort prisobservationer från mock-källan
  const mockSource = await prisma.scrapeSource.findFirst({
    where: { name: "Mock-datakälla" },
  });
  if (mockSource) {
    const deletedObs = await prisma.priceObservation.deleteMany({
      where: { sourceId: mockSource.id },
    });
    console.log(`   Raderade ${deletedObs.count} mock-prisobservationer`);

    // Inaktivera mock-källan
    await prisma.scrapeSource.update({
      where: { id: mockSource.id },
      data: { isActive: false },
    });
    console.log(`   Mock-datakälla inaktiverad`);
  }

  // 3. Ta bort alla PriceSnapshots (de baseras på fejkdata)
  const deletedSnapshots = await prisma.priceSnapshot.deleteMany();
  console.log(`   Raderade ${deletedSnapshots.count} fejkade prissnapshots`);

  // 4. Ta bort restock-händelser (fejkade)
  const deletedRestocks = await prisma.restockEvent.deleteMany();
  console.log(`   Raderade ${deletedRestocks.count} fejkade restock-händelser`);

  // 5. Ta bort scrape-jobb (gamla fejkade)
  const deletedJobs = await prisma.scrapeJob.deleteMany();
  console.log(`   Raderade ${deletedJobs.count} gamla scrape-jobb`);

  console.log("\n✅ Fejkdata rensad! Kör nu skrapningarna för riktig data:");
  console.log("   npm run dev  (auto-scrape startar efter 30s)");
  console.log("   — eller —");
  console.log("   npx tsx scripts/run-scrapers.ts  (direkt)");
}

main()
  .catch((e) => {
    console.error("Cleanup misslyckades:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
