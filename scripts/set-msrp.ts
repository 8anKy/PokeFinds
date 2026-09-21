/**
 * Sätt rekommenderat pris (MSRP) på produkter — ägarens verktyg, ingen adminyta.
 *
 * Talet visas i Discord-restock-inlägget som "Rek. pris · 🟢 −8 %"/"🔴 +25 %" och
 * rör ALDRIG rubrikpris, "Lägst", statistik eller larm (se src/lib/msrp.ts).
 *
 * Urval (alla villkor OCH:as):
 *   --slug <slug>              en enskild produkt
 *   --category ETB             ProductCategory (BOOSTER_BOX, BOOSTER_PACK, ETB, …)
 *   --set <setId>              CardSet.id
 *   --language EN|JP
 *   --title-match <regex>      matchas mot Product.title (skiftlägesokänsligt)
 * Värde:
 *   --kr 599                   pris i kronor (decimaler tillåtna: 54.90)
 *   --clear                    nollställ (msrpOre = null)
 *   --only-empty               rör bara produkter som saknar msrpOre
 *
 * Torrkörning som default; --apply skriver.
 *   node scripts/with-prod-db.mjs npx tsx scripts/set-msrp.ts --category ETB --language EN --kr 599
 *   node scripts/with-prod-db.mjs npx tsx scripts/set-msrp.ts --category ETB --language EN --kr 599 --apply
 *
 * Efteråt: kör workflowen restock-routes-export (eller vänta på nattens scrape-all) så
 * Discord-lanen får talen — ruttabellen är lanens enda katalog.
 */
import { prisma } from "../src/lib/db";
import type { Prisma, ProductCategory } from "@prisma/client";

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const opt = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

const APPLY = flag("apply");
const CLEAR = flag("clear");
const ONLY_EMPTY = flag("only-empty");
const slug = opt("slug");
const category = opt("category") as ProductCategory | undefined;
const setId = opt("set");
const language = opt("language")?.toUpperCase();
const titleMatch = opt("title-match");
const kr = opt("kr");

async function main() {
  if (!slug && !category && !setId && !titleMatch) {
    console.error("Ange minst ett urval: --slug, --category, --set eller --title-match.");
    process.exitCode = 1;
    return;
  }
  if (!CLEAR && kr === undefined) {
    console.error("Ange --kr <belopp> eller --clear.");
    process.exitCode = 1;
    return;
  }
  const msrpOre = CLEAR ? null : Math.round(Number(String(kr).replace(",", ".")) * 100);
  if (msrpOre !== null && !(Number.isFinite(msrpOre) && msrpOre > 0)) {
    console.error(`Ogiltigt belopp: ${kr}`);
    process.exitCode = 1;
    return;
  }

  const where: Prisma.ProductWhereInput = {
    ...(slug ? { slug } : {}),
    ...(category ? { category } : {}),
    ...(setId ? { setId } : {}),
    ...(language ? { language: language as "EN" | "JP" | "SV" } : {}),
    ...(ONLY_EMPTY ? { msrpOre: null } : {}),
  };
  let products = await prisma.product.findMany({
    where,
    select: { id: true, slug: true, title: true, category: true, language: true, msrpOre: true },
    orderBy: { title: "asc" },
  });
  if (titleMatch) {
    const re = new RegExp(titleMatch, "i");
    products = products.filter((p) => re.test(p.title));
  }

  console.log(APPLY ? "🔧 APPLY — skriver till databasen." : "🔍 TORRKÖRNING — inget skrivs. Kör med --apply.");
  console.log(`${products.length} produkter → msrpOre=${msrpOre === null ? "null" : msrpOre}\n`);
  for (const p of products) {
    console.log(`  • ${p.title} [${p.category}/${p.language}] (${p.slug}) nu=${p.msrpOre ?? "–"}`);
  }
  if (!APPLY || products.length === 0) return;

  const { count } = await prisma.product.updateMany({
    where: { id: { in: products.map((p) => p.id) } },
    data: { msrpOre },
  });
  console.log(`\n✅ ${count} produkter uppdaterade. Kör restock-routes-export så Discord-lanen ser talet.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
