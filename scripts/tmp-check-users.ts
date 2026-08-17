import { PrismaClient } from "@prisma/client";

async function main() {
  const p = new PrismaClient();
  const n = await p.user.count();
  const rows = await p.user.findMany({
    select: { email: true, name: true, role: true, planTier: true, lastSeenAt: true },
    take: 10,
  });
  console.log("users:", n);
  console.table(rows);
  const scans = await p.scannerJob.count();
  const grades = await p.gradingJob.count();
  console.log("scannerJobs:", scans, "gradingJobs:", grades);
  await p.$disconnect();
}

main();
