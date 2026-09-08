/**
 * Byter BUTIKSFOTON mot Cardmarkets egen render på produkter som redan har en
 * CM-länk. Ren rapport tills `--apply`.
 *
 *   node scripts/with-prod-db.mjs npx tsx scripts/fix-store-photos-to-cm.ts
 *   ... --apply
 *
 * Ett butiksfoto är butikens ljussättning, bakgrund och ibland deras vattenstämpel —
 * CM:s render är samma bild för alla och den katalogen är byggd kring.
 *
 * ⛔ EN BILD-URL I KATALOGEN BEVISAR INTE ATT CM HAR EN RENDER. Hundratals sealed-SKU:er
 *    (blistrar, checklanes, pin collections) saknar render helt, och pekar man imageUrl
 *    på proxyn ändå blir bilden TRASIG — sämre än butiksfotot vi hade. Därför
 *    `cmRenderExists()` per produkt före varje byte (se src/lib/cm-image.ts).
 * ⛔ TCGGO-renders (`images.tcggo.com`) rörs INTE: de ÄR Cardmarkets transparenta
 *    render, bara serverad av leverantören. Bara riktiga butiksfoton byts.
 */
import { PrismaClient } from "@prisma/client";
import { cmImageProxyUrl, cmRenderExists } from "../src/lib/cm-image";
import { mapPool } from "../src/lib/concurrency";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");

async function main() {
  const all = await prisma.product.findMany({
    where: { category: { notIn: ["SINGLE_CARD", "GRADED_CARD"] }, hiddenAt: null },
    select: { id: true, title: true, imageUrl: true,
              offers: { select: { url: true, retailer: { select: { name: true } } } } },
  });
  const cmIdOf = (p: (typeof all)[number]) => {
    const o = p.offers.find((x) => x.retailer.name === "Cardmarket");
    const m = o?.url.match(/idProduct=(\d+)/);
    return m ? m[1] : null;
  };
  const candidates = all
    .filter((p) => p.imageUrl && !/cm-image|images\.tcggo\.com/.test(p.imageUrl))
    .map((p) => ({ p, cmid: cmIdOf(p) }))
    .filter((x): x is { p: (typeof all)[number]; cmid: string } => x.cmid != null);

  console.log(`Butiksfoton med CM-id: ${candidates.length} — kontrollerar om CM har en render …\n`);

  let swapped = 0, noRender = 0;
  await mapPool(candidates, 6, async ({ p, cmid }) => {
    const ok = await cmRenderExists(cmid);
    if (!ok) {
      noRender++;
      console.log(`  ingen CM-render  ${p.title.slice(0, 52)}`);
      return;
    }
    swapped++;
    console.log(`${APPLY ? "  BYTER  " : "  skulle "} ${p.title.slice(0, 52).padEnd(52)} → /api/cm-image/${cmid}`);
    if (APPLY) await prisma.product.update({ where: { id: p.id }, data: { imageUrl: cmImageProxyUrl(cmid) } });
  });

  console.log(`\n${APPLY ? "Bytta" : "Skulle byta"}: ${swapped}   utan CM-render (behåller butiksfotot): ${noRender}`);
  if (!APPLY) console.log("Torrkörning — inget skrevs.");
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
