/**
 * Slår ihop HANDGRANSKADE dubbletter.
 *
 *   node scripts/with-prod-db.mjs npx tsx scripts/merge-verified-duplicates.ts
 *   node scripts/with-prod-db.mjs npx tsx scripts/merge-verified-duplicates.ts --apply
 *
 * VARFÖR EN EXPLICIT LISTA OCH INTE EN REGEL. En felaktig LÄNK syns och rättas; en
 * felaktig SAMMANSLAGNING raderar en katalogpost med historik. Den katalogbreda
 * svepningen (`dedupe-catalog.ts`) föreslog 2026-08-07 bland annat
 *   "Mega Charizard X ex Tin" == "Mega Charizard Y ex Tin"  (1,00)
 *   "Base Set 2 Booster Pack" == "Base Booster Pack"        (0,99)
 * — båda fel, eftersom `normalizeTitle` kastar korta tokens ("X", "Y", "2") och de
 * titlarna då blir identiska. Tills den svepningen är mätt mot facit slås bara par
 * ihop som en människa granskat, och varje rad bär sitt bevis.
 *
 * BEVISET för raderna nedan: Cardmarkets egen sealed-katalog listar EXAKT EN blister
 * per set+karaktär (mätt: 486 blistrar, fyra undantag och alla fyra skiljer sig på
 * ANTALET pack, aldrig på "checklane" mot "1-pack"). Butiken skriver karaktären sist
 * och katalogen i mitten — samma vara, olika ordföljd.
 */
import { prisma } from "../src/lib/db";
import { mergeStubInto } from "../src/jobs/dedupe-stubs";
import { characterNames } from "../src/scrapers/matching";

const APPLY = process.argv.includes("--apply");

/** stubSlug = butiksdubbletten som ska bort, canonicalTitle = posten som överlever. */
const PAIRS: { stubSlug: string; canonicalTitle: string; cm: string }[] = [
  { stubSlug: "pokemon-scarlet-violet-5-temporal-forces-3-pack-blister-cleffa", canonicalTitle: "Temporal Forces: Cleffa 3-Pack Blister", cm: "Temporal Forces: Cleffa 3-Pack Blister" },
  { stubSlug: "pokemon-scarlet-violet-5-temporal-forces-3-pack-blister-cyclizar", canonicalTitle: "Temporal Forces: Cyclizar 3-Pack Blister", cm: "Temporal Forces: Cyclizar 3-Pack Blister" },
  { stubSlug: "pokemon-scarlet-violet-8-surging-sparks-premium-checklane-blister-alakazam", canonicalTitle: "Surging Sparks: Alakazam Premium Checklane Blister", cm: "Surging Sparks: Alakazam Premium Checklane Blister" },
  { stubSlug: "pokemon-sword-shield-5-battle-styles-blister-pack-arrokuda", canonicalTitle: "Battle Styles: Arrokuda 1-Pack Blister", cm: "Battle Styles: Arrokuda 1-Pack Blister" },
  { stubSlug: "pokemon-scarlet-violet-2-paldea-evolved-checklane-blister-growlithe", canonicalTitle: "Paldea Evolved: Growlithe 1-Pack Blister", cm: "Paldea Evolved: Growlithe 1-Pack Blister" },
  { stubSlug: "pokemon-scarlet-violet-9-journey-together-checklane-blister-scraggy", canonicalTitle: "Journey Together: Scraggy 1-Pack Blister", cm: "Journey Together: Scraggy 1-Pack Blister" },
];

async function main() {
  let ok = 0;
  for (const p of PAIRS) {
    const stub = await prisma.product.findUnique({
      where: { slug: p.stubSlug },
      select: { id: true, title: true, imageUrl: true, offers: { select: { id: true } }, _count: { select: { watchlistItems: true, collectionItems: true } } },
    });
    const canon = await prisma.product.findFirst({
      where: { title: p.canonicalTitle },
      select: { id: true, title: true, imageUrl: true },
    });
    if (!stub) { console.log(`  stub saknas (redan hopslagen?): ${p.stubSlug}`); continue; }
    if (!canon) { console.log(`  ⚠️ hittar inte "${p.canonicalTitle}" — hoppar över`); continue; }

    // SISTA KONTROLLEN I KOD: samma karaktär i båda titlarna. Skulle en rad ovan
    // vara felskriven fångas det här, inte i produktionsdatan.
    const a = characterNames(stub.title);
    const b = characterNames(canon.title);
    const shared = [...a].filter((n) => b.has(n));
    if (shared.length === 0) {
      console.log(`  ⛔ KARAKTÄR SKILJER: "${stub.title}" vs "${canon.title}" — hoppar över`);
      continue;
    }

    console.log(`\n  "${stub.title}"\n   → "${canon.title}"   [karaktär: ${shared.join(", ")}]`);
    console.log(`     stub: ${stub.offers.length} offers, ${stub._count.watchlistItems} bevakningar, ${stub._count.collectionItems} samlingsposter`);
    if (!APPLY) continue;

    if (!canon.imageUrl && stub.imageUrl) {
      await prisma.product.update({ where: { id: canon.id }, data: { imageUrl: stub.imageUrl } });
    }
    await mergeStubInto(stub.id, canon.id);
    ok++;
    console.log("     ✓ hopslagen");
  }
  console.log(APPLY ? `\nSammanslagna: ${ok}/${PAIRS.length}` : "\nTorrkörning — inget skrevs. Lägg till --apply.");
}

main().finally(() => prisma.$disconnect());
