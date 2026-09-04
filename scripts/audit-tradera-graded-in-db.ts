/**
 * MÄTNING (rapport only): har GRADERADE Tradera-annonser redan landat på RAW
 * produkter i vår databas?
 *
 * Två bevis, båda ur data vi redan sparar:
 *  1. `Offer.url` för Tradera har formen /item/<categoryId>/<itemId>/<slug>.
 *     Kategori-segmentet är annonsens EGEN kategori — 1001338 = Graderade kort.
 *     En sådan offer på en SINGLE_CARD-produkt är ett bevisat läckage.
 *  2. Slugen/`rawData.title` bär "psa-10", "cgc-9" osv. Det fångar de graderade
 *     som säljaren lagt i Löskort (1001337) — där kategorin INTE avslöjar dem.
 *
 * Skriver inget.
 */
import "dotenv/config";
import { prisma } from "../src/lib/db";

const GRADED_SLUG = /(?:^|[-\/])(psa|bgs|cgc|sgc|ace|beckett|raukcard|rauk|tag|hga|gma|isa|ags)-?(?:gem-?)?(?:mint-?)?(10|[1-9])(?:-5)?(?:$|[-\/])/i;
const GRADED_WORD = /(?:^|[-\/])(graderad|graderat|graded|slab)(?:$|[-\/])/i;

function catFromUrl(url: string): number | null {
  const m = url.match(/\/item\/(\d+)\/\d+/);
  return m ? parseInt(m[1], 10) : null;
}

async function main() {
  const retailers = await prisma.retailer.findMany({
    where: { name: { contains: "Tradera", mode: "insensitive" } },
    select: { id: true, name: true },
  });
  console.log(`Tradera-retailers: ${retailers.map((r) => r.name).join(", ") || "(inga)"}`);

  if (retailers.length) {
    const offers = await prisma.offer.findMany({
      where: { retailerId: { in: retailers.map((r) => r.id) } },
      select: { id: true, url: true, price: true, product: { select: { title: true, category: true } } },
    });
    console.log(`\n=== OFFERS FRÅN TRADERA: ${offers.length} ===`);

    const byCat = new Map<string, number>();
    for (const o of offers) {
      const c = catFromUrl(o.url);
      const k = c ? String(c) : "(ingen kategori i url)";
      byCat.set(k, (byCat.get(k) ?? 0) + 1);
    }
    console.log("Annonskategori i URL:");
    for (const [k, n] of [...byCat.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${k.padEnd(26)} ${n}`);
    }

    const fromGradedCat = offers.filter((o) => catFromUrl(o.url) === 1001338);
    const slugGraded = offers.filter((o) => GRADED_SLUG.test(o.url) || GRADED_WORD.test(o.url));
    const union = offers.filter(
      (o) => catFromUrl(o.url) === 1001338 || GRADED_SLUG.test(o.url) || GRADED_WORD.test(o.url)
    );

    console.log(`\nGRADERADE OFFERS:`);
    console.log(`  ur kategori 1001338:        ${fromGradedCat.length}`);
    console.log(`  slug ser graderad ut:       ${slugGraded.length}`);
    console.log(`  någondera (unikt):          ${union.length}`);
    const onRaw = union.filter((o) => o.product.category !== "GRADED_CARD");
    console.log(`  ...varav på en RAW produkt: ${onRaw.length}   <-- felaktiga prispunkter`);
    for (const o of onRaw.slice(0, 20)) {
      console.log(`    ${String(o.price ? Math.round(o.price / 100) : "-").padStart(6)} kr  [${o.product.category}] ${o.product.title.slice(0, 40)}`);
      console.log(`            ${o.url.slice(0, 110)}`);
    }
  }

  // ── Prisobservationer (aktiv-svepet + sålt-svepet) ────────────────────────
  const sources = await prisma.scrapeSource.findMany({
    where: { name: { contains: "Tradera", mode: "insensitive" } },
    select: { id: true, name: true },
  });
  console.log(`\nTradera-källor: ${sources.map((s) => s.name).join(", ") || "(inga)"}`);

  for (const s of sources) {
    const rows = await prisma.$queryRawUnsafe<{ title: string; price: number; category: string; observedat: Date }[]>(
      `SELECT o."rawData"->>'title' AS title, o.price, p.category, o."observedAt" AS observedat
       FROM "PriceObservation" o JOIN "Product" p ON p.id = o."productId"
       WHERE o."sourceId" = $1 AND o."rawData"->>'title' IS NOT NULL`,
      s.id
    );
    const graded = rows.filter((r) => {
      const t = " " + r.title.toLowerCase().replace(/[^a-z0-9.]+/g, " ") + " ";
      return /\b(psa|bgs|cgc|sgc|ace|beckett|raukcard|rauk|tag|hga|gma|isa|ags)\s*(?:gem\s*)?(?:mint\s*)?(10|[1-9])(?:\.5)?\b/.test(t) ||
        /\b(graderad|graderat|graded|slab)\b/.test(t);
    });
    const onRaw = graded.filter((r) => r.category !== "GRADED_CARD");
    console.log(`\n=== ${s.name}: ${rows.length} observationer ===`);
    console.log(`  ser graderade ut:           ${graded.length}  (${rows.length ? ((graded.length / rows.length) * 100).toFixed(1) : "0"}%)`);
    console.log(`  ...varav på en RAW produkt: ${onRaw.length}   <-- förorenar den ograderade kurvan`);
    for (const r of onRaw.slice(0, 15)) {
      console.log(`    ${String(Math.round(r.price / 100)).padStart(6)} kr  ${r.observedat.toISOString().slice(0, 10)}  [${r.category}]  ${r.title.slice(0, 66)}`);
    }
  }

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
