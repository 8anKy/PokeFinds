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
 *   SWEEP=1 …   # sveper bakgrundsfyllningens toleranssteg. Det var svepet som
 *               # visade att INGEN tröskel i den gamla färgavstånds-modellen
 *               # kunde ge alla sex korten i fångsten 08-01 — felet satt i
 *               # modellen, inte i talet.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Prisma, PrismaClient } from "@prisma/client";
import sharp from "sharp";
import { detectCardRegions, type RegionDiag } from "../src/lib/card-quad";

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
    const d = row.result as { v?: number; found?: number; image?: string; video?: string };
    if (d?.v !== 2 || !d.image) continue;
    const b64 = d.image.replace(/^data:image\/jpeg;base64,/, "");
    const jpeg = Buffer.from(b64, "base64");
    const stamp = row.createdAt.toISOString().slice(5, 19).replace(/[:T]/g, "-");
    const base = path.join(OUT, `${stamp}-${row.id.slice(-6)}`);
    writeFileSync(`${base}.jpg`, jpeg);

    const raw = await sharp(jpeg).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const { width: w, height: h } = raw.info;
    const diag: RegionDiag = {};
    const regions = detectCardRegions(raw.data, w, h, 3, 12, diag);

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
        ` ${diag.busySurface ? "[UNDERLAG!]" : ""} · kamera ${d.video ?? "?"} · tolerans ${diag.tol} · bakgrunden tog ${((diag.backgroundFrac ?? 0) * 100).toFixed(0)} % av bilden` +
        `  → ${path.relative(process.cwd(), base)}-regions.png`
    );

    for (const r of regions) {
      console.log(
        `      ${String(Math.round(r.x)).padStart(3)},${String(Math.round(r.y)).padStart(3)}` +
          `  ${Math.round(r.w)}x${Math.round(r.h)}  (form ${(r.w / r.h).toFixed(2)})`
      );
    }

    // FÖRKASTADE blobbar med skäl. Ett saknat kort syns antingen HÄR (en blob
    // föll på ett filter → justera filtret) eller inte alls (fyllningen åt upp
    // kortkanten → toleransen/masken, kör SWEEP=1). De två kräver motsatta
    // åtgärder och gick inte att skilja åt innan skälen bokfördes.
    const rej = (diag.rejections ?? []).filter((r) => r.areaFrac >= 0.005);
    if (rej.length) {
      console.log(`      — förkastade (≥0,5 % av bilden):`);
      for (const r of rej.sort((a, b) => b.areaFrac - a.areaFrac)) {
        console.log(
          `      ${String(r.x).padStart(3)},${String(r.y).padStart(3)}` +
            `  ${r.w}x${r.h}  ${(r.areaFrac * 100).toFixed(1)} %  form ${r.aspect.toFixed(2)}` +
            `  fyllnad ${r.fill.toFixed(2)}  → ${r.reason}`
        );
      }
    }

    // SVEPET: samma produktionskod vid en stege av toleranser. Nära 100 %
    // bakgrund = fyllningen har LÄCKT in i korten (då försvinner HELA kort);
    // låg andel = ådringen stoppade fyllningen och bordet blev förgrund.
    if (process.env.SWEEP === "1") {
      for (const t of [8, 12, 16, 22, 30, 40]) {
        const dg: RegionDiag = {};
        const r = detectCardRegions(raw.data, w, h, 3, 20, dg, t);
        console.log(
          `    TOL=${String(t).padStart(2)} → ${String(r.length).padStart(2)} regioner` +
            ` (bakgrund ${((dg.backgroundFrac ?? 0) * 100).toFixed(0)} %)`
        );
      }
    }
  }
}

main().finally(() => prisma.$disconnect());
