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
import * as fs from "fs";
import * as path from "path";
import { PrismaClient } from "@prisma/client";
import { cmImageProxyUrl, cmRenderExists } from "../src/lib/cm-image";
import { mapPool } from "../src/lib/concurrency";
import { normalizeTitle } from "../src/lib/utils";

/**
 * Leverantörens render per normaliserat namn — engelska OCH japanska katalogen.
 *
 * ⛔ SAKNAS CM-RENDER ÄR LEVERANTÖRENS FIL NÄSTA STEG, INTE SLUTET. Första versionen
 *    gav upp där och lämnade fyra butiksfoton kvar — tre hade en perfekt render hos
 *    TCGGO (Mega Brave/Mega Symphonia Pokémon Center Set, Double Crisis Team Aqua).
 * ⛔ BÅDA katalogerna läses: JP-sealed ligger i sin EGEN fil, och två av de tre var
 *    japanska.
 */
function loadSupplierImages(): Map<string, string> {
  const out = new Map<string, string>();
  for (const f of ["rapidapi-sealed.json", "rapidapi-sealed-jp.json"]) {
    const file = path.join(process.cwd(), ".cache", f);
    if (!fs.existsSync(file)) continue;
    for (const a of JSON.parse(fs.readFileSync(file, "utf-8")) as { name: string; image?: string }[])
      if (a.image) out.set(normalizeTitle(a.name), a.image);
  }
  return out;
}

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

  const supplier = loadSupplierImages();
  console.log(`Butiksfoton med CM-id: ${candidates.length} · leverantörsbilder i cachen: ${supplier.size}\n`);

  let swapped = 0, noRender = 0;
  await mapPool(candidates, 6, async ({ p, cmid }) => {
    // CM-render → TCGGO-render → behåll butiksfotot. Se loadSupplierImages.
    const target = (await cmRenderExists(cmid))
      ? cmImageProxyUrl(cmid)
      : (supplier.get(normalizeTitle(p.title)) ?? null);
    if (!target) {
      noRender++;
      console.log(`  varken CM- eller TCGGO-render  ${p.title.slice(0, 46)}`);
      return;
    }
    swapped++;
    console.log(`${APPLY ? "  BYTER  " : "  skulle "} ${p.title.slice(0, 46).padEnd(46)} → ${target.startsWith("/api/") ? target : "TCGGO-render"}`);
    if (APPLY) await prisma.product.update({ where: { id: p.id }, data: { imageUrl: target } });
  });

  console.log(`\n${APPLY ? "Bytta" : "Skulle byta"}: ${swapped}   utan CM-render (behåller butiksfotot): ${noRender}`);
  if (!APPLY) console.log("Torrkörning — inget skrevs.");
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
