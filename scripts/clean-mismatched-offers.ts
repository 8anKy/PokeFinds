/**
 * Tar bort fel-matchade skrapade offers som den gamla matcharen skapade
 * (t.ex. en Spelexperten-offer för "Ascended Heroes ETB" som hamnade på
 * produkten "Destined Rivals ETB").
 *
 * Valideringen jämför butikens URL-slug (som innehåller butikens produkttitel)
 * mot vår produkttitel med samma särskiljande-ord-överlapp och produktform-
 * vakt som den nya matcharen. Offers som inte klarar kontrollen raderas —
 * nästa skrapkörning återskapar dem på rätt produkt.
 *
 * Körs med: npx tsx scripts/clean-mismatched-offers.ts        (dry-run)
 *           DELETE=1 npx tsx scripts/clean-mismatched-offers.ts (radera)
 */
import { PrismaClient } from "@prisma/client";
import { classifyForm, distinctiveOverlap, languageMismatch } from "../src/scrapers/matching";

const prisma = new PrismaClient();

const SCRAPED_RETAILERS = [
  "Spelexperten",
  "Webhallen",
  "Dragon's Lair",
  "Alphaspel",
  "Tradera",
];

const DELETE = process.env.DELETE === "1";

/** Plockar ut en läsbar titel ur en produkt-URL:s slug. */
function titleFromUrl(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.pathname.includes("search") || u.search.length > 0) return null; // sök-URL — ingen slug
    const segments = u.pathname.split("/").filter(Boolean);
    if (segments.length === 0) return null;
    let slug = decodeURIComponent(segments[segments.length - 1]);
    slug = slug.replace(/\.(html?|php|aspx?)$/i, "");
    // Ta bort inledande artikelnummer ("123456-pokemon-tcg-...")
    slug = slug.replace(/^\d{3,}-/, "");
    const words = slug.replace(/[-_+]/g, " ").trim();
    if (words.length < 6) return null;
    return words;
  } catch {
    return null;
  }
}

async function main() {
  const retailers = await prisma.retailer.findMany({
    where: { name: { in: SCRAPED_RETAILERS } },
    select: { id: true, name: true },
  });
  const retailerName = new Map(retailers.map((r) => [r.id, r.name]));

  const offers = await prisma.offer.findMany({
    where: { retailerId: { in: retailers.map((r) => r.id) } },
    select: {
      id: true,
      url: true,
      retailerId: true,
      product: { select: { title: true, category: true } },
    },
  });
  console.log(`🔍 Granskar ${offers.length} skrapade offers...`);

  let checked = 0;
  let mismatched = 0;
  const toDelete: string[] = [];

  for (const o of offers) {
    const scrapedTitle = titleFromUrl(o.url);
    if (!scrapedTitle || /^\d+$/.test(scrapedTitle.trim())) continue; // sök-URL eller rent artikelnummer — kan inte valideras
    checked++;

    const overlap = distinctiveOverlap(scrapedTitle, o.product.title);
    const formA = classifyForm(scrapedTitle);
    const formB = classifyForm(o.product.title);
    const isSingleProduct =
      o.product.category === "SINGLE_CARD" || o.product.category === "GRADED_CARD";
    const formMismatch =
      (formA !== null && formB !== null && formA !== formB) ||
      // Sealed-form (tin/display/collection...) på ett singelkort = fel match
      (isSingleProduct && formA !== null);

    if (overlap < 0.5 || formMismatch || languageMismatch(scrapedTitle, o.product.title)) {
      mismatched++;
      toDelete.push(o.id);
      if (mismatched <= 30) {
        console.log(
          `  ✗ [${retailerName.get(o.retailerId)}] "${scrapedTitle}" ≠ "${o.product.title}" (överlapp ${overlap.toFixed(2)}${formMismatch ? `, form ${formA}≠${formB}` : ""})`
        );
      }
    }
  }

  console.log(`\nValiderbara: ${checked}, fel-matchade: ${mismatched}`);
  if (DELETE && toDelete.length > 0) {
    const res = await prisma.offer.deleteMany({ where: { id: { in: toDelete } } });
    console.log(`🗑️  Raderade ${res.count} offers.`);
  } else if (toDelete.length > 0) {
    console.log("Dry-run — kör med DELETE=1 för att radera.");
  }
}

main()
  .catch((e) => {
    console.error("Misslyckades:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
