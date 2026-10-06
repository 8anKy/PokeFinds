/**
 * STÄDAR GRADERADE RADER SOM ALDRIG VAR GRADERADE (2026-10-06).
 *
 * Skrivvägarna fick två nya vakter samma dag (`src/lib/graded-listing.ts`):
 *  - `isAspirationalGradeTitle` — "PSA 10 Contender", "PSA 10 potential",
 *    "PSA 10-utmanare", "PSA 10?" … är råa kort.
 *  - `gradedTooSoonAfterRelease` — en affär/annons inom 21 dygn från setets släpp
 *    kan inte vara en slab (30th Celebration: 23 "PSA 10"-affärer inom 16 dygn).
 * Plus eBay-raderna med `soldAt` 1970 (saknat slutdatum).
 *
 * Det här skriptet tar bort det som redan hann skrivas. Raderna är härledd data
 * (svepen hämtar dem igen om de var äkta), så en radering är säker.
 *
 *   node scripts/with-prod-db.mjs npx tsx scripts/purge-implausible-graded.ts           # torrt
 *   node scripts/with-prod-db.mjs npx tsx scripts/purge-implausible-graded.ts --apply   # skriver
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { gradedTooSoonAfterRelease, isAspirationalGradeTitle } from "../src/lib/graded-listing";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");
const EPOCH_CUTOFF = new Date("2000-01-01T00:00:00Z");

type Row = { id: string; title: string; at: Date; rel: Date | null; source: string; slug: string };

function verdict(r: Row): string | null {
  if (r.at < EPOCH_CUTOFF) return "datum 1970";
  if (isAspirationalGradeTitle(r.title)) return "förhoppning i titeln";
  if (gradedTooSoonAfterRelease(r.rel, r.at)) return "före graderingsfönstret";
  return null;
}

async function main() {
  const sales = await prisma.$queryRaw<Row[]>`
    SELECT g.id, g.title, g."soldAt" AS at, COALESCE(s."releaseDate", p."releaseDate") AS rel, g.source, p.slug
    FROM "GradedSale" g JOIN "Product" p ON p.id = g."productId" LEFT JOIN "CardSet" s ON s.id = p."setId"`;
  const asks = await prisma.$queryRaw<Row[]>`
    SELECT g.id, g.title, g."observedAt" AS at, COALESCE(s."releaseDate", p."releaseDate") AS rel, g.source, p.slug
    FROM "GradedAsk" g JOIN "Product" p ON p.id = g."productId" LEFT JOIN "CardSet" s ON s.id = p."setId"`;
  const snaps = await prisma.$queryRaw<{ id: string; date: Date; rel: Date | null; slug: string }[]>`
    SELECT g.id, g.date, COALESCE(s."releaseDate", p."releaseDate") AS rel, p.slug
    FROM "GradedAskSnapshot" g JOIN "Product" p ON p.id = g."productId" LEFT JOIN "CardSet" s ON s.id = p."setId"`;

  const badSales = sales.flatMap((r) => (verdict(r) ? [{ ...r, why: verdict(r)! }] : []));
  const badAsks = asks.flatMap((r) => (verdict(r) ? [{ ...r, why: verdict(r)! }] : []));
  const badSnaps = snaps.filter((r) => gradedTooSoonAfterRelease(r.rel, r.date));

  const tally = (rows: { source: string; why: string }[]) => {
    const t: Record<string, number> = {};
    for (const r of rows) t[`${r.source} · ${r.why}`] = (t[`${r.source} · ${r.why}`] ?? 0) + 1;
    return t;
  };
  console.log(`GradedSale: ${badSales.length} av ${sales.length}`, tally(badSales));
  for (const r of badSales.slice(0, 60)) console.log(`  ${r.why.padEnd(24)} ${r.source.padEnd(7)} ${r.slug}  ${r.title.slice(0, 80)}`);
  console.log(`GradedAsk: ${badAsks.length} av ${asks.length}`, tally(badAsks));
  for (const r of badAsks.slice(0, 20)) console.log(`  ${r.why.padEnd(24)} ${r.slug}  ${r.title.slice(0, 80)}`);
  console.log(`GradedAskSnapshot: ${badSnaps.length} av ${snaps.length}`);

  if (!APPLY) {
    console.log("\nTorrkörning — kör med --apply för att radera.");
    return;
  }
  const chunk = <T,>(a: T[], n: number) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));
  let n = 0;
  for (const ids of chunk(badSales.map((r) => r.id), 1000)) n += (await prisma.gradedSale.deleteMany({ where: { id: { in: ids } } })).count;
  let m = 0;
  for (const ids of chunk(badAsks.map((r) => r.id), 1000)) m += (await prisma.gradedAsk.deleteMany({ where: { id: { in: ids } } })).count;
  let k = 0;
  for (const ids of chunk(badSnaps.map((r) => r.id), 1000)) k += (await prisma.gradedAskSnapshot.deleteMany({ where: { id: { in: ids } } })).count;
  console.log(`Raderade: ${n} affärer, ${m} begärda, ${k} ögonblicksbilder.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
