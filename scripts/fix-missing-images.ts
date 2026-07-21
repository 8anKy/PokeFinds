/**
 * Hittar (och lagar) produkter vars bild inte laddar.
 *
 * Två felkällor, båda ger en trasig <img> i katalogen:
 *  A) `/api/cm-image/{idProduct}` — Cardmarket har INGEN render för id:t (mycket vanligt
 *     på blistrar/checklanes/pin-collections) eller har lagt den i en okänd bucket.
 *  B) `images.tcggo.com`-hotlink som svarar 403 eller en ~919 bytes placeholder.
 *
 * Ersättare i prioritetsordning:
 *  1. RapidAPI:s sealed-katalog (diskcachen `.cache/rapidapi-sealed.json`, INGA API-anrop)
 *     → `image` för produktens cardmarket_id. Samma transparenta render som CM, men på
 *     tcggo:s CDN som INTE referer-gatear → funkar som rå <img src>.
 *  2. Butiksfoto: StoreListing på samma URL som en av produktens offers.
 *  3. Tradera-annonsens foto.
 *  4. null → kategori-ikonen visas. En trasig bild är alltid sämre än ikonen.
 *
 * Torrkörning som default. `--apply` skriver. `--from-cache` hoppar probningen och
 * använder listan från förra körningen (probningen tar ~25 min för hela katalogen).
 *
 *   node scripts/with-prod-db.mjs npx tsx scripts/fix-missing-images.ts
 *   node scripts/with-prod-db.mjs npx tsx scripts/fix-missing-images.ts --apply
 */
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { mapPool } from "../src/lib/concurrency";
import { cmRenderExists } from "../src/lib/cm-image";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");
const FROM_CACHE = process.argv.includes("--from-cache");

const BROKEN_CACHE = path.join(process.cwd(), ".cache", "broken-images.json");
const SEALED_CATALOG = path.join(process.cwd(), ".cache", "rapidapi-sealed.json");

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
/** tcggo svarar 200 med en pytteliten placeholder när bilden inte finns. */
const PLACEHOLDER_MAX_BYTES = 2000;

/** Laddar bilden på riktigt (403 eller placeholder = trasig)? */
async function imageLoads(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { headers: { "user-agent": UA } });
    if (!res.ok) return false;
    return (await res.arrayBuffer()).byteLength >= PLACEHOLDER_MAX_BYTES;
  } catch {
    return false;
  }
}

/** cardmarket_id → transparent produktbild, ur RapidAPI-katalogens diskcache. */
function loadSealedImages(): Map<number, string> {
  const map = new Map<number, string>();
  if (!fs.existsSync(SEALED_CATALOG)) {
    console.warn(`  (${SEALED_CATALOG} saknas — hoppar RapidAPI-bildkällan)`);
    return map;
  }
  const rows = JSON.parse(fs.readFileSync(SEALED_CATALOG, "utf-8")) as {
    cardmarket_id: number | null;
    image?: string;
  }[];
  for (const r of rows) if (r.cardmarket_id && r.image) map.set(r.cardmarket_id, r.image);
  return map;
}

const idFromProxy = (url: string): string | null =>
  url.includes("/api/cm-image/") ? url.split("/api/cm-image/")[1].split(/[?#]/)[0] : null;
const idFromCmOffer = (url: string): string | null =>
  /[?&]idProduct=(\d+)/i.exec(url)?.[1] ?? null;

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

  let brokenIds: string[];
  if (FROM_CACHE && fs.existsSync(BROKEN_CACHE)) {
    brokenIds = JSON.parse(fs.readFileSync(BROKEN_CACHE, "utf-8")) as string[];
    console.log(`Läser ${brokenIds.length} trasiga från ${BROKEN_CACHE} (ingen probning).`);
  } else {
    const broken: string[] = [];
    let done = 0;
    const tick = (n: number) => {
      if (++done % 100 === 0) console.log(`  …${done}/${n} probade, ${broken.length} trasiga`);
    };
    await mapPool(cm, 24, async (p) => {
      const id = idFromProxy(p.imageUrl!)!;
      if (!(await cmRenderExists(id))) broken.push(p.id);
      tick(cm.length);
    });
    console.log(`[A] cm-proxy utan render: ${broken.length}`);
    done = 0;
    await mapPool(tcggo, 24, async (p) => {
      if (!(await imageLoads(p.imageUrl!))) broken.push(p.id);
      tick(tcggo.length);
    });
    console.log(`[B] totalt trasiga: ${broken.length}`);
    fs.mkdirSync(path.dirname(BROKEN_CACHE), { recursive: true });
    fs.writeFileSync(BROKEN_CACHE, JSON.stringify(broken));
    brokenIds = broken;
  }

  if (brokenIds.length === 0) {
    console.log("Inga trasiga bilder. Klart.");
    return;
  }

  const byId = new Map(prods.map((p) => [p.id, p]));
  const sealedImages = loadSealedImages();
  const stats = { rapidapi: 0, store: 0, tradera: 0, cleared: 0 };

  for (const productId of brokenIds) {
    const p = byId.get(productId);
    if (!p) continue; // borttagen sedan probningen

    const offers = await prisma.offer.findMany({
      where: { productId: p.id },
      select: { url: true },
    });
    // idProduct kan komma från proxy-URL:en ELLER från produktens Cardmarket-offer.
    const cmId =
      idFromProxy(p.imageUrl!) ??
      offers.map((o) => idFromCmOffer(o.url)).find((v): v is string => v != null) ??
      null;

    let replacement: string | null = null;
    let via = "";
    const fromCatalog = cmId ? sealedImages.get(Number(cmId)) : undefined;
    if (fromCatalog && (await imageLoads(fromCatalog))) {
      replacement = fromCatalog;
      via = "rapidapi";
      stats.rapidapi++;
    } else {
      const listing = offers.length
        ? await prisma.storeListing.findFirst({
            where: { url: { in: offers.map((o) => o.url) }, imageUrl: { not: null } },
            select: { imageUrl: true },
          })
        : null;
      if (listing?.imageUrl) {
        replacement = listing.imageUrl;
        via = "butik";
        stats.store++;
      } else {
        const tr = await prisma.traderaListing.findFirst({
          where: { productId: p.id, imageUrl: { not: null } },
          select: { imageUrl: true },
        });
        if (tr?.imageUrl) {
          replacement = tr.imageUrl;
          via = "tradera";
          stats.tradera++;
        } else {
          stats.cleared++;
        }
      }
    }

    console.log(
      `  ${replacement ? `→ ${via.padEnd(8)}` : "→ NOLLA   "} ${p.category.padEnd(14)} ${p.title}` +
        `\n      var: ${p.imageUrl}` +
        (replacement ? `\n      ny:  ${replacement}` : "") +
        `\n      /produkter/${p.slug}`
    );
    if (APPLY)
      await prisma.product.update({ where: { id: p.id }, data: { imageUrl: replacement } });
  }

  console.log(
    `\nSummering: ${brokenIds.length} trasiga — ${stats.rapidapi} RapidAPI-render, ` +
      `${stats.store} butiksfoto, ${stats.tradera} Tradera-foto, ` +
      `${stats.cleared} nollade (kategori-ikon).${APPLY ? " SKRIVET." : " Torrkörning."}`
  );
}

main().finally(() => prisma.$disconnect());
