/**
 * LÄK SEALED-BILDER: saknad bild eller butiksfoto (vit bakgrund) → Cardmarkets egen render.
 *
 * Ägarens rapport 2026-10-05: katalogkort helt utan bild (Fall 2025 Collector Chest,
 * Pitch Black: Gengar Enhanced 2-Pack Blister) och kort med butiksfoto på vit platta
 * (Rival Battle Decks, Mega Battle Deck) mitt bland friställda renders.
 *
 * VARFÖR DE FASTNADE: självläkningen i cardmarket-refresh byter bara till CM-proxyn när
 * PRISLEVERANTÖRENS rad bär en bild (`best.image`) och matchningen är exakt. Produkter
 * vars CM-länk kommer från CM:s gratiskatalog, butikskopplingen eller ett skript har
 * ingen sådan rad — de behöll butiksfotot eller ingenting. Mätt: 41 utan bild + 44
 * butiksfoton bland synliga sealed, 73 av dem med ett känt idProduct.
 *
 * REGEL: CM:s render (friställd PNG, samma som resten av katalogen) via vår proxy, men
 * BARA när CDN:en bekräftar att den finns (`cmRenderExists`) — annars hade en trasig
 * <img> ersatt ett fungerande foto (incidenten 2026-07-21). Ett butiksfoto ersätts aldrig
 * med ingenting. Saknas render helt och produkten har ingen bild får den butiksannonsens
 * bild som reserv: en vit platta är bättre än en tom ruta.
 * Absoluta "https://www.foilio.se/api/cm-image/X" skrivs relativa (www 301:ar till apex).
 *
 *   node scripts/with-prod-db.mjs npx tsx scripts/heal-sealed-images.ts          # torrkörning
 *   node scripts/with-prod-db.mjs npx tsx scripts/heal-sealed-images.ts --apply
 * Körs även nattligen som steg i cardmarket-refresh.yml (idempotent, konvergerar).
 */
import { prisma } from "../src/lib/db";
import { cmImageProxyUrl, cmRenderExists } from "../src/lib/cm-image";
import { mapPool } from "../src/lib/concurrency";

const APPLY = process.argv.includes("--apply");

const isGoodImage = (url: string | null) =>
  !!url && (url.startsWith("/api/cm-image/") || url.includes("images.tcggo.com"));

async function main() {
  const cm = await prisma.retailer.findFirst({ where: { name: "Cardmarket" }, select: { id: true } });
  if (!cm) throw new Error("Ingen Cardmarket-retailer");

  // 1. Absoluta proxy-URL:er → relativa.
  const absolute = await prisma.product.findMany({
    where: { imageUrl: { contains: "foilio.se/api/cm-image/" } },
    select: { id: true, imageUrl: true },
  });
  console.log(`Absoluta proxy-URL:er: ${absolute.length}`);
  if (APPLY)
    await mapPool(absolute, 8, async (p) => {
      await prisma.product.update({ where: { id: p.id }, data: { imageUrl: p.imageUrl!.replace(/^https?:\/\/[^/]+/, "") } });
    });

  // 2. Sealed utan bra bild.
  const candidates = (
    await prisma.product.findMany({
      where: { hiddenAt: null, category: { not: "SINGLE_CARD" } },
      select: {
        id: true, title: true, imageUrl: true,
        offers: { where: { retailerId: cm.id }, select: { url: true } },
        storeListings: { where: { imageUrl: { not: null } }, select: { imageUrl: true }, take: 1 },
      },
    })
  ).filter((p) => !isGoodImage(p.imageUrl) && !p.imageUrl?.includes("foilio.se/api/cm-image/"));

  let toRender = 0, toListing = 0, left = 0;
  await mapPool(candidates, 4, async (p) => {
    const id = p.offers.map((o) => Number(o.url.match(/idProduct=(\d+)/)?.[1])).find((n) => Number.isFinite(n));
    let next: string | null = null;
    if (id != null && (await cmRenderExists(id))) { next = cmImageProxyUrl(id); toRender++; }
    else if (!p.imageUrl && p.storeListings[0]?.imageUrl) { next = p.storeListings[0].imageUrl; toListing++; }
    else { left++; console.log(`  – kvar: ${p.title} (${p.imageUrl ? "butiksfoto" : "ingen bild"}${id == null ? ", inget CM-id" : ", ingen CM-render"})`); return; }
    console.log(`  ✔ ${p.title}: ${p.imageUrl ?? "(ingen)"} → ${next}`);
    if (APPLY) await prisma.product.update({ where: { id: p.id }, data: { imageUrl: next } });
  });
  console.log(`\nCM-render: ${toRender}, butiksbild som reserv: ${toListing}, kvar: ${left}${APPLY ? "" : "  (TORRKÖRNING — --apply)"}`);
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
