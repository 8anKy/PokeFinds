/**
 * ETIKETTERAR SET-LÖSA SEALED-PRODUKTER VIA CM:s EXPANSION (engångsstädning).
 *
 * Gapet (upptäckt 2026-08-09, 30th Celebration-tinsen): en produkt som prissätts
 * av EN-guide-fallbacken finns inte i RapidAPI och nådde därför aldrig någon
 * set-etikettering — priset uppdaterades dagligen medan setet stod tomt. Den
 * durabla fixen sitter numera i cardmarket-refresh (expansion-joinen i 1b);
 * det här skriptet städar det som redan ligger set-löst i katalogen.
 *
 * JOINEN ÄR EXAKT I BÅDA LEDEN: produktens EGEN CM-länk (idProduct) →
 * CM-katalogens idExpansion → vårt setId, härlett ur våra REDAN etiketterade
 * produkter. Vakterna (enhällighet + dubbelriktning) bor i expansionSetJoin —
 * första utkastet utan dubbelriktningen föreslog 300 FEL etiketter, för CM:s
 * expansion 1645 är en CONTAINER (1 094 tins från tjugo år) och en enda
 * felmärkt produkt i den gjorde "enhällighet" sann. Ingen titelmatchning.
 *
 * Kör:  node scripts/with-prod-db.mjs npx tsx scripts/label-sets-by-cm-expansion.ts
 *       node scripts/with-prod-db.mjs npx tsx scripts/label-sets-by-cm-expansion.ts --apply
 */
import { PrismaClient } from "@prisma/client";
import { expansionSetJoin } from "../src/lib/cm-expansion-join";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");

const NONSINGLES =
  "https://downloads.s3.cardmarket.com/productCatalog/productList/products_nonsingles_6.json";

async function main() {
  const r = await fetch(NONSINGLES);
  if (!r.ok) throw new Error(`nonsingles-katalog HTTP ${r.status}`);
  const catalog = (await r.json()) as { products: { idProduct: number; idExpansion?: number | null }[] };
  const expById = new Map(
    catalog.products.flatMap((p) => (p.idExpansion != null ? [[p.idProduct, p.idExpansion] as const] : []))
  );

  const cm = await prisma.retailer.findFirst({ where: { name: "Cardmarket" }, select: { id: true } });
  if (!cm) throw new Error("Cardmarket-retailer saknas.");

  const products = await prisma.product.findMany({
    where: {
      category: { notIn: ["SINGLE_CARD", "GRADED_CARD", "ACCESSORY"] },
      offers: { some: { retailerId: cm.id, url: { contains: "idProduct=" } } },
    },
    select: {
      id: true, title: true, setId: true, language: true,
      offers: { where: { retailerId: cm.id }, select: { url: true } },
    },
  });

  const idProductOf = (p: (typeof products)[number]) => {
    const m = p.offers.map((o) => o.url?.match(/idProduct=(\d+)/)).find(Boolean);
    return m ? parseInt(m[1], 10) : null;
  };

  const setIdByExp = expansionSetJoin(
    products.map((p) => ({ setId: p.setId, idProduct: idProductOf(p) })),
    expById
  );
  console.log(`${setIdByExp.size} expansioner klarade båda vakterna (enhällighet + dubbelriktning).`);

  const setNames = new Map(
    (await prisma.cardSet.findMany({ select: { id: true, name: true, language: true } })).map((s) => [s.id, `${s.name} (${s.language})`])
  );

  let labeled = 0, noJoin = 0;
  for (const p of products) {
    if (p.setId) continue;
    const id = idProductOf(p);
    const exp = id != null ? expById.get(id) : undefined;
    const target = exp != null ? setIdByExp.get(exp) : undefined;
    if (!target) { noJoin++; continue; }
    console.log(`  "${p.title}" [${p.language}] → ${setNames.get(target)}`);
    if (APPLY) await prisma.product.update({ where: { id: p.id }, data: { setId: target } });
    labeled++;
  }
  console.log(`\n${labeled} etiketterade · ${noJoin} utan joinbar expansion.`);
  if (!APPLY) console.log("TORRKÖRNING — inget skrivet. Kör med --apply.");
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
