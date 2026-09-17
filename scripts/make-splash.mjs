/**
 * Bygger assets/splash.png (+ splash-dark.png) ur vektormärket public/brand/foilio-mark.svg.
 *   node scripts/make-splash.mjs            # märket 300 px brett på 2732×2732 (ägarval 2026-09-17)
 *   node scripts/make-splash.mjs 380        # annan bredd
 * Mörk yta #0a0a0c med grön radiell glöd; Codemagics capacitor-assets skalar sedan till alla
 * iOS-storlekar (CENTER_CROP ⇒ märket blir ~300/2732 av kortsidan). ⛔ Rendera aldrig ur
 * PNG-märkena — de är rasteruppskalningar och blir suddiga (det var så det såg ut till 09-17).
 */
import sharp from "sharp";
import { readFileSync, copyFileSync } from "node:fs";
const S = 2732;
const W = Number(process.argv[2] ?? 300);
const svg = readFileSync("public/brand/foilio-mark.svg");
const glow = Buffer.from(
  `<svg width="${S}" height="${S}"><defs><radialGradient id="g" cx="50%" cy="50%" r="42%"><stop offset="0" stop-color="#0f241d"/><stop offset="1" stop-color="#0a0a0c"/></radialGradient></defs><rect width="${S}" height="${S}" fill="url(#g)"/></svg>`
);
const mark = await sharp(svg).resize(W).png().toBuffer();
const { height } = await sharp(mark).metadata();
await sharp(glow)
  .composite([{ input: mark, left: Math.round((S - W) / 2), top: Math.round((S - height) / 2) }])
  .png({ compressionLevel: 9 })
  .toFile("assets/splash.png");
copyFileSync("assets/splash.png", "assets/splash-dark.png");
console.log(`assets/splash.png: märket ${W}×${height} px på ${S}×${S}`);
