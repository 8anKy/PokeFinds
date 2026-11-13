/**
 * One Piece: fyll Cardmarket-serien i produktgrafen ur de dagliga snapshots som redan finns.
 *
 * One Piece-jobben skrev 2026-11-10 → 11-13 bara `PriceSnapshot`, men grafen ritas ur
 * `PriceObservation` per källa ⇒ "Ingen prishistorik ännu". Snapshoten ÄR det CM-pris jobbet
 * publicerade den dagen, så punkten är äkta — inget hittas på.
 * ⛔ Sealed med butiksoffers hoppas över: där kan butiksskrapningen ha skrivit om dagens snapshot.
 * Idempotent (en dag som redan har en Cardmarket-punkt rörs inte). Torrkörning utan --apply.
 *
 *   node scripts/with-prod-db.mjs npx tsx scripts/backfill-op-cm-history.ts [--apply]
 */
import { prisma, ensureDbAwake } from "../src/lib/db";
import { exitJob } from "../src/lib/job-exit";

async function main() {
  const apply = process.argv.includes("--apply");
  await ensureDbAwake();
  const source = await prisma.scrapeSource.findFirst({ where: { name: "Cardmarket" }, select: { id: true } });
  if (!source) throw new Error("Källan Cardmarket saknas.");
  const rows = await prisma.$queryRawUnsafe<{ productId: string; date: Date; price: number; single: boolean }[]>(
    `SELECT ps."productId", ps.date, ps."avgPrice" AS price, p.category = 'SINGLE_CARD' AS single
     FROM "PriceSnapshot" ps
     JOIN "Product" p ON p.id = ps."productId"
     WHERE p.game = 'ONE_PIECE' AND ps."avgPrice" > 0
       AND EXISTS (SELECT 1 FROM "Offer" o JOIN "Retailer" r ON r.id = o."retailerId"
                   WHERE o."productId" = p.id AND r.name = 'Cardmarket' AND o.price IS NOT NULL)
       AND (p.category = 'SINGLE_CARD' OR NOT EXISTS (
             SELECT 1 FROM "Offer" o JOIN "Retailer" r ON r.id = o."retailerId"
             WHERE o."productId" = p.id AND r.name <> 'Cardmarket'))
       AND NOT EXISTS (SELECT 1 FROM "PriceObservation" po
                       WHERE po."productId" = p.id AND po."sourceId" = $1
                         AND po."observedAt" >= ps.date AND po."observedAt" < ps.date + interval '1 day')
     ORDER BY ps.date`,
    source.id
  );
  const perDay = new Map<string, number>();
  for (const r of rows) {
    const k = `${r.date.toISOString().slice(0, 10)} ${r.single ? "singlar" : "sealed"}`;
    perDay.set(k, (perDay.get(k) ?? 0) + 1);
  }
  console.log(`[op-history] ${rows.length} punkter ${apply ? "skrivs" : "SKULLE skrivas"}:`);
  for (const [k, n] of perDay) console.log(`  ${k}: ${n}`);
  if (apply) {
    for (let i = 0; i < rows.length; i += 5000) {
      await prisma.priceObservation.createMany({
        data: rows.slice(i, i + 5000).map((r) => ({
          productId: r.productId,
          sourceId: source.id,
          price: r.price,
          currency: "SEK",
          condition: r.single ? ("NEAR_MINT" as const) : ("SEALED" as const),
          // 02:00 UTC = ungefär när nattjobbet skrev snapshoten.
          observedAt: new Date(r.date.getTime() + 2 * 3600_000),
          rawData: { backfill: "op-snapshot-2026-11-13" },
        })),
      });
    }
  }
}

main().then(() => exitJob(0)).catch((e) => { console.error(e); return exitJob(1); });
