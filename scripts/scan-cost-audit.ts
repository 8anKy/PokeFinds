// Tillfällig: hur många skanningar gjordes i dag, och hur många nådde Haiku?
// (provider "bild" = vision hoppades över = $0). Läser bara.
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const since = new Date("2026-07-31T00:00:00Z");
  const jobs = await prisma.scannerJob.findMany({
    where: { createdAt: { gte: since } },
    orderBy: { createdAt: "asc" },
    select: { createdAt: true, status: true, result: true },
  });
  let vision = 0;
  let skipped = 0;
  let noDiag = 0;
  const byHour = new Map<string, number>();
  for (const j of jobs) {
    const d = j.result as { provider?: string } | null;
    if (!d || typeof d !== "object" || !("provider" in d)) {
      noDiag++;
      continue;
    }
    if (d.provider === "bild") skipped++;
    else vision++;
    const h = j.createdAt.toISOString().slice(11, 13);
    byHour.set(h, (byHour.get(h) ?? 0) + 1);
  }
  console.log(`ScannerJob-rader i dag (UTC): ${jobs.length}`);
  console.log(`  vision-anrop (Haiku):   ${vision}`);
  console.log(`  hoppade ("bild", $0):   ${skipped}`);
  console.log(`  utan diagnostik:        ${noDiag} (icke-admin eller äldre format)`);
  console.log(`per timme: ${[...byHour.entries()].map(([h, n]) => `${h}:00=${n}`).join("  ")}`);
}

main().finally(() => prisma.$disconnect());
