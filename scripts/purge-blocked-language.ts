/**
 * Rensar katalogen från produkter på BLOCKADE språk (CN/KR/EU — katalogen är EN+JP).
 *
 * Varför den finns: 2026-07-07 auto-importerades 6 Samlarhobby-produkter med *SPANSK*
 * och *TYSK* i titeln 15 MINUTER innan EU-blocket deployades. Den efterföljande
 * städningen raderade rader där `Product.language` var OTHER — men stubbarna hade
 * tagg-ats EN (språket syns bara i TITELN, inte i kolumnen), så de överlevde och låg
 * kvar synliga i katalogen i fem dygn.
 *
 * Lärdomen: rensa på SAMMA signal som blockerar, aldrig på en sidoeffekt av den.
 * Skriptet kör därför isBlockedListingLanguage() — exakt samma funktion som
 * ensureListingProduct/checkListingAlerts grindar på — över titel OCH butiks-URL:er.
 * Kan köras om när som helst; hittar den inget är katalogen ren.
 *
 * DRY-RUN som default. Kör:
 *   DATABASE_URL=<neon> npx tsx scripts/purge-blocked-language.ts          (visa)
 *   DATABASE_URL=<neon> APPLY=1 npx tsx scripts/purge-blocked-language.ts  (radera)
 */
import { prisma } from "../src/lib/db";
import { detectListingLanguage, isBlockedListingLanguage } from "../src/lib/listing-language";

const APPLY = process.env.APPLY === "1";

async function main() {
  const [{ db }] = await prisma.$queryRaw<{ db: string }[]>`SELECT current_database() AS db`;
  console.log(`DB: ${db} — ${APPLY ? "APPLY (raderar)" : "DRY-RUN"}\n`);

  const products = await prisma.product.findMany({
    where: { category: { notIn: ["SINGLE_CARD", "GRADED_CARD"] } },
    select: {
      id: true,
      title: true,
      language: true,
      createdAt: true,
      offers: { select: { url: true, retailer: { select: { name: true } } } },
      _count: { select: { watchlistItems: true, collectionItems: true } },
    },
  });

  // Blockerat om TITELN eller någon butiks-URL avslöjar ett blockat språk — samma
  // haystack som guarden i runner.ts använder vid import.
  const blocked = products.filter((p) =>
    p.offers.some((o) => isBlockedListingLanguage(p.title, o.url)) ||
    isBlockedListingLanguage(p.title)
  );

  if (blocked.length === 0) {
    console.log(`✅ Inga blockade språk i katalogen (${products.length} sealed-produkter granskade).`);
    return;
  }

  console.log(`${blocked.length} produkt(er) på blockat språk av ${products.length} granskade:\n`);
  let held = 0;
  for (const p of blocked) {
    const lang = detectListingLanguage(p.title, p.offers[0]?.url ?? null);
    const store = p.offers[0]?.retailer.name ?? "—";
    const owned = p._count.watchlistItems + p._count.collectionItems;
    if (owned > 0) held++;
    console.log(`  [${lang}] "${p.title}"`);
    console.log(`        ${p.id} · ${store} · lang-kolumn=${p.language} · skapad ${p.createdAt.toISOString().slice(0, 10)}`);
    if (owned > 0) {
      console.log(`        ⚠ ${p._count.watchlistItems} bevakning(ar), ${p._count.collectionItems} samlingspost(er) — RADERAS med produkten (cascade)`);
    }
  }

  if (!APPLY) {
    console.log(`\nDRY-RUN — inget raderat. APPLY=1 för att radera.${held > 0 ? ` OBS: ${held} produkt(er) ligger i någons bevakning/samling.` : ""}`);
    return;
  }

  // Cascade tar offers, snapshots, observations, bevakningar och samlingsposter.
  const { count } = await prisma.product.deleteMany({ where: { id: { in: blocked.map((p) => p.id) } } });
  console.log(`\n🗑  ${count} produkt(er) raderade (offers/snapshots/bevakningar kaskaderade).`);
  console.log(`   Butikernas feeds kan fortfarande lista dem — men isBlockedListingLanguage()`);
  console.log(`   i ensureListingProduct blockerar återimport, så de kommer inte tillbaka.`);
}

main().finally(() => prisma.$disconnect());
