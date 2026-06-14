/**
 * Rasteriserar public/icon.svg → PNG-ikoner som PWA-manifestet och iOS kräver.
 * Kör: node scripts/generate-icons.mjs  (eller npm run icons:gen)
 *
 * Källa = public/icon.svg (uppdatera den och kör om för ny ikon). Densiteten
 * skalas mot målstorleken så vektorn renderas skarpt vid varje upplösning.
 */
import sharp from "sharp";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const svg = readFileSync(join(root, "public", "icon.svg"));

const VIEWBOX = 128; // matchar viewBox i icon.svg
const targets = [
  [192, "icon-192.png"],
  [512, "icon-512.png"],
  [180, "apple-icon.png"], // iOS apple-touch-icon
];

for (const [size, name] of targets) {
  await sharp(svg, { density: Math.ceil((72 * size) / VIEWBOX) })
    .resize(size, size)
    .png()
    .toFile(join(root, "public", name));
  console.log(`✓ public/${name} (${size}×${size})`);
}
