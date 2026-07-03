/**
 * READ-ONLY hygien-verktyg: flaggar Tradera-offers på ENGELSKA produkter där
 * annonsens titel (= URL-sluggen) bär en japansk/asiatisk språkmarkör. Fångar fall
 * som språkvakten i matchningen missar när säljaren skriver "japansk" bara i
 * BESKRIVNINGEN (som vi inte hämtar) men titeln ser engelsk ut.
 *
 * Signal (ingen Tradera-API, ingen Neon-last utöver en läsning): Tradera-URL:en är
 * `/item/<kat>/<id>/<slug>` där slug = annonstiteln. Vi läser bara den.
 *
 *   npx tsx scripts/flag-jp-mismatches.ts        # rapport mot prod
 *
 * Granska träffarna manuellt och nollställ bekräftat fel per offer-ID (INTE per URL —
 * en URL kan spänna flera produkter). Kör efter tradera-svepet vid behov. Nya
 * kollisions-set (japanska namn som delar ord med engelska) → lägg till i JP_MARKERS
 * här OCH i matching.ts (JP_SET_MARKERS) så de inte återskapas.
 */
import * as fs from "fs"; import * as path from "path";
const envPath = path.join(process.cwd(), ".env");
if (fs.existsSync(envPath)) for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
  const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.+?)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
if (process.env.TARGET !== "local" && process.env.NEON_DATABASE_URL) process.env.DATABASE_URL = process.env.NEON_DATABASE_URL;
import { prisma } from "../src/lib/db";

// Japanska/asiatiska markörer + de JP-basset ("Scarlet ex"/"Violet ex") som delar
// ord med engelska "Scarlet & Violet". Håll i synk med matching.ts.
const JP_MARKERS: RegExp[] = [
  /\bjapan(sk|ese)?\b/i,
  /-jp-|-jpn-|\bjp\b/i,
  /\bkinesisk\w*|\bchinese\b|\bkorean\w*|\bkoreansk\w*/i,
  /\bviolet ex\b|\bscarlet ex\b/i,
];

function slugText(url: string): string {
  const m = url.match(/\/item\/\d+\/\d+\/([^?#]+)/);
  return decodeURIComponent(m?.[1] ?? "").replace(/-/g, " ");
}

(async () => {
  const tradera = await prisma.retailer.findFirstOrThrow({ where: { name: "Tradera" } });
  const offers = await prisma.offer.findMany({
    where: { retailerId: tradera.id, price: { not: null }, product: { language: "EN" } },
    select: { id: true, url: true, price: true, product: { select: { title: true } } },
  });

  const flagged = offers.filter((o) => JP_MARKERS.some((re) => re.test(slugText(o.url))));
  console.log(`Prissatta Tradera-offers på EN-produkter: ${offers.length} · flaggade: ${flagged.length}\n`);
  for (const f of flagged) {
    console.log(`  "${f.product.title}"  (${f.price! / 100} kr)  offerId: ${f.id}\n      annons: ${slugText(f.url)}`);
  }
  if (flagged.length === 0) console.log("  ✅ Inga språk-felmatchningar.");
  await prisma.$disconnect();
})();
