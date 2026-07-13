/**
 * GTIN-rapport: hittar felaktiga butikslänkar OCH katalogdubbletter med REN SQL.
 * Noll LLM-tokens, noll heuristik, noll trösklar att kalibrera.
 *
 *   (A) KONFLIKT  — en produkt vars offers bär OLIKA streckkoder.
 *                   Minst en av butikslänkarna pekar bevisligen på fel produkt.
 *   (B) DUBBLETT  — olika produkter vars offers är eniga om SAMMA streckkod.
 *                   Samma tillverkar-SKU → deterministiska merge-kandidater.
 *   (C) VAKT-KROCK — GTIN säger "samma", en av titelvakterna säger "olika".
 *                   En av dem har fel. Alltid människa, aldrig automatik.
 *
 * LÄS-ONLY. Ändrar ingenting. Fixa alltid via offer-ID, aldrig via URL
 * (se [[project-wrong-link-orphan-offers]]).
 *
 *   node scripts/with-prod-db.mjs npx tsx scripts/gtin-report.ts
 *   node scripts/with-prod-db.mjs npx tsx scripts/gtin-report.ts --strict   # exit 1 vid konflikt (CI)
 */
import { PrismaClient } from "@prisma/client";
import { formatGtin } from "../src/lib/gtin";

const prisma = new PrismaClient();
const STRICT = process.argv.includes("--strict");

async function main() {
  // ---------- (A) KONFLIKT: samma produkt, olika streckkoder ----------
  const conflicts = await prisma.$queryRaw<{ productId: string; title: string; codes: number }[]>`
    SELECT p.id AS "productId", p.title, COUNT(DISTINCT o.gtin)::int AS codes
    FROM "Offer" o
    JOIN "Product" p ON p.id = o."productId"
    WHERE o.gtin IS NOT NULL
    GROUP BY p.id, p.title
    HAVING COUNT(DISTINCT o.gtin) > 1
    ORDER BY COUNT(DISTINCT o.gtin) DESC, p.title
  `;

  console.log(`\n=== (A) FELAKTIGA BUTIKSLÄNKAR — ${conflicts.length} produkter med motstridiga streckkoder ===`);
  if (conflicts.length === 0) console.log("  Inga. (Kör backfill-gtin.ts först om detta ser för bra ut.)");

  for (const c of conflicts.slice(0, 40)) {
    const offers = await prisma.offer.findMany({
      where: { productId: c.productId, gtin: { not: null } },
      select: { id: true, gtin: true, url: true, retailer: { select: { name: true } } },
    });
    console.log(`\n  ✗ ${c.title}`);
    console.log(`    produkt: ${c.productId}`);
    for (const o of offers) {
      console.log(`      ${formatGtin(o.gtin)!.padEnd(15)} ${o.retailer.name.padEnd(14)} offer=${o.id}`);
      console.log(`      ${" ".repeat(15)} ${o.url.slice(0, 90)}`);
    }
    console.log(`    → minst en av dessa länkar pekar på FEL produkt. Radera fel offer via ID.`);
  }
  if (conflicts.length > 40) console.log(`\n  … och ${conflicts.length - 40} till.`);

  // ---------- (B) DUBBLETT: olika produkter, samma streckkod ----------
  // Bara produkter vars offers är ENIGA (en distinkt kod) — annars vore vi
  // beroende av en produkt som redan är trasig enligt (A).
  const dupes = await prisma.$queryRaw<{ gtin: string; productIds: string[]; titles: string[] }[]>`
    WITH clean AS (
      SELECT o."productId", MIN(o.gtin) AS gtin
      FROM "Offer" o
      WHERE o.gtin IS NOT NULL
      GROUP BY o."productId"
      HAVING COUNT(DISTINCT o.gtin) = 1
    )
    SELECT c.gtin,
           ARRAY_AGG(c."productId" ORDER BY p."createdAt") AS "productIds",
           ARRAY_AGG(p.title ORDER BY p."createdAt")       AS titles
    FROM clean c
    JOIN "Product" p ON p.id = c."productId"
    GROUP BY c.gtin
    HAVING COUNT(*) > 1
    ORDER BY COUNT(*) DESC
  `;

  console.log(`\n\n=== (B) KATALOGDUBBLETTER — ${dupes.length} streckkoder som pekar på FLERA produkter ===`);
  if (dupes.length === 0) console.log("  Inga.");
  for (const d of dupes.slice(0, 40)) {
    console.log(`\n  ⇄ ${formatGtin(d.gtin)}  (${d.productIds.length} produkter — samma tillverkar-SKU)`);
    d.titles.forEach((t, i) => console.log(`      ${i === 0 ? "BEHÅLL " : "merge  "} ${t.slice(0, 66)}  ${d.productIds[i]}`));
  }
  if (dupes.length > 40) console.log(`\n  … och ${dupes.length - 40} till.`);

  // ---------- (C) VAKT-KROCK: streckkoden säger samma, titelvakten säger olika ----------
  // Streckkoden är tillverkarens egen nyckel och väger normalt tyngst — MEN en butik
  // KAN skriva in fel kod. Den här listan är därför alltid människo-granskad, aldrig
  // automatisk. (Exempel funnet i mätningen: DL:s "Stellar Crown Pokémon Center ETB"
  // delade kod med allas vanliga "Stellar Crown ETB" — någon av dem har fel.)
  const {
    pokemonCenterMismatch, seriesMismatch, setMarkerMismatch, languageMismatch,
    characterMismatch, cardSuffixMismatch, blisterMismatch, unitCountMismatch, yearMismatch,
  } = await import("../src/scrapers/matching");

  // characterMismatch är den VIKTIGASTE här: en butik som säljer ett SORTIMENT
  // ("ascended-heroes-ex-box", slumpad karaktär) publicerar EN kod som då landar på
  // flera karaktärsspecifika produkter. Streckkoden säger "samma", men Meganium är
  // inte Emboar. Utan den här vakten hade en automatisk merge slagit ihop dem.
  const GUARDS: [string, (a: string, b: string) => boolean][] = [
    ["Karaktär (sortiments-kod?)", characterMismatch],
    ["Pokémon Center", pokemonCenterMismatch],
    ["Series-nummer", seriesMismatch],
    ["Set-markör (t.ex. 151)", setMarkerMismatch],
    ["Kort-suffix (ex/GX/V)", cardSuffixMismatch],
    ["Blister-underform", blisterMismatch],
    ["Antal enheter", unitCountMismatch],
    ["Årtal", yearMismatch],
    ["Språk", languageMismatch],
  ];

  const clash: string[] = [];
  const safe: typeof dupes = [];
  for (const d of dupes) {
    let flagged: string | null = null;
    for (let i = 1; i < d.titles.length && !flagged; i++) {
      const [a, b] = [d.titles[0], d.titles[i]];
      const hit = GUARDS.find(([, fn]) => fn(a, b));
      if (hit) {
        flagged = hit[0];
        clash.push(`  ⚠ ${formatGtin(d.gtin)}  [${hit[0]}]\n      A: ${a.slice(0, 66)}\n      B: ${b.slice(0, 66)}`);
      }
    }
    if (!flagged) safe.push(d);
  }

  console.log(`\n\n=== (C) VAKT-KROCK — ${clash.length} dubbletter där en titelvakt säger EMOT streckkoden ===`);
  if (clash.length === 0) console.log("  Inga. Streckkoderna och titelvakterna är eniga.");
  else {
    console.log(
      "  MERGA INTE DESSA AUTOMATISKT. Vanligaste orsaken: butiken säljer ett SORTIMENT\n" +
        "  (en kod, slumpad karaktär) → koden landar på flera karaktärsspecifika produkter.\n" +
        "  Då är butikens LÄNK fel, inte katalogen. Granska manuellt.\n"
    );
    clash.slice(0, 25).forEach((c) => console.log(c));
  }
  console.log(`\n  → ${safe.length} av ${dupes.length} dubblettgrupper är SÄKRA att merga (ingen vakt protesterar).`);

  console.log(
    `\n\nSUMMERING: ${conflicts.length} felaktiga butikslänkar · ${dupes.length} dubblett-grupper ` +
      `(${safe.length} säkra, ${clash.length} kräver granskning)`
  );

  if (STRICT && conflicts.length > 0) {
    console.error(`\nSTRICT: ${conflicts.length} produkter har motstridiga streckkoder → exit 1`);
    process.exitCode = 1;
  }
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
