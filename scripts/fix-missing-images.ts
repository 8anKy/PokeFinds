/**
 * Hittar (och lagar) produkter vars bild inte laddar.
 *
 * Två felkällor, båda ger en trasig <img> i katalogen:
 *  A) `/api/cm-image/{idProduct}` — Cardmarket har INGEN render för id:t (vanligt på
 *     blistrar/checklanes) eller har lagt den i en okänd bucket. Proxyn 404:ar.
 *  B) `images.tcggo.com`-hotlink — svarar 403 eller en ~919 bytes placeholder.
 *
 * Lagningen är i tur och ordning: butiksfoto (StoreListing på samma URL som en av
 * produktens offers) → Tradera-annonsens foto → null (kategori-ikonen visas i stället).
 * En trasig bild är alltid sämre än ikonen — den ser ut som en bugg för besökaren.
 *
 * Torrkörning som default. `--apply` skriver.
 *
 *   node scripts/with-prod-db.mjs npx tsx scripts/fix-missing-images.ts
 *   node scripts/with-prod-db.mjs npx tsx scripts/fix-missing-images.ts --apply
 */
import { PrismaClient } from "@prisma/client";
import { mapPool } from "../src/lib/concurrency";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");

// Samma lista som proxyn (src/app/api/cm-image/[idProduct]/route.ts). Håll i synk.
const SHARDS = [53, 52, 54, 1014, 1015, 1016, 1017, 1018, 51, 55, 50, 56, 57, 58];
const EXTS = ["png", "jpg"];
const REFERER = "https://www.cardmarket.com/";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
/** tcggo svarar 200 med en pytteliten placeholder när bilden inte finns. */
const PLACEHOLDER_MAX_BYTES = 2000;

async function ok(url: string, method: "HEAD" | "GET" = "HEAD"): Promise<boolean> {
  try {
    const res = await fetch(url, { method, headers: { referer: REFERER, "user-agent": UA } });
    return res.ok;
  } catch {
    return false;
  }
}

/** Har Cardmarket en render för id:t i någon känd bucket? */
async function cmRenderExists(id: string): Promise<boolean> {
  for (const shard of SHARDS)
    for (const ext of EXTS)
      if (await ok(`https://product-images.s3.cardmarket.com/${shard}/${id}/${id}.${ext}`))
        return true;
  return false;
}

/** Laddar tcggo-hotlinken riktigt (403 eller placeholder = trasig)? */
async function tcggoOk(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { headers: { "user-agent": UA } });
    if (!res.ok) return false;
    const buf = await res.arrayBuffer();
    return buf.byteLength >= PLACEHOLDER_MAX_BYTES;
  } catch {
    return false;
  }
}

async function main() {
  const prods = await prisma.product.findMany({
    where: { imageUrl: { not: null } },
    select: { id: true, title: true, slug: true, imageUrl: true, category: true },
  });
  const cm = prods.filter((p) => p.imageUrl!.includes("/api/cm-image/"));
  const tcggo = prods.filter((p) => p.imageUrl!.includes("images.tcggo.com"));
  console.log(
    `${prods.length} produkter med bild — ${cm.length} cm-proxy, ${tcggo.length} tcggo-hotlink.` +
      `${APPLY ? "" : "  (TORRKÖRNING — inget skrivs)"}`
  );

  const broken: typeof prods = [];
  let done = 0;
  const tick = (n: number) => {
    if (++done % 100 === 0) console.log(`  …${done}/${n} probade, ${broken.length} trasiga`);
  };

  await mapPool(cm, 24, async (p) => {
    const id = p.imageUrl!.split("/api/cm-image/")[1].split(/[?#]/)[0];
    if (!(await cmRenderExists(id))) broken.push(p);
    tick(cm.length);
  });
  console.log(`[A] cm-proxy utan render: ${broken.length}`);

  done = 0;
  const brokenTcggo: typeof prods = [];
  await mapPool(tcggo, 24, async (p) => {
    if (!(await tcggoOk(p.imageUrl!))) brokenTcggo.push(p);
    tick(tcggo.length);
  });
  console.log(`[B] trasiga tcggo-hotlinks: ${brokenTcggo.length}`);

  const all = [...broken, ...brokenTcggo];
  if (all.length === 0) {
    console.log("Inga trasiga bilder. Klart.");
    return;
  }

  // Ersättare: butiksfoto från huvudboken (samma URL som en offer), annars Tradera-foto.
  let fixedStore = 0;
  let cleared = 0;
  for (const p of all) {
    const offers = await prisma.offer.findMany({
      where: { productId: p.id },
      select: { url: true },
    });
    const urls = offers.map((o) => o.url);
    const listing = urls.length
      ? await prisma.storeListing.findFirst({
          where: { url: { in: urls }, imageUrl: { not: null } },
          select: { imageUrl: true },
        })
      : null;
    const tradera = listing
      ? null
      : await prisma.traderaListing.findFirst({
          where: { productId: p.id, imageUrl: { not: null } },
          select: { imageUrl: true },
        });
    const replacement = listing?.imageUrl ?? tradera?.imageUrl ?? null;

    console.log(
      `  ${replacement ? "→ ERSÄTT " : "→ NOLLA  "} ${p.category.padEnd(14)} ${p.title}` +
        `\n      var: ${p.imageUrl}` +
        (replacement ? `\n      ny:  ${replacement}` : "") +
        `\n      /produkter/${p.slug}`
    );
    if (replacement) fixedStore++;
    else cleared++;
    if (APPLY)
      await prisma.product.update({ where: { id: p.id }, data: { imageUrl: replacement } });
  }

  console.log(
    `\nSummering: ${all.length} trasiga — ${fixedStore} fick butiks-/Tradera-foto, ` +
      `${cleared} nollades (kategori-ikon visas).${APPLY ? " SKRIVET." : " Torrkörning."}`
  );
}

main().finally(() => prisma.$disconnect());
