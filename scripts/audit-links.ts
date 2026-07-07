/**
 * Länk-revision: hittar butiks-offers vars URL-slug motsäger produkttiteln —
 * serienummer (Series 1 ≠ Series 2), sifferset ("151"), språkmarkörer (japansk)
 * och grovt titel-avstånd. Fångar fel-länkar som skapades INNAN matcher-vakterna
 * fanns (de vaktar bara nya matchningar, inte befintlig data).
 *
 * Läser bara. Kör: DATABASE_URL=<neon> npx tsx scripts/audit-links.ts
 * Exit 1 om säkra fel hittas → kan köras röd-flaggande i CI (store-health).
 *
 * Tradera ingår inte (egen LLM-verifiering via verifyTraderaMatches);
 * Cardmarket/API-källor har inte beskrivande slugs.
 */
import { PrismaClient } from "@prisma/client";
import { isDirectOfferUrl } from "../src/lib/marketplace-urls";
import { detectListingLanguage } from "../src/lib/listing-language";
import {
  languageMismatch,
  scoreSimilarity,
  seriesMismatch,
  setMarkerMismatch,
} from "../src/scrapers/matching";

const prisma = new PrismaClient();

const NON_STORE = ["Cardmarket", "Tradera", "Pokémon TCG API", "TCGdex API"];

/** Sista URL-segmentet som läsbar text ("...-series-2" → "series 2"). */
export function slugText(url: string): string {
  try {
    const path = new URL(url).pathname;
    const seg = path.split("/").filter(Boolean).pop() ?? "";
    return decodeURIComponent(seg)
      .replace(/\.(html?|php|aspx?)$/i, "")
      .replace(/[-_+.]/g, " ")
      .trim();
  } catch {
    return "";
  }
}

async function main() {
  const offers = await prisma.offer.findMany({
    where: { retailer: { name: { notIn: NON_STORE } } },
    select: {
      id: true, url: true, price: true, stockStatus: true,
      retailer: { select: { name: true } },
      product: { select: { id: true, title: true, category: true, language: true } },
    },
  });
  console.log(`${offers.length} butiks-offers granskas.`);

  const definite: typeof offers = [];
  const review: { o: (typeof offers)[number]; why: string; score: number }[] = [];

  for (const o of offers) {
    // Sök-/reset-URL:er är medvetet neutraliserade offers (dolda i UI) — inget att bedöma.
    if (!isDirectOfferUrl(o.url)) continue;
    const slug = slugText(o.url);
    // Slugs utan innehåll (t.ex. webhallen.com/se/product/399534 = bara siffror)
    // går inte att bedöma på URL — hoppa.
    if (!slug || !/[a-z]{3}/i.test(slug)) continue;
    const title = o.product.title;

    if (seriesMismatch(title, slug)) {
      definite.push(o);
      continue;
    }
    // Blockade språk (kinesiska/koreanska) får inte finnas som butikslänkar ALLS
    // — oavsett produkt. En "…-koreansk"-slug på en (Japansk)-produkt är dubbelt
    // fel (fel språk + fel produkt).
    const slugLang = detectListingLanguage("", o.url);
    if (slugLang === "CN" || slugLang === "KR") {
      definite.push(o);
      continue;
    }
    if (setMarkerMismatch(title, slug)) {
      review.push({ o, why: "sifferset-markör skiljer", score: scoreSimilarity(title, slug) });
      continue;
    }
    // Kända JP-produkter (language=JP) triggar falskt när butiksslugen uttrycker
    // japanskheten men titeln inte gör det (eller tvärtom) — hoppa språkkollen då.
    if (o.product.language !== "JP" && languageMismatch(title, slug)) {
      review.push({ o, why: "språkmarkör skiljer", score: scoreSimilarity(title, slug) });
      continue;
    }
    const score = scoreSimilarity(title, slug);
    if (score < 0.18) review.push({ o, why: "lågt titel-slug-avstånd", score });
  }

  console.log(`\n=== SÄKRA fel (serienummer-mismatch): ${definite.length} ===`);
  for (const o of definite) {
    console.log(`  offer ${o.id} | ${o.retailer.name} | "${o.product.title}"`);
    console.log(`    → ${o.url}`);
  }

  review.sort((a, b) => a.score - b.score);
  console.log(`\n=== GRANSKA (${review.length}) ===`);
  for (const { o, why, score } of review) {
    console.log(`  [${why}, sim ${score.toFixed(2)}] ${o.retailer.name} | "${o.product.title}"`);
    console.log(`    → ${o.url}`);
  }

  if (definite.length > 0) process.exitCode = 1;
}

main().finally(() => prisma.$disconnect());
