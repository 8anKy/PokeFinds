/**
 * Genererar Foilio PWA-/app-ikoner från varumärkesmärket.
 * Kör: node scripts/generate-icons.mjs  (eller npm run icons:gen)
 *
 * Källa = public/brand/foilio-logo.png (transparent). Märket centreras på en
 * vit, rundad-säker yta så att BÅDA löv-tonerna syns (den mörkgröna delen
 * försvinner mot nära-svart). Uppdatera källfilen och kör om för ny ikon.
 */
import sharp from "sharp";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(root, "public", "brand", "foilio-logo.png");
const TILE = "#ffffff";

const targets = [
  [512, "icon-512.png", 0.66],
  [192, "icon-192.png", 0.66],
  [180, "apple-icon.png", 0.7], // iOS apple-touch-icon
  [64, "favicon-32.png", 0.78], // webbläsarflik
];

for (const [size, name, ratio] of targets) {
  const inner = Math.round(size * ratio);
  const off = Math.round((size - inner) / 2);
  const mark = await sharp(SRC)
    .resize(inner, inner, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
  await sharp({ create: { width: size, height: size, channels: 4, background: TILE } })
    .composite([{ input: mark, left: off, top: off }])
    .png()
    .toFile(join(root, "public", name));
  console.log(`✓ public/${name} (${size}×${size})`);
}
