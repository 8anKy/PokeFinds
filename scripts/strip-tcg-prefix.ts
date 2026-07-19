/**
 * Döper om katalogprodukter med ledande "Pokémon TCG:"-/"Pokemon Trading Card
 * Game"-prefix (ägarbeslut 2026-07-19: prefixet särskiljer inget — hela
 * katalogen är Pokémon TCG). Slug/id RÖRS INTE → offers, watchlists, samlingar,
 * prishistorik och CM-länkar (allt mappar på id) påverkas inte. normalizedTitle
 * räknas om; matchern behandlar redan "pokemon"/"tcg" som stoppord så
 * matchningen är opåverkad.
 *
 * Dry-run är default. Kör skarpt med --apply:
 *   node scripts/with-prod-db.mjs npx tsx scripts/strip-tcg-prefix.ts --apply
 *
 * Krock-vakt: blir det strippade namnet identiskt (case-okänsligt, samma språk)
 * med en ANNAN produkts namn hoppas produkten över och rapporteras — då är
 * prefixet den enda särskiljaren och en omdöpning skulle skapa en synlig dubblett.
 */
import { prisma } from "../src/lib/db";
import { normalizeTitle } from "../src/lib/utils";
import { stripTcgPrefix } from "../src/scrapers/matching";

const APPLY = process.argv.includes("--apply");

async function main() {
  const prods = await prisma.$queryRawUnsafe<
    { id: string; title: string; language: string; slug: string }[]
  >(
    `SELECT id, title, language, slug FROM "Product"
     WHERE title ~* '^pok.mon\\s*(tcg|trading\\s*card\\s*game)'
     ORDER BY title`
  );
  console.log(`${prods.length} produkter med prefix${APPLY ? "" : " (DRY-RUN — inga skrivningar)"}\n`);

  let renamed = 0;
  let skipped = 0;
  for (const p of prods) {
    const next = stripTcgPrefix(p.title);
    if (next === p.title) {
      skipped++;
      console.log(`OFÖRÄNDRAD (vakt): ${p.title}`);
      continue;
    }
    const clash = await prisma.product.findFirst({
      where: {
        id: { not: p.id },
        language: p.language as never,
        title: { equals: next, mode: "insensitive" },
      },
      select: { slug: true },
    });
    if (clash) {
      skipped++;
      console.log(`KROCK (hoppar): "${p.title}" → "${next}" — namnet finns redan (${clash.slug})`);
      continue;
    }
    console.log(`"${p.title}" → "${next}"`);
    if (APPLY) {
      await prisma.product.update({
        where: { id: p.id },
        data: { title: next, normalizedTitle: normalizeTitle(next) },
      });
    }
    renamed++;
  }
  console.log(`\n${renamed} ${APPLY ? "omdöpta" : "skulle döpas om"}, ${skipped} hoppade`);
}

main().finally(() => prisma.$disconnect());
