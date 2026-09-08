/**
 * BILDER SOM VISAR FEL PRODUKT. Rapport, inga skrivningar.
 *
 *   node scripts/with-prod-db.mjs npx tsx scripts/audit-image-mismatch.ts
 *
 * En trasig bild syns direkt (tom ruta). En bild som visar FEL vara laddar perfekt och
 * upptäcks bara av att någon känner igen produkten — därför de här två STRUKTURELLA
 * kontrollerna, som inte behöver se bilden:
 *
 *  1. `/api/cm-image/<id>` där <id> INTE är produktens egen Cardmarket-idProduct.
 *     Då renderas en annan produkts bild. Exakt och odiskutabelt.
 *  2. `images.tcggo.com/.../<slug>.png` vars slug inte delar orden med produktens
 *     titel. Leverantören namnger filen efter produkten, så en främmande slug betyder
 *     att bilden kom från en annan post (t.ex. vid en tvillingmatchning).
 */
import { PrismaClient } from "@prisma/client";
import { normalizeTitle } from "../src/lib/utils";

const prisma = new PrismaClient();

/** Andel av produktens ord som återfinns i bildfilens slug. */
function slugOverlap(title: string, url: string): number {
  const file = url.split("/").pop()?.replace(/\.(png|jpe?g|webp).*$/i, "") ?? "";
  const fileWords = new Set(normalizeTitle(file.replace(/[-_]/g, " ")).split(" ").filter((w) => w.length > 2));
  const titleWords = normalizeTitle(title).split(" ").filter((w) => w.length > 2);
  if (titleWords.length === 0 || fileWords.size === 0) return 1;
  return titleWords.filter((w) => fileWords.has(w)).length / titleWords.length;
}

async function main() {
  const all = await prisma.product.findMany({
    where: { category: { notIn: ["SINGLE_CARD", "GRADED_CARD"] }, hiddenAt: null },
    select: { title: true, slug: true, language: true, imageUrl: true,
              offers: { select: { url: true, retailer: { select: { name: true } } } } },
  });
  const cmIdOf = (p: (typeof all)[number]) => {
    const o = p.offers.find((x) => x.retailer.name === "Cardmarket");
    const m = o?.url.match(/idProduct=(\d+)/);
    return m ? m[1] : null;
  };

  const wrongId: string[] = [];
  const weakSlug: { line: string; score: number }[] = [];
  for (const p of all) {
    if (!p.imageUrl) continue;
    const m = p.imageUrl.match(/\/api\/cm-image\/(\d+)/);
    if (m) {
      const own = cmIdOf(p);
      if (own && own !== m[1])
        wrongId.push(`   bild=${m[1]} men produktens CM-id=${own}   [${p.language}] ${p.title.slice(0, 46)}`);
      continue;
    }
    if (/images\.tcggo\.com/.test(p.imageUrl)) {
      const s = slugOverlap(p.title, p.imageUrl);
      if (s < 0.5)
        weakSlug.push({ score: s, line: `   ${(s * 100).toFixed(0)}% ord i filnamnet  [${p.language}] ${p.title.slice(0, 44)}\n        ${p.imageUrl.split("/").pop()?.slice(0, 60)}` });
    }
  }
  console.log(`Sealed granskade: ${all.length}\n`);
  console.log(`1) CM-bild med FEL idProduct: ${wrongId.length}`);
  for (const r of wrongId.slice(0, 30)) console.log(r);
  console.log(`\n2) TCGGO-bild vars filnamn inte matchar titeln: ${weakSlug.length}`);
  for (const r of weakSlug.sort((a, b) => a.score - b.score).slice(0, 30)) console.log(r.line);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
