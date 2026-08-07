/**
 * Varför blev DEN HÄR annonsen en ny produkt i stället för en länk?
 *
 * Skriver ut hela kedjan för en annonstitel: rensad titel, matcharens bästa kandidat
 * och poäng, vilken vakt som eventuellt sa nej, och vad LLM-domaren svarade. Utan det
 * går "matcharen missade" inte att skilja från "vakten hade rätt" — och bara den ena
 * av dem är ett fel.
 *
 *   node scripts/with-prod-db.mjs npx tsx scripts/diagnose-listing-match.ts "Titeln här"
 */
import { prisma } from "../src/lib/db";
import {
  cleanListingTitle,
  matchProduct,
  loadMatchIndex,
  identicalIdentity,
  productsConflict,
  scoreSimilarity,
  distinctiveOverlap,
  setMatchTracer,
  type MatchTrace,
} from "../src/scrapers/matching";
import { normalizeTitle } from "../src/lib/utils";
import { judgeSameProduct } from "../src/lib/same-product";

async function main() {
  const titles = process.argv.slice(2).filter((a) => !a.startsWith("-"));
  if (!titles.length) {
    console.error('Ange minst en annonstitel: … diagnose-listing-match.ts "Titel"');
    process.exit(1);
  }
  // --utan-nya=<timmar>: uteslut nyss skapade produkter ur indexet.
  // Utan det diagnosticerar man EFTER importen och får 1.000 mot stubben man just
  // skapade — dvs frågan "varför blev det en stub?" besvaras med stubben själv.
  const hours = Number(process.argv.find((a) => a.startsWith("--utan-nya="))?.split("=")[1] ?? 0);
  let index = await loadMatchIndex();
  if (hours > 0) {
    const recent = new Set(
      (
        await prisma.product.findMany({
          where: { createdAt: { gte: new Date(Date.now() - hours * 3600 * 1000) } },
          select: { id: true },
        })
      ).map((r) => r.id)
    );
    index = index.filter((p) => !recent.has(p.id));
    console.log(`(uteslöt ${recent.size} produkter skapade senaste ${hours} h)`);
  }

  for (const rawTitle of titles) {
    const clean = cleanListingTitle(rawTitle);
    const normalized = normalizeTitle(clean);
    console.log(`\n${"=".repeat(78)}\nANNONS: ${rawTitle}`);
    if (clean !== rawTitle) console.log(`RENSAD: ${clean}`);
    console.log(`NORMAL: ${normalized}`);

    let trace: MatchTrace | null = null;
    setMatchTracer((t) => {
      trace = t;
    });
    const match = await matchProduct(normalized, index, rawTitle);
    setMatchTracer(null);
    const tr = trace as MatchTrace | null;
    if (tr) {
      console.log(`\n  SPÅR: utfall=${tr.outcome}  pool=${tr.poolSize}  överlevare=${tr.survivors.length}`);
      const top = [...tr.survivors].sort((a, b) => b.score - a.score).slice(0, 5);
      for (const s of top) console.log(`    ${s.score.toFixed(3)}  ${s.normalizedTitle}`);
      if (tr.outcome === "tvetydig") {
        console.log(
          `    ⚠ tvetydig: ${tr.best?.score.toFixed(3)} "${tr.best?.normalizedTitle}" mot ${tr.runnerUp?.score.toFixed(3)} "${tr.runnerUp?.normalizedTitle}"`
        );
      }
    }
    if (!match) {
      console.log(`\n  matchProduct: INGEN kandidat (under golvet 0.55 eller stoppad av vakt)`);
    } else {
      const cand = await prisma.product.findUnique({
        where: { id: match.productId },
        select: { title: true, normalizedTitle: true, category: true },
      });
      console.log(`\n  matchProduct: ${match.confidence.toFixed(3)} → "${cand?.title}" [${cand?.category}]`);
      if (cand) {
        console.log(`    identicalIdentity : ${identicalIdentity(normalized, cand.normalizedTitle)}`);
        console.log(`    productsConflict  : ${productsConflict(normalized, cand.normalizedTitle)}`);
        console.log(`    distinctiveOverlap: ${distinctiveOverlap(normalized, cand.normalizedTitle).toFixed(3)}`);
        if (match.confidence < 0.85) {
          const verdict = await judgeSameProduct(clean, cand.title);
          console.log(`    LLM-dom           : ${verdict ? `same=${verdict.same} ${verdict.reason ?? ""}` : "null (ingen nyckel/kvot)"}`);
        } else {
          console.log(`    (≥0.85 → binds utan LLM-dom)`);
        }
      }
    }

    // Vad HADE den bästa kandidaten varit utan vakter? Visar om rätt tvilling ens
    // fanns i poolen — kandidaturvalet var felet förra gången (2026-08-07).
    const top = index
      .map((p) => ({ p, s: scoreSimilarity(normalized, p.normalizedTitle) }))
      .sort((a, b) => b.s - a.s)
      .slice(0, 5);
    const titlesById = new Map(
      (
        await prisma.product.findMany({
          where: { id: { in: top.map((t) => t.p.id) } },
          select: { id: true, title: true },
        })
      ).map((r) => [r.id, r.title])
    );
    console.log(`\n  Råa toppkandidater (ingen vakt, bara Dice):`);
    for (const { p, s } of top) {
      console.log(`    ${s.toFixed(3)}  ${titlesById.get(p.id) ?? p.normalizedTitle}`);
      console.log(`             konflikt=${productsConflict(normalized, p.normalizedTitle)}`);
    }
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    process.exit(process.exitCode ?? 0);
  });
