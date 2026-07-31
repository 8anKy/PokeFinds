/**
 * BULK-FELSÖKNING — hämtar admins VERKLIGA bordsfångster (detekteringsbilden
 * som sparas av /api/scanner/identify-bulk) och kör detectCardRegions offline:
 * skriver originalbilden + en overlay-PNG med funna regioner till
 * .spike/bulk-debug/ så detektorns beteende kan granskas mot verkligheten och
 * varje tröskeländring valideras mot samma foton igen.
 *
 * Syntetiska tester räcker inte här — ägarens andra fältrunda (6 kort → 2
 * funna) var grön i syntetiken. Riktiga bord har ådring, skuggor, ojämnt ljus
 * och perspektiv som modellerna missar.
 *
 *   node scripts/with-prod-db.mjs npx tsx scripts/bulk-debug.ts
 *   TAKE=10 …
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Prisma, PrismaClient } from "@prisma/client";
import sharp from "sharp";
import { detectCardRegions } from "../src/lib/card-quad";

const prisma = new PrismaClient();
const TAKE = Number(process.env.TAKE ?? "6");
const OUT = path.join(__dirname, "..", ".spike", "bulk-debug");

async function main() {
  const rows = await prisma.scannerJob.findMany({
    where: { imageUrl: "bulk-debug", NOT: { result: { equals: Prisma.DbNull } } },
    orderBy: { createdAt: "desc" },
    take: TAKE,
    select: { id: true, createdAt: true, result: true },
  });
  if (rows.length === 0) {
    console.log("Inga bulk-debugrader — gör en bulk-skanning som admin först.");
    return;
  }
  mkdirSync(OUT, { recursive: true });

  for (const row of rows) {
    const d = row.result as { v?: number; found?: number; image?: string };
    if (d?.v !== 2 || !d.image) continue;
    const b64 = d.image.replace(/^data:image\/jpeg;base64,/, "");
    const jpeg = Buffer.from(b64, "base64");
    const stamp = row.createdAt.toISOString().slice(5, 19).replace(/[:T]/g, "-");
    const base = path.join(OUT, `${stamp}-${row.id.slice(-6)}`);
    writeFileSync(`${base}.jpg`, jpeg);

    const raw = await sharp(jpeg).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const { width: w, height: h } = raw.info;
    const regions = detectCardRegions(raw.data, w, h, 3, 12);

    // Overlay: gröna ramar där DAGENS kod hittar kort (kan skilja sig från
    // `found` om detektorn ändrats sedan fångsten — det är hela poängen).
    const px = Buffer.from(raw.data);
    const mark = (x: number, y: number) => {
      if (x < 0 || y < 0 || x >= w || y >= h) return;
      const i = (y * w + x) * 3;
      px[i] = 0;
      px[i + 1] = 255;
      px[i + 2] = 100;
    };
    for (const r of regions) {
      const x0 = Math.round(r.x);
      const y0 = Math.round(r.y);
      const x1 = Math.round(r.x + r.w);
      const y1 = Math.round(r.y + r.h);
      for (let x = x0; x <= x1; x++) {
        for (let t = 0; t < 2; t++) {
          mark(x, y0 + t);
          mark(x, y1 - t);
        }
      }
      for (let y = y0; y <= y1; y++) {
        for (let t = 0; t < 2; t++) {
          mark(x0 + t, y);
          mark(x1 - t, y);
        }
      }
    }
    await sharp(px, { raw: { width: w, height: h, channels: 3 } })
      .png()
      .toFile(`${base}-regions.png`);

    console.log(
      `${stamp} ${row.id.slice(-6)}: fångsten fann ${d.found ?? "?"} · DAGENS kod finner ${regions.length}` +
        `  → ${path.relative(process.cwd(), base)}-regions.png`
    );
  }
}

main().finally(() => prisma.$disconnect());
