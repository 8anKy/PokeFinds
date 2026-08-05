/**
 * BACKFILL: koppla BEFINTLIGA graderingar till sitt katalogkort, så historiken får
 * en bild även för jobb som kördes innan kopplingen fanns (2026-08-05).
 *
 * Samma dom som graderingen nu gör själv (`resolveGradedCard`): identiteten måste
 * styrkas av samlarnumret. Ett jobb utan nummer i `result.cardName`, eller med ett
 * tvetydigt nummer, lämnas orört — ingen bild är rätt svar då.
 *
 * ⛔ RÖR ALDRIG NÅGOT ANNAT I `result`. Delpoäng, motivering och modellnamn är
 *    utfallet av en gradering som redan skett; det här skriptet lägger bara till
 *    kortkopplingen. Objektet läses in, tre fält läggs på, resten skrivs tillbaka
 *    oförändrat.
 *
 *   node scripts/with-prod-db.mjs npx tsx scripts/backfill-grading-card-links.ts
 *   node scripts/with-prod-db.mjs npx tsx scripts/backfill-grading-card-links.ts --apply
 */
import { prisma } from "../src/lib/db";
import { resolveGradedCard } from "../src/services/grading/card-link";
import type { Prisma } from "@prisma/client";

const APPLY = process.argv.includes("--apply");

async function main() {
  const jobs = await prisma.gradingJob.findMany({
    where: { status: "COMPLETED" },
    orderBy: { createdAt: "desc" },
    select: { id: true, result: true, createdAt: true },
  });
  console.log(`Färdiga graderingar: ${jobs.length}`);

  let linked = 0, already = 0, unresolved = 0;
  for (const job of jobs) {
    const result = (job.result ?? {}) as Record<string, unknown>;
    if (result.cardId) { already++; continue; }
    const cardName = typeof result.cardName === "string" ? result.cardName : null;
    const card = await resolveGradedCard(cardName);
    if (!card) {
      unresolved++;
      console.log(`  –  ${job.createdAt.toISOString().slice(0, 10)}  "${cardName ?? "(inget kortnamn)"}" → ingen styrkt identitet`);
      continue;
    }
    linked++;
    console.log(
      `  ✓  ${job.createdAt.toISOString().slice(0, 10)}  "${cardName}" → ${card.name} · ${card.setName} ${card.number}` +
      `${card.imageUrl ? "" : "  (kortet saknar bild)"}`
    );
    if (APPLY)
      await prisma.gradingJob.update({
        where: { id: job.id },
        data: {
          result: {
            ...result,
            cardId: card.cardId,
            cardImageUrl: card.imageUrl,
            cardSlug: card.slug,
            cardLabel: `${card.name} · ${card.setName} ${card.number}`,
          } as unknown as Prisma.InputJsonObject,
        },
      });
  }

  console.log(`\nKopplade: ${linked} · redan kopplade: ${already} · utan styrkt identitet: ${unresolved}`);
  if (!APPLY) console.log("TORRKÖRNING — inget skrivet. Kör om med --apply.");
}

main()
  .catch((e) => {
    console.error("FEL:", (e as Error).message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
