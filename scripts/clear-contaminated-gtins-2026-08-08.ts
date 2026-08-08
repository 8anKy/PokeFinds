/**
 * Rensar kontaminerade streckkoder ur katalogen (svepningens sektion 4, ägarens
 * klartecken 2026-08-08). Tre klasser, tre åtgärder:
 *
 *  1. LINJEDELADE koder (samma kod på flera karaktärs-SKU:er) — bannade i
 *     normalizeGtin (src/lib/gtin.ts) och nollas här på ALLA rader.
 *  2. Meganium ex Box: koden kom från MaxGamings sortimentssida (dokumenterat
 *     2026-07-13 — den publicerar Emboars kod för alla tre boxarna). Emboar,
 *     vars kod kommer från Speltrollets variantspecifika sida, BEHÅLLER sin.
 *  3. Pawmot Enhanced 2-Pack (SV-eran): koden kom från MaxGamings generiska
 *     "enhanced-2-pack-blister-2026"-sida, som säljer ME-erans Vileplume-blister.
 *     Vileplume (DL:s karaktärsspecifika sida) BEHÅLLER sin.
 *
 *   node scripts/with-prod-db.mjs npx tsx scripts/clear-contaminated-gtins-2026-08-08.ts
 *   node scripts/with-prod-db.mjs npx tsx scripts/clear-contaminated-gtins-2026-08-08.ts --apply
 */
import { prisma } from "../src/lib/db";

const APPLY = process.argv.includes("--apply");

const BANNED = ["00196214142657", "00196214111332", "00820650851117"];

/** (produkt-slug, offer-URL vars kod är fel) — koden nollas på BÅDA. */
const TARGETED: { slug: string; offerUrlContains: string }[] = [
  { slug: "ascended-heroes-mega-meganium-ex-box", offerUrlContains: "maxgaming.se" },
  { slug: "pawmot-enhanced-2-pack-blister", offerUrlContains: "maxgaming.se" },
];

async function main() {
  console.log(APPLY ? "APPLY — skriver.\n" : "DRY-RUN — inget skrivs. Kör med --apply.\n");

  for (const gtin of BANNED) {
    const prods = await prisma.product.findMany({ where: { gtin }, select: { id: true, title: true } });
    const offers = await prisma.offer.findMany({ where: { gtin }, select: { id: true, url: true } });
    console.log(`Bannad kod ${gtin}: ${prods.length} produkter, ${offers.length} offers`);
    for (const p of prods) console.log(`   produkt: ${p.title}`);
    if (!APPLY) continue;
    await prisma.product.updateMany({ where: { gtin }, data: { gtin: null } });
    await prisma.offer.updateMany({ where: { gtin }, data: { gtin: null } });
    console.log("   ✓ nollad överallt");
  }

  for (const t of TARGETED) {
    const p = await prisma.product.findUnique({
      where: { slug: t.slug },
      select: { id: true, title: true, gtin: true, offers: { select: { id: true, url: true, gtin: true } } },
    });
    if (!p) { console.log(`saknas: ${t.slug}`); continue; }
    const badOffers = p.offers.filter((o) => o.gtin && o.url?.includes(t.offerUrlContains));
    console.log(`\n${p.title}: Product.gtin=${p.gtin} → null · ${badOffers.length} offer-koder nollas`);
    if (!APPLY) continue;
    await prisma.product.update({ where: { id: p.id }, data: { gtin: null } });
    if (badOffers.length) {
      await prisma.offer.updateMany({ where: { id: { in: badOffers.map((o) => o.id) } }, data: { gtin: null } });
    }
    console.log("   ✓ nollad");
  }
  if (!APPLY) console.log("\nTorrkörning — inget skrevs.");
}

main().finally(() => prisma.$disconnect());
