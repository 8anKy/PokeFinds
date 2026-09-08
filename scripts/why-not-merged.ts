/**
 * VARFÖR mergades inte stubben? En RAPPORT, inga skrivningar.
 *
 *   node scripts/with-prod-db.mjs npx tsx scripts/why-not-merged.ts
 *
 * Kedjan som hindrar en merge är INTE en vakt utan flera, och de säger nej av olika
 * skäl. Att vidga "vakten" utan att veta VILKEN som fäller vad är precis så man får
 * FELAKTIGA merges — och en felmerge är osynlig (fel pris på fel produkt), medan en
 * utebliven merge bara är en dubblett man ser. Den här rapporten räknar orsakerna så
 * att en vidgning kan riktas mot den som faktiskt kostar oss dubbletter.
 */
import { PrismaClient } from "@prisma/client";
import {
  cleanListingTitle, distinctiveOverlap, mergeEquivalent, nonEraCoverage,
  productsConflict, scoreSimilarity,
} from "../src/scrapers/matching";
import { normalizeTitle } from "../src/lib/utils";

const prisma = new PrismaClient();

async function main() {
  const sealed = await prisma.product.findMany({
    where: { category: { notIn: ["SINGLE_CARD", "GRADED_CARD"] }, hiddenAt: null },
    select: { id: true, title: true, slug: true, category: true, language: true, gtin: true,
              setId: true, createdAt: true, _count: { select: { offers: true, priceSnapshots: true } } },
  });
  const cmIds = new Set(
    (await prisma.offer.findMany({
      where: { retailer: { name: "Cardmarket" }, product: { category: { notIn: ["SINGLE_CARD", "GRADED_CARD"] } } },
      select: { productId: true },
    })).map((o) => o.productId)
  );
  const isStub = (p: (typeof sealed)[number]) => !cmIds.has(p.id) && !p.gtin && p.setId == null;
  const stubs = sealed.filter(isStub);
  console.log(`${sealed.length} sealed, ${stubs.length} med stub-signatur.\n`);

  const reasons = new Map<string, number>();
  const bump = (k: string) => reasons.set(k, (reasons.get(k) ?? 0) + 1);
  const examples: string[] = [];

  for (const s of stubs) {
    const st = normalizeTitle(cleanListingTitle(s.title));
    let best: { p: (typeof sealed)[number]; score: number } | null = null;
    for (const c of sealed) {
      if (c.id === s.id || isStub(c)) continue;
      if (c.category !== s.category) continue;
      const score = scoreSimilarity(st, normalizeTitle(c.title));
      if (!best || score > best.score) best = { p: c, score };
    }
    if (!best || best.score < 0.4) { bump("ingen kandidat i närheten (sannolikt äkta ny produkt)"); continue; }

    const ct = normalizeTitle(best.p.title);
    const why: string[] = [];
    if (productsConflict(s.title, best.p.title, best.p.language)) why.push("productsConflict");
    if (distinctiveOverlap(st, ct) < 0.5) why.push("distinctiveOverlap<0.5");
    if (nonEraCoverage(st, ct) < 0.6) why.push("nonEraCoverage<0.6");
    if (!mergeEquivalent(s.title, best.p.title)) why.push("mergeEquivalent (ordmängd skiljer)");

    const key = why.length ? why.join(" + ") : "inget hinder — borde ha mergats";
    bump(key);
    if (examples.length < 25) {
      examples.push(`   ${best.score.toFixed(2)}  "${s.title.slice(0, 46)}"\n        → "${best.p.title.slice(0, 46)}"\n        ${key}`);
    }
  }

  console.log("ORSAKER (varför stubben inte gick ihop med sin bästa kandidat):");
  for (const [k, v] of [...reasons].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(v).padStart(3)}  ${k}`);
  }
  console.log("\nEXEMPEL:\n" + examples.join("\n"));
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
