/**
 * ÄR TRICKELN MÄNNISKOR ELLER BOTAR? — jämför faktiska besökshändelser (AnalyticsEvent,
 * skrivs KLIENT-sida via /api/track → bara riktiga webbläsare) mot hur många
 * produktsid-renders DB:n faktiskt betalar för.
 *
 * Är renders >> events är trafiken bot-/crawler-driven, och då är rätt åtgärd
 * crawl-styrning + längre ISR — inte fler index eller snabbare frågor.
 *
 * Kör: node scripts/with-prod-db.mjs npx tsx scripts/neon-traffic-shape.ts
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function main() {
  const perHour = await db.$queryRawUnsafe<any[]>(`
    select date_trunc('hour', "createdAt") as hour,
           count(*)::float8 as n,
           count(distinct "entityId")::float8 as slugs
    from "AnalyticsEvent"
    where "createdAt" > now() - interval '48 hours'
    group by 1 order by 1 desc limit 48`);

  console.log("=== AnalyticsEvent (RIKTIGA webbläsare) per timme, senaste 48h ===");
  let total = 0;
  for (const r of perHour) {
    total += r.n;
    console.log(`  ${new Date(r.hour).toISOString().slice(0, 16)}  ${String(r.n).padStart(5)} händelser  ${String(r.slugs).padStart(4)} unika slugs  ${"▄".repeat(Math.min(60, Math.round(r.n / 5)))}`);
  }
  console.log(`\n  Totalt 48h: ${total} händelser  (≈ ${Math.round(total / 48)}/h, ${(total / 48 / 60).toFixed(1)}/min)`);

  const byType = await db.$queryRawUnsafe<any[]>(`
    select "eventType"::text as type, count(*)::float8 as n from "AnalyticsEvent"
    where "createdAt" > now() - interval '48 hours' group by 1 order by 2 desc`);
  console.log("\n  Per typ:");
  for (const r of byType) console.log(`    ${String(r.n).padStart(6)} × ${r.type}`);

  console.log("\n=== JÄMFÖRELSE ===");
  console.log(`  Riktiga webbläsare genererar ${(total / 48 / 60).toFixed(2)} händelser/min.`);
  console.log(`  Kör scripts/neon-trickle-delta.ts för hur många renders DB:n samtidigt betalar för.`);
  console.log(`  Är renders >> händelser är lasten bot-/jobb-driven, inte användardriven.`);
}

main()
  .catch((e) => {
    console.error(String(e).slice(0, 400));
    process.exit(1);
  })
  .finally(() => db.$disconnect());
