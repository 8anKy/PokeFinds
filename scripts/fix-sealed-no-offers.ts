/**
 * Ger sealed-produkter som SAKNAR prissatt Cardmarket-offer ("–") ett riktigt
 * prissatt CM-offer genom att matcha mot HELA CM-katalogen på produktform +
 * namnlikhet (inte set-begränsat). Fångar t.ex. premium collections som finns
 * i katalogen MED pris men utan cardmarket_id (då används katalogens CM-länk).
 *
 * Pris/lager-modell: lowest→IN_STOCK+From, annars 30d→OUT_OF_STOCK. Saknar
 * katalogträffen pris (t.ex. vintage-box utan marknadsdata) lämnas "–".
 *
 * Dry run:  npx tsx scripts/fix-sealed-no-offers.ts
 * Skriv:    APPLY=1 npx tsx scripts/fix-sealed-no-offers.ts
 */
import * as fs from "fs";
import * as path from "path";

const envPath = path.join(process.cwd(), ".env");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.+?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

import { PrismaClient } from "@prisma/client";
import { getRatesOre } from "../src/lib/exchange-rate";
import { cardmarketProductUrl } from "../src/lib/marketplace-urls";
import { classifyForm, scoreSimilarity } from "../src/scrapers/matching";

const prisma = new PrismaClient();
const APPLY = process.env.APPLY === "1";
// Hög tröskel: bara nära-exakta namnträffar (annars matchar t.ex. en fabricerad
// "Shrouded Fable Booster Box" — set utan riktig box — mot fel vintage-box).
const MIN_SCORE = parseFloat(process.env.MIN_SCORE ?? "0.85");
const CACHE = path.join(process.cwd(), ".cache", "rapidapi-sealed.json");

const norm = (s: string) =>
  s.toLowerCase().replace(/pok[eé]mon|tcg|:/g, "").replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
const EXPECTED_FORM: Record<string, string> = {
  BOOSTER_BOX: "display", BOOSTER_PACK: "booster", ETB: "etb",
  COLLECTION_BOX: "collection", TIN: "tin", BLISTER: "blister", BUNDLE: "bundle",
};

/** Direkt CM-länk: idProduct om id finns, annars katalogens CM-redirect. */
function cmLink(c: any): string | null {
  if (c.cardmarket_id != null) return cardmarketProductUrl(c.cardmarket_id);
  const l = c.links?.cardmarket ?? c.tcggo_url;
  return typeof l === "string" ? l : null;
}

async function main() {
  const rates = await getRatesOre();
  const cm = await prisma.retailer.findFirst({ where: { name: "Cardmarket" } });
  if (!cm) throw new Error("Cardmarket-retailer saknas");

  const catalog = (JSON.parse(fs.readFileSync(CACHE, "utf-8")) as any[]).map((p) => ({
    p, form: classifyForm(p.name ?? ""), n: norm(p.name ?? ""),
  }));

  const orphans = await prisma.product.findMany({
    where: {
      category: { in: ["BOOSTER_BOX", "BOOSTER_PACK", "ETB", "COLLECTION_BOX", "TIN", "BLISTER", "BUNDLE"] },
      offers: { none: { price: { not: null } } },
    },
    include: { offers: { select: { id: true, retailerId: true } } },
  });
  console.log(`Sealed utan prissatt offer: ${orphans.length} · APPLY=${APPLY}\n`);

  let fixed = 0, noPrice = 0, unmatched = 0;
  const samples: string[] = [];
  for (const p of orphans) {
    const expForm = EXPECTED_FORM[p.category];
    const ourN = norm(p.title);
    let best: any = null, bestScore = 0;
    for (const c of catalog) {
      if (c.form !== expForm) continue;
      if (p.category === "BOOSTER_BOX" && !/booster/i.test(c.p.name)) continue;
      const s = scoreSimilarity(ourN, c.n);
      if (s > bestScore) { bestScore = s; best = c.p; }
    }
    if (!best || bestScore < MIN_SCORE) { unmatched++; if (samples.length < 14) samples.push(`  [EJ ${bestScore.toFixed(2)}] "${p.title.slice(0, 50)}"`); continue; }

    const cmp = best.prices?.cardmarket ?? {};
    const low = cmp.lowest ?? null;
    const avg = cmp["30d_average"] ?? null;
    const eur = low ?? avg;
    const url = cmLink(best);
    if (eur == null || url == null) { noPrice++; continue; } // genuint ingen marknadsdata → "–"
    const priceOre = Math.round(eur * rates.eurToOre);
    const stock = low != null ? "IN_STOCK" : "OUT_OF_STOCK";
    fixed++;
    if (samples.length < 14) samples.push(`  [${bestScore.toFixed(2)} ${stock === "IN_STOCK" ? "lager" : "ur"}] "${p.title.slice(0, 42)}" → "${best.name}" ${(priceOre / 100).toFixed(0)} kr`);

    if (APPLY) {
      const existingCm = p.offers.find((o) => o.retailerId === cm.id);
      if (existingCm) {
        await prisma.offer.update({ where: { id: existingCm.id }, data: { price: priceOre, url, stockStatus: stock, condition: "SEALED", lastSeenAt: new Date() } });
      } else {
        await prisma.offer.create({
          data: { productId: p.id, retailerId: cm.id, condition: "SEALED", language: "EN", price: priceOre, currency: "SEK", stockStatus: stock, url },
        });
      }
    }
  }

  console.log("Resultat:");
  samples.forEach((s) => console.log(s));
  console.log(`\nPrissatta: ${fixed} · katalogträff utan pris (→ "–"): ${noPrice} · ingen namnträff: ${unmatched}`);
  if (!APPLY) console.log("\n(dry run — kör APPLY=1 för att skriva)");
}

main().finally(() => prisma.$disconnect());
