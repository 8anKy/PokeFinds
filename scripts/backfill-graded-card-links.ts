/**
 * Kopplar ÄLDRE graderingar till katalogkortet (2026-10-01) — efter tie-breaken i
 * services/grading/card-link.ts (Classic Collection-nytryck, "GX" ≠ "G"). Rör bara
 * jobb som SAKNAR kortbild, och lägger bara till kortfälten. Samma koppling görs
 * också när användaren öppnar graderingen (/api/grading/jobs/[id]/worth); det här
 * skriptet ger listraderna sina bilder direkt.
 *
 *   node scripts/with-prod-db.mjs npx tsx scripts/backfill-graded-card-links.ts          # torrkörning
 *   node scripts/with-prod-db.mjs npx tsx scripts/backfill-graded-card-links.ts --apply
 */
import "dotenv/config";
import type { Prisma } from "@prisma/client";
import { prisma } from "../src/lib/db";
import { resolveGradedCard } from "../src/services/grading/card-link";

async function main() {
  const apply = process.argv.includes("--apply");
  const jobs = await prisma.gradingJob.findMany({
    where: { status: "COMPLETED" },
    select: { id: true, result: true },
  });
  let linked = 0;
  let missing = 0;
  for (const j of jobs) {
    const r = (j.result ?? {}) as Record<string, unknown>;
    if (r.cardImageUrl) continue;
    const name = typeof r.cardName === "string" ? r.cardName : null;
    const hit = await resolveGradedCard(name).catch(() => null);
    if (!hit) {
      missing++;
      console.log("  –", name);
      continue;
    }
    linked++;
    console.log("  ✓", name, "→", `${hit.name} · ${hit.setName} ${hit.number}`);
    if (apply) {
      await prisma.gradingJob.update({
        where: { id: j.id },
        data: {
          result: {
            ...r,
            cardId: hit.cardId,
            cardImageUrl: hit.imageUrl,
            cardSlug: hit.slug,
            cardLabel: `${hit.name} · ${hit.setName} ${hit.number}`,
            cardSetName: hit.setName,
          } as unknown as Prisma.InputJsonObject,
        },
      });
    }
  }
  console.log(`${apply ? "Kopplade" : "Skulle koppla"} ${linked}, fortfarande okända ${missing}.`);
}

main().finally(() => prisma.$disconnect());
