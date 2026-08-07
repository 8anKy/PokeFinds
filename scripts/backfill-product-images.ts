/**
 * Ger bildlösa produkter en bild.
 *
 *   node scripts/with-prod-db.mjs npx tsx scripts/backfill-product-images.ts
 *   node scripts/with-prod-db.mjs npx tsx scripts/backfill-product-images.ts --apply
 *
 * VARFÖR DE SAKNAS: auto-importen tar bilden ur FEEDEN, och butikernas kategori-
 * feed bär inte alltid en. Produktens EGEN sida gör det nästan alltid (mätt
 * 2026-08-07: 18 av 19 bildlösa hade en og:image), och för fem av dem fanns
 * dessutom en Cardmarket-render som aldrig applicerats.
 *
 * ORDNING: Cardmarket-render först (ren produktbild mot vit bakgrund, samma proxy
 * som resten av katalogen), annars butikens og:image. En butiksbild är bättre än
 * ingen bild — men sämre än CM:s, som är enhetligt beskuren.
 */
import { prisma } from "../src/lib/db";
import { cmImageProxyUrl, cmRenderExists } from "../src/lib/cm-image";

const APPLY = process.argv.includes("--apply");
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36";

/** og:image från butikens produktsida. Null när sidan inte svarar eller saknar bild. */
async function storeImage(url: string): Promise<string | null> {
  try {
    const r = await fetch(url, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(20000) });
    if (!r.ok) return null;
    const html = await r.text();
    const og =
      html.match(/property="og:image"\s+content="([^"]+)"/)?.[1] ??
      html.match(/content="([^"]+)"\s+property="og:image"/)?.[1];
    if (!og) return null;
    // ⛔ Bara absoluta http(s)-URL:er. En relativ sökväg hade blivit en trasig bild
    //    på vår domän, vilket ser värre ut än ingen bild alls.
    return /^https?:\/\//.test(og) ? og : null;
  } catch {
    return null;
  }
}

async function main() {
  const products = await prisma.product.findMany({
    where: { imageUrl: null, category: { notIn: ["SINGLE_CARD", "GRADED_CARD"] } },
    select: {
      id: true,
      title: true,
      offers: { select: { url: true, retailer: { select: { name: true } } } },
    },
  });
  console.log(`Bildlösa produkter: ${products.length}\n`);

  let fixed = 0;
  for (const p of products) {
    let image: string | null = null;
    let via = "";

    const cmUrl = p.offers.find((o) => /cardmarket/i.test(o.retailer.name))?.url;
    const idProduct = cmUrl?.match(/idProduct=(\d+)/)?.[1];
    if (idProduct && (await cmRenderExists(idProduct))) {
      image = cmImageProxyUrl(idProduct);
      via = `Cardmarket-render (${idProduct})`;
    }

    if (!image) {
      for (const o of p.offers) {
        // Marknadsplatser hoppas över: en Tradera-annons bild är säljarens foto av
        // ETT exemplar, inte produktbilden.
        if (!o.url || /cardmarket|tradera/i.test(o.retailer.name)) continue;
        const img = await storeImage(o.url);
        if (img) {
          image = img;
          via = `${o.retailer.name} (og:image)`;
          break;
        }
      }
    }

    if (!image) {
      console.log(`   ingen bild hittad   ${p.title}`);
      continue;
    }
    console.log(`   ${via.padEnd(28)} ${p.title}`);
    if (APPLY) {
      await prisma.product.update({ where: { id: p.id }, data: { imageUrl: image } });
      fixed++;
    }
  }
  console.log(APPLY ? `\nUppdaterade: ${fixed}` : "\nTorrkörning — inget skrevs. Lägg till --apply.");
}

main().finally(() => prisma.$disconnect());
