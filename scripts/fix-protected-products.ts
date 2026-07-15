/**
 * Engångsfix för de "protected" sealed-produkter ägaren granskade 2026-07-15.
 * Använder EXPLICITA verifierade priser (ägarens live-avläsning + gratis-guiden där den
 * matchar butikspris) — INTE RapidAPI:s live-lowest, som visade sig glitchig (Riolu 2200€)
 * och ofullständig (6 av 10 idProduct saknas i den kurerade katalogen).
 *
 * Gör: (1) repekar fel idProduct, (2) sätter rätt from-pris, (3) rensar fel bild för de
 * fel-länkade (visar hellre platshållare än fel korts bild), (4) raderar korrupta
 * historikpunkter (senaste 12 dgr, >4x från rättat pris). BILDER för de 6 saknade
 * produkterna går INTE att hämta (ej i RapidAPI-katalogen) → separat pass.
 *
 * Dry-run:  node scripts/with-prod-db.mjs npx tsx -r dotenv/config scripts/fix-protected-products.ts
 * Skriv:    APPLY=1 node scripts/with-prod-db.mjs npx tsx -r dotenv/config scripts/fix-protected-products.ts
 */
import { PrismaClient } from "@prisma/client";
import { recomputeProductPriceCache } from "../src/services/products";
import { cardmarketProductUrl } from "../src/lib/marketplace-urls";
import { getRatesOre } from "../src/lib/exchange-rate";

const prisma = new PrismaClient();
const APPLY = process.env.APPLY === "1";

// priceEur = verifierat from-pris (källa i note). idChange=true → CM-länken var fel.
// clearImage=true → nuvarande bild är fel kortsida (fel-länkade) → nolla. hold=true →
// rör inte priset (osäkert/redan rätt). Bild-fix för saknade produkter = separat pass.
const FIXES: { match: string; id: number; priceEur?: number; idChange?: boolean; clearImage?: boolean; hold?: boolean; note: string }[] = [
  { match: "Darkness Ablaze Booster Box", id: 462239, priceEur: 319.9, idChange: true, clearImage: true, note: "fel länk (Drayton)→box; from 319.9€ (guide, ~butik 4179kr)" },
  { match: "Journey Together Enhanced Booster Display", id: 805580, priceEur: 245, idChange: true, clearImage: true, note: "fel länk (Clauncher)→display; from 245€ (~butik 2000-3000kr)" },
  { match: "Mega Evolution: Drifloon 1-Pack Blister", id: 834817, priceEur: 8.25, idChange: true, clearImage: true, note: "fel länk (Jynx)→blister; from 8.25€ (~butik 85-99kr)" },
  { match: "Prismatic Evolutions Poster Collection", id: 798946, priceEur: 39, note: "pris var trend→from 39€ (din avläsning)" },
  { match: "Flashfire Booster Pack", id: 271862, priceEur: 170, note: "from 170€ (din avläsning, ~butik 1900kr); guide inaktuell" },
  { match: "Ascended Heroes: Riolu Mini Tin", id: 860569, priceEur: 12.9, note: "pris var trend→from 12.9€; städa 10-14 jul; BILD kvar (ej i katalog)" },
  { match: "Ascended Heroes: Pikachu Mini Tin", id: 860568, priceEur: 12.9, note: "from 12.9€; städa 10-14 jul" },
  // HÅLLNA — kräver din input / separat pass:
  { match: "Shining Legends Zoroark Pin Collection", id: 311203, hold: true, note: "PRIS OSÄKERT: guide 70€ vs din 500€ vs butik 3495kr — bekräfta. Bild ej hämtbar." },
  { match: "Trick or Trade BOOster 2023", id: 719775, hold: true, note: "pris rätt (6kr); BILD saknas — ej i RapidAPI-katalogen" },
  { match: "Trick or Trade BOOster Pack 2024", id: 775963, hold: true, note: "pris rätt; BUTIKSBILD kvar — ej i RapidAPI-katalogen" },
];

async function main() {
  console.log(APPLY ? "APPLY — skriver.\n" : "DRY-RUN — inget skrivs.\n");
  const cm = await prisma.retailer.findFirst({ where: { name: "Cardmarket" } });
  if (!cm) throw new Error("Cardmarket-retailer saknas");
  const rates = await getRatesOre();
  let changed = 0;

  for (const f of FIXES) {
    const p = await prisma.product.findFirst({
      where: { title: { contains: f.match } },
      select: { id: true, title: true, imageUrl: true,
        offers: { where: { retailerId: cm.id }, select: { id: true, price: true, url: true } },
        priceSnapshots: { select: { id: true, date: true, avgPrice: true }, orderBy: { date: "desc" }, take: 25 } },
    });
    if (!p) { console.log(`❓ SAKNAS: ${f.match}`); continue; }
    const cmOffer = p.offers[0];
    const oldId = cmOffer?.url?.match(/idProduct=(\d+)/)?.[1] ?? "?";

    if (f.hold) {
      console.log(`\n⏸ HÅLLEN — ${p.title}\n   ${f.note}`);
      continue;
    }

    const newPriceOre = f.priceEur != null ? Math.round(f.priceEur * rates.eurToOre) : cmOffer?.price ?? null;
    const cutoff = new Date(Date.now() - 12 * 86_400_000);
    const badSnaps = newPriceOre != null
      ? p.priceSnapshots.filter((s) => s.date >= cutoff && (s.avgPrice > newPriceOre * 4 || s.avgPrice < newPriceOre / 4))
      : [];

    console.log(`\n■ ${p.title}\n   ${f.note}`);
    console.log(`   idProduct : ${oldId}${f.idChange ? ` → ${f.id}` : " (oförändrad)"}`);
    console.log(`   pris      : ${cmOffer?.price != null ? (cmOffer.price / 100).toFixed(0) + " kr" : "–"} → ${newPriceOre != null ? (newPriceOre / 100).toFixed(0) + " kr" : "–"}`);
    if (f.clearImage) console.log(`   bild      : nollas (nuvarande = fel korts bild)`);
    console.log(`   historik  : raderar ${badSnaps.length}${badSnaps.length ? " (" + badSnaps.map((s) => s.date.toISOString().slice(0, 10) + "=" + (s.avgPrice / 100).toFixed(0) + "kr").join(", ") + ")" : ""}`);

    if (APPLY) {
      if (cmOffer && newPriceOre != null) {
        await prisma.offer.update({ where: { id: cmOffer.id }, data: { url: cardmarketProductUrl(f.id), price: newPriceOre, stockStatus: "IN_STOCK", lastSeenAt: new Date() } });
      }
      if (f.clearImage && p.imageUrl) await prisma.product.update({ where: { id: p.id }, data: { imageUrl: null } });
      if (badSnaps.length) await prisma.priceSnapshot.deleteMany({ where: { id: { in: badSnaps.map((s) => s.id) } } });
      changed++;
    }
  }

  if (APPLY) {
    await recomputeProductPriceCache();
    console.log(`\n✅ Fixade ${changed} produkter + recompute. Redeploy för att bust:a ISR + söksindex.`);
  } else {
    console.log(`\nDry-run. Kör med APPLY=1 för att skriva.`);
  }
}

main().finally(() => prisma.$disconnect());
