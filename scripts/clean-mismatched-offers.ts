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
import { classifyForm, distinctiveOverlap, languageMismatch, nonEraCoverage } from "../src/scrapers/matching";

const prisma = new PrismaClient();

const SCRAPED_RETAILERS = [
  "Spelexperten",
  "Webhallen",
  "Dragon's Lair",
  "Alphaspel",
  "Tradera",
  // Wave 1–3 butiks-adaptrar (saknades tidigare → deras felmatchningar
  // validerades aldrig, t.ex. Shinycards "Paldea Adventure Chest").
  "Speltrollet",
  "Samlarhobby",
  "Goblinen",
  "Swepoke",
  "Shinycards",
  "MaxGaming",
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
    // Validera ENDAST sealed-produkter. Singlar/graderade går inte att validera
    // pålitligt via URL-slug: butikstitlar varierar för mycket (flavor-text som
    // "deck exklusivt", utelämnade set-namn, reverse/holo-varianter, kortnamn med
    // formord som "Booster Energy Capsule") → för många falska positiva.
    if (o.product.category === "SINGLE_CARD" || o.product.category === "GRADED_CARD") continue;
    checked++;

    const overlap = distinctiveOverlap(scrapedTitle, o.product.title);
    const formA = classifyForm(scrapedTitle);
    const formB = classifyForm(o.product.title);
    // Form-konflikt mellan två tydliga sealed-former (chest≠display, tin≠bundle …)
    // är pålitlig. Ren LÅG överlapp är det INTE — hyphen/omskrivning ger 0,33 på rätt
    // produkt ("Prismatic Super Premium" ↔ "Prismatic Evolutions Super-Premium
    // Collection") → kräv överlapp == 0 (inga delade särskiljande ord alls).
    // "multipack" exkluderas: ett "3-pack blister" klassas ibland som multipack
    // (inledande "3") och ibland som blister → opålitlig formsignal. Riktiga lot-
    // annonser stoppas redan av matcharen (incomingForm multipack → null).
    const formClash =
      formA !== null && formB !== null && formA !== formB &&
      formA !== "multipack" && formB !== "multipack";
    // Offertens egna icke-era ord (t.ex. "perfect order") måste täckas av produkten,
    // annars är annonsen en mer specifik produkt felmatchad mot en bas-produkt.
    // cov === 0 = INGET av offertens egna icke-era ord finns i produkten → en
    // specifik variant felmatchad mot en bas-/annan produkt (t.ex. "Perfect Order
    // ETB" på bas-"Mega Evolution ETB"). Pålitligt. cov 0,2–0,49 lämnas (kan vara
    // samma set med setkod/art-namn) — matcharens <0,5-vakt hindrar nya fel.
    const cov = nonEraCoverage(scrapedTitle, o.product.title);
    const subExpansionMiss = cov === 0;

    if (formClash || overlap === 0 || subExpansionMiss || languageMismatch(scrapedTitle, o.product.title)) {
      mismatched++;
      toDelete.push(o.id);
      if (mismatched <= 60) {
        console.log(
          `  ✗ [${retailerName.get(o.retailerId)}] "${scrapedTitle}" ≠ "${o.product.title}" (överlapp ${overlap.toFixed(2)}${formClash ? `, form ${formA}≠${formB}` : ""}${subExpansionMiss ? `, sub-expansion cov=${cov.toFixed(2)}` : ""})`
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
