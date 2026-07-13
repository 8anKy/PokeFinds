/**
 * Åtgärdar det gtin-report.ts hittar. Två delar, båda deterministiska:
 *
 *   (1) MERGA dubbletter — olika produkter, samma tillverkar-streckkod.
 *       Bara grupper där INGEN tvåsidig titelvakt protesterar. En butik som säljer ett
 *       SORTIMENT ("ascended-heroes-ex-box", slumpad karaktär) publicerar EN kod som
 *       landar på flera karaktärsspecifika produkter — streckkoden säger "samma SKU"
 *       men Meganium är inte Emboar. De grupperna rörs ALDRIG automatiskt.
 *
 *   (2) LAGA felaktiga butikslänkar — en produkt vars offers bär OLIKA koder.
 *       OMDIRIGERA (enda automatiska regeln): offerns kod ägs av en ANNAN katalogprodukt
 *                  → flytta offern dit. Bevisbar (butikens sida bär exakt den kod produkten
 *                  äger) och icke-destruktiv (länken finns kvar, bara på rätt produkt).
 *       ALLT ANNAT LÄMNAS. Vi RADERAR INGET.
 *
 *       VARFÖR INTE MAJORITETSRÖSTNING? Frestelsen var att låta majoriteten avgöra och radera
 *       avvikaren. Dry-runen visade varför det vore FEL: "Lumiose City: Emboar Mini Tin" har
 *       tre butiker eniga om 196214139251 — men det är SORTIMENTS-koden (slumpad karaktär).
 *       Webhallens avvikande 196214139497 är den SPECIFIKA Emboar-tinen, alltså den ENDA som
 *       är rätt. Majoriteten mäter hur många butiker som säljer sortiment, inte vad som är sant.
 *       Att radera en KORREKT butikslänk är den osynliga skadan hela designen förbjuder.
 *       En felaktig länk är däremot SYNLIG (gtin-report.ts + "Fel länk?"-kön) → människa dömer.
 *
 *   node scripts/with-prod-db.mjs npx tsx scripts/gtin-fix.ts --dry
 *   node scripts/with-prod-db.mjs npx tsx scripts/gtin-fix.ts --apply
 */
import { PrismaClient } from "@prisma/client";
import { mergeStubInto } from "../src/jobs/dedupe-stubs";
import { formatGtin } from "../src/lib/gtin";
import {
  characterMismatch, pokemonCenterMismatch, seriesMismatch, setMarkerMismatch,
  cardSuffixMismatch, blisterMismatch, unitCountMismatch, yearMismatch, languageMismatch,
} from "../src/scrapers/matching";
import { recomputeProductPriceCache } from "../src/services/products";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");

const GUARDS: [string, (a: string, b: string) => boolean][] = [
  ["Karaktär", characterMismatch],
  ["Pokémon Center", pokemonCenterMismatch],
  ["Series", seriesMismatch],
  ["Set-markör", setMarkerMismatch],
  ["Kort-suffix", cardSuffixMismatch],
  ["Blister-underform", blisterMismatch],
  ["Antal enheter", unitCountMismatch],
  ["Årtal", yearMismatch],
  ["Språk", languageMismatch],
];
const guardObjection = (a: string, b: string) => GUARDS.find(([, fn]) => fn(a, b))?.[0] ?? null;

async function main() {
  console.log(APPLY ? "APPLY — skriver till databasen.\n" : "DRY-RUN — inget skrivs. Kör med --apply.\n");

  // ================= (1) MERGA SÄKRA DUBBLETTER =================
  const dupes = await prisma.$queryRaw<{ gtin: string; ids: string[]; titles: string[]; setIds: (string | null)[] }[]>`
    WITH clean AS (
      SELECT o."productId", MIN(o.gtin) AS gtin
      FROM "Offer" o WHERE o.gtin IS NOT NULL
      GROUP BY o."productId" HAVING COUNT(DISTINCT o.gtin) = 1
    )
    SELECT c.gtin,
           ARRAY_AGG(c."productId" ORDER BY p."setId" NULLS LAST, p."createdAt") AS ids,
           ARRAY_AGG(p.title       ORDER BY p."setId" NULLS LAST, p."createdAt") AS titles,
           ARRAY_AGG(p."setId"     ORDER BY p."setId" NULLS LAST, p."createdAt") AS "setIds"
    FROM clean c JOIN "Product" p ON p.id = c."productId"
    GROUP BY c.gtin HAVING COUNT(*) > 1
  `;

  let merged = 0;
  let skipped = 0;
  console.log(`=== (1) DUBBLETTER — ${dupes.length} grupper ===`);
  for (const d of dupes) {
    // Kanonisk = mest etablerad (set-märkt vinner, annars äldst). ORDER BY ovan gör jobbet.
    const [canonicalId, ...rest] = d.ids;
    const canonicalTitle = d.titles[0];

    const objection = rest
      .map((_, i) => guardObjection(canonicalTitle, d.titles[i + 1]))
      .find((o) => o !== null);
    if (objection) {
      skipped++;
      console.log(`  ⏭  ${formatGtin(d.gtin)} [${objection}] — RÖRS EJ: ${canonicalTitle.slice(0, 40)} ↮ ${d.titles[1].slice(0, 40)}`);
      continue;
    }

    console.log(`  ⇄ ${formatGtin(d.gtin)} → behåll "${canonicalTitle.slice(0, 50)}"`);
    for (let i = 0; i < rest.length; i++) {
      console.log(`       merge  "${d.titles[i + 1].slice(0, 50)}"`);
      if (APPLY) await mergeStubInto(rest[i], canonicalId, () => {});
      merged++;
    }
    if (APPLY) {
      await prisma.product.updateMany({ where: { id: canonicalId, gtin: null }, data: { gtin: d.gtin } });
    }
  }
  console.log(`\n  ${merged} produkter ${APPLY ? "mergade" : "skulle mergas"}, ${skipped} grupper lämnade för manuell granskning.\n`);

  // ================= (2) FELAKTIGA BUTIKSLÄNKAR =================
  const conflicted = await prisma.$queryRaw<{ productId: string; title: string }[]>`
    SELECT p.id AS "productId", p.title
    FROM "Offer" o JOIN "Product" p ON p.id = o."productId"
    WHERE o.gtin IS NOT NULL
    GROUP BY p.id, p.title HAVING COUNT(DISTINCT o.gtin) > 1
  `;

  let rehomed = 0;
  const deleted = 0;
  let left = 0;
  console.log(`=== (2) FELAKTIGA BUTIKSLÄNKAR — ${conflicted.length} produkter ===`);

  for (const c of conflicted) {
    const offers = await prisma.offer.findMany({
      where: { productId: c.productId, gtin: { not: null } },
      select: { id: true, gtin: true, url: true, retailer: { select: { name: true } } },
    });

    // Majoritetskod = produktens sanna identitet, när en klar majoritet finns.
    const tally = new Map<string, number>();
    for (const o of offers) tally.set(o.gtin!, (tally.get(o.gtin!) ?? 0) + 1);
    const ranked = [...tally.entries()].sort((a, b) => b[1] - a[1]);
    const majority = ranked.length > 1 && ranked[0][1] > ranked[1][1] ? ranked[0][0] : null;

    console.log(`\n  ✗ ${c.title.slice(0, 62)}`);
    if (majority) console.log(`      majoritet: ${formatGtin(majority)} (${tally.get(majority)} av ${offers.length} butiker)`);
    else console.log(`      ingen majoritet — butikerna är oense ${ranked.map(([g, n]) => `${formatGtin(g)}×${n}`).join(" / ")}`);

    for (const o of offers) {
      if (majority && o.gtin === majority) continue;

      // Rule A — koden ägs av en ANNAN katalogprodukt → offern hör hemma DÄR.
      // Detta är den ENDA regeln vi kör automatiskt: den är BEVISBAR (butikens sida bär
      // exakt den kod som en annan produkt redan äger) och ICKE-DESTRUKTIV (offern flyttas,
      // raderas inte — länken finns kvar, bara på rätt produkt).
      const owner = await prisma.product.findFirst({
        where: { gtin: o.gtin!, id: { not: c.productId } },
        select: { id: true, title: true },
      });
      const retailerId = (await prisma.offer.findUnique({ where: { id: o.id }, select: { retailerId: true } }))!.retailerId;
      const occupied = owner
        ? await prisma.offer.findFirst({
            where: { productId: owner.id, retailerId, condition: "SEALED" },
            select: { id: true },
          })
        : null;
      if (owner && !occupied) {
        console.log(`      ↪  ${o.retailer.name.padEnd(13)} ${formatGtin(o.gtin)} → OMDIRIGERA till "${owner.title.slice(0, 40)}"`);
        if (APPLY) await prisma.offer.update({ where: { id: o.id }, data: { productId: owner.id } });
        rehomed++;
        continue;
      }

      // ALLT ANNAT LÄMNAS. Vi RADERAR INGET.
      //
      // Frestelsen var att låta majoriteten avgöra och radera avvikaren. DRY-RUNEN visade
      // varför det vore fel: "Lumiose City: Emboar Mini Tin" har tre butiker eniga om
      // 196214139251 — men det är SORTIMENTS-koden (slumpad karaktär). Webhallens avvikande
      // 196214139497 är den SPECIFIKA Emboar-tinen, alltså den ENDA som är rätt. Majoriteten
      // mäter hur många butiker som säljer sortiment, inte vad som är sant.
      //
      // Att radera en KORREKT butikslänk är precis den osynliga skadan hela designen
      // förbjuder (en länk som saknas syns aldrig). En felaktig länk är däremot synlig —
      // den ligger i gtin-report.ts och i "Fel länk?"-kön. Låt en människa döma.
      const why = occupied ? "rätt produkt har redan en offer från butiken" : majority ? "avviker från majoriteten" : "oavgjort";
      console.log(`      ?  ${o.retailer.name.padEnd(13)} ${formatGtin(o.gtin)} → LÄMNAS (${why})  ${o.url.slice(0, 55)}`);
      left++;
    }
  }

  console.log(
    `\n  ${rehomed} offers ${APPLY ? "omdirigerade" : "skulle omdirigeras"} · ` +
      `${deleted} ${APPLY ? "raderade" : "skulle raderas"} · ${left} lämnade för manuell granskning.`
  );

  if (APPLY) {
    console.log(`\nRäknar om Product.gtin + prisscachen…`);
    await prisma.product.updateMany({ where: { gtin: { not: null } }, data: { gtin: null } });
    const rows = await prisma.$queryRaw<{ productId: string; gtin: string }[]>`
      SELECT o."productId", MIN(o.gtin) AS gtin FROM "Offer" o
      WHERE o.gtin IS NOT NULL GROUP BY o."productId" HAVING COUNT(DISTINCT o.gtin) = 1
    `;
    for (const r of rows) await prisma.product.update({ where: { id: r.productId }, data: { gtin: r.gtin } });
    await recomputeProductPriceCache();
    console.log(`  ${rows.length} produkter har en kanonisk GTIN. Prisscachen omräknad.`);
  }

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
