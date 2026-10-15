/**
 * SETBRICKOR FÖR SET UTAN LOGOTYP (2026-10-15, ägaren: "många set har inga bilder").
 *
 * World Championship Decks, tränarkit, Battle Academy, McDonald's-, Prize Pack-utan-logga,
 * temadäckens stämplar m.fl. har ingen officiell setlogotyp hos någon källa vi har (TCGdex,
 * pokemontcg.io, leverantören, CardTrader — kontrollerat). I stället ritas en bricka av setets
 * tre dyraste kort i solfjäder på transparent botten (WebP, ~20 kB), en gång, med sharp — incheckade filer i
 * public/set-logos/generated/ precis som de japanska logotyperna. Ingen runtime-kostnad.
 *
 *   node scripts/with-prod-db.mjs npx tsx scripts/generate-set-tiles.ts           # torrkörning
 *   node scripts/with-prod-db.mjs npx tsx scripts/generate-set-tiles.ts --apply   # ritar + sätter logoUrl
 */
import * as fs from "fs";
import * as path from "path";
import sharp from "sharp";
import { prisma } from "@/lib/db";
import { exitJob } from "@/lib/job-exit";

const OUT_DIR = path.join(process.cwd(), "public", "set-logos", "generated");
const SITE = "https://scoutr.se";
const W = 420, H = 180, CARD_H = 160, CARD_W = Math.round(CARD_H * 0.716);

async function fetchImage(url: string): Promise<Buffer | null> {
  const abs = url.startsWith("/") ? SITE + url : url;
  try {
    const r = await fetch(abs, { signal: AbortSignal.timeout(15_000) });
    if (!r.ok) return null;
    return Buffer.from(await r.arrayBuffer());
  } catch {
    return null;
  }
}

async function tile(images: Buffer[]): Promise<Buffer> {
  const angles = images.length === 1 ? [0] : images.length === 2 ? [-7, 7] : [-11, 0, 11];
  const layers = await Promise.all(
    images.map(async (img, i) => {
      const card = await sharp(img).resize(CARD_W, CARD_H, { fit: "cover" }).png().toBuffer();
      const rotated = await sharp(card).rotate(angles[i], { background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
      const meta = await sharp(rotated).metadata();
      const spread = images.length === 1 ? 0 : 92;
      const cx = W / 2 + (i - (images.length - 1) / 2) * spread;
      return {
        input: rotated,
        left: Math.max(0, Math.round(cx - (meta.width ?? CARD_W) / 2)),
        top: Math.max(0, Math.round(H / 2 - (meta.height ?? CARD_H) / 2) + (i === 1 && images.length === 3 ? -4 : 4)),
      };
    })
  );
  // Mittkortet sist = överst.
  const order = layers.length === 3 ? [layers[0], layers[2], layers[1]] : layers;
  return sharp({ create: { width: W, height: H, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite(order)
    .webp({ quality: 80, alphaQuality: 90 })
    .toBuffer();
}

async function main() {
  const apply = process.argv.includes("--apply");
  const sets = await prisma.cardSet.findMany({
    // --regen ritar också om våra egna brickor (t.ex. efter nya kort i setet).
    where: { OR: [{ logoUrl: null }, { logoUrl: "" }, ...(process.argv.includes("--regen") ? [{ logoUrl: { startsWith: "/set-logos/generated/" } }] : [])] },
    select: { id: true, name: true },
  });
  console.log(`${sets.length} set utan logotyp.`);
  if (apply) fs.mkdirSync(OUT_DIR, { recursive: true });
  let made = 0;
  for (const s of sets) {
    const cards = await prisma.product.findMany({
      where: { setId: s.id, category: "SINGLE_CARD", imageUrl: { not: null } },
      orderBy: [{ lowestPriceOre: { sort: "desc", nulls: "last" } }],
      select: { imageUrl: true },
      take: 8,
    });
    const imgs: Buffer[] = [];
    for (const c of cards) {
      if (imgs.length >= 3) break;
      const b = await fetchImage(c.imageUrl!);
      if (b) imgs.push(b);
    }
    if (imgs.length === 0) {
      console.log(`  – ${s.name}: inga kortbilder`);
      continue;
    }
    made++;
    if (!apply) {
      console.log(`  + ${s.name} (${imgs.length} kort)`);
      continue;
    }
    const file = `${s.id}.webp`;
    fs.writeFileSync(path.join(OUT_DIR, file), await tile(imgs));
    await prisma.cardSet.update({ where: { id: s.id }, data: { logoUrl: `/set-logos/generated/${file}` } });
  }
  console.log(`${made} brickor ${apply ? "ritade" : "att rita"}.`);
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => exitJob());
