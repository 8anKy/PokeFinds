/**
 * READ-ONLY hygien-verktyg: flaggar misstänkt FELMATCHADE butiks-offers på sealed-
 * produkter — där butikens produkt-URL inte hör ihop med produkten. Fångar fall
 * som pris-vakten (clean-mismatched-offers.ts) missar: rätt prisnivå men FEL produkt.
 *
 * Signal: produktens särskiljande identitetsord (Pokémon-/set-namn) saknas HELT i
 * URL-slugen. Bara slug-baserade butiker kan verifieras (webhallen/maxgaming har
 * id-URL:er → hoppas över). Truncerade slugs hanteras via delsträngsmatch.
 *
 *   npx tsx scripts/flag-wrong-links.ts          # rapport mot prod
 *
 * Granska träffarna manuellt och radera bekräftat fel via en engångs-deleteMany.
 * Kör efter scrape-all om wrong-link-klagomål dyker upp.
 */
import * as fs from "fs"; import * as path from "path";
const envPath = path.join(process.cwd(), ".env");
if (fs.existsSync(envPath)) for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
  const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.+?)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
if (process.env.TARGET !== "local" && process.env.NEON_DATABASE_URL) process.env.DATABASE_URL = process.env.NEON_DATABASE_URL;
import { prisma } from "../src/lib/db";
import { isDirectOfferUrl } from "../src/lib/marketplace-urls";

// stoppord + formord + produktlinje-ord = ej särskiljande identitet.
const NOISE = new Set(("pokemon pokémon tcg the trading card game and of for new sealed english eng se sv " +
  "booster boosters box display pack packs elite trainer etb bundle blister tin tins deck collection premium " +
  "battle league theme starter challenge mega tag vstar vmax gmax ex gx v build stadium kit").split(" "));
function entityWords(s: string): string[] {
  return [...new Set(s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ").split(" ")
    .filter((t) => t.length > 2 && !NOISE.has(t) && !/^\d+$/.test(t)))];
}
function productSlug(url: string): string | null {
  try {
    const segs = new URL(url).pathname.split("/").filter(Boolean);
    const last = (segs[segs.length - 1] ?? "").replace(/\.html?$/, "");
    return !last || /^\d+$/.test(last) ? null : last;
  } catch { return null; }
}

(async () => {
  const offers = await prisma.offer.findMany({
    where: { product: { category: { notIn: ["SINGLE_CARD", "GRADED_CARD", "ACCESSORY"] } },
             retailer: { name: { notIn: ["Cardmarket", "Tradera"] } } },
    select: { id: true, url: true, price: true, product: { select: { title: true } }, retailer: { select: { name: true } } },
  });
  const flagged: { id: string; retailer: string; title: string; slug: string; price: number | null }[] = [];
  for (const o of offers) {
    if (!isDirectOfferUrl(o.url)) continue;
    const slug = productSlug(o.url);
    if (!slug) continue;
    const ents = entityWords(o.product.title);
    if (ents.length === 0) continue;
    const sw = new Set(slug.toLowerCase().replace(/[^a-z0-9]+/g, " ").split(" ").filter(Boolean));
    const hit = ents.some((e) => [...sw].some((w) => w.includes(e) || (e.length >= 5 && e.includes(w) && w.length >= 4)));
    if (!hit) flagged.push({ id: o.id, retailer: o.retailer.name, title: o.product.title, slug, price: o.price });
  }
  console.log(`Direkta sealed-offers: ${offers.length} · misstänkt felmatchade: ${flagged.length}\n`);
  for (const f of flagged) console.log(`  [${f.retailer}] "${f.title}"  (${f.price ?? "-"}öre)\n      slug: ${f.slug}  offerId: ${f.id}`);
  if (flagged.length === 0) console.log("  ✅ Inga uppenbara felmatchningar.");
  await prisma.$disconnect();
})();
