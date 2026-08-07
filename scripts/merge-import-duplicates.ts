/**
 * Städar dubbletter som AUTO-IMPORTEN skapade innan andra-chansen-steget fanns.
 *
 *   node scripts/with-prod-db.mjs npx tsx scripts/merge-import-duplicates.ts            # torrkörning
 *   node scripts/with-prod-db.mjs npx tsx scripts/merge-import-duplicates.ts --apply
 *   … --efter=2026-08-07            # bara stubbar skapade efter ett datum
 *   … --min=0.80                    # höj golvet för vilka par som ens prövas
 *
 * VARFÖR ETT EGET SKRIPT: `merge-stub-into-canonical.ts` letar kandidat med
 * `matchProduct`, och det är precis den funktionen som sa nej när stubben skapades —
 * den säger nej igen och stubben städas aldrig. Det här skriptet använder samma väg som
 * den nya importen (`nearestCatalogCandidate` + LLM-domaren), alltså är det bara den
 * NYA regeln tillämpad bakåt på gammal data.
 *
 * ⛔ SAMMANSLAGNING RADERAR EN KATALOGPOST. Tre spärrar, alla från merge-stub-into-
 *    canonical.ts och av samma skäl:
 *      1. målet måste vara RIKARE (setId, eller fler butikslänkar)
 *      2. stubben får aldrig ha mer meritlista (CM-offer / prishistorik) än målet —
 *         prisgrafen byggs bara FRAMÅT och går inte att återskapa
 *      3. LLM-domaren måste svara "samma produkt" på RÅTITLARNA
 *    Domaren ensam räcker inte: en felaktig LÄNK syns och rättas, en felaktig
 *    SAMMANSLAGNING är permanent.
 */
import "./load-env";
import { requireEnv } from "./load-env";
import { prisma } from "../src/lib/db";
import { mergeStubInto } from "../src/jobs/dedupe-stubs";
import { cleanListingTitle, loadMatchIndex, nearestCatalogCandidate } from "../src/scrapers/matching";
import { normalizeTitle } from "../src/lib/utils";
import { judgeSameProduct } from "../src/lib/same-product";
import { recomputeProductPriceCache } from "../src/services/products";

requireEnv("ANTHROPIC_API_KEY", "DATABASE_URL");

const APPLY = process.argv.includes("--apply");
const MIN_SCORE = Number(process.argv.find((a) => a.startsWith("--min="))?.split("=")[1] ?? 0.75);
const AFTER = process.argv.find((a) => a.startsWith("--efter="))?.split("=")[1];

/** Auto-importens stubbar: inget set, inget kort — bara en butikstitel. */
const SEALED = ["BOOSTER_BOX", "BOOSTER_PACK", "ETB", "BUNDLE", "COLLECTION_BOX", "TIN", "BLISTER", "OTHER"] as const;

async function main() {
  console.log(APPLY ? "APPLY — skriver.\n" : "TORRKÖRNING — inget skrivs. Kör med --apply.\n");

  const stubs = await prisma.product.findMany({
    where: {
      setId: null,
      cardId: null,
      category: { in: [...SEALED] },
      ...(AFTER ? { createdAt: { gte: new Date(AFTER) } } : {}),
    },
    select: {
      id: true,
      title: true,
      offers: { select: { retailer: { select: { name: true } } } },
      _count: { select: { priceSnapshots: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  console.log(`${stubs.length} kandidat-stubbar (setId=null, sealed${AFTER ? `, efter ${AFTER}` : ""}).\n`);

  const index = await loadMatchIndex();
  let merged = 0;
  let asked = 0;

  for (const stub of stubs) {
    const clean = cleanListingTitle(stub.title);
    // STUBBEN MÅSTE UT UR INDEXET — annars är den sin egen bästa kandidat.
    const others = index.filter((c) => c.id !== stub.id);
    const near = nearestCatalogCandidate(normalizeTitle(clean), clean, others, MIN_SCORE);
    if (!near) continue;

    const canon = await prisma.product.findUnique({
      where: { id: near.id },
      select: {
        id: true,
        title: true,
        setId: true,
        offers: { select: { retailer: { select: { name: true } } } },
        _count: { select: { priceSnapshots: true } },
      },
    });
    if (!canon || canon.id === stub.id) continue;

    // Spärr 1: målet måste vara rikare.
    if (!(canon.setId !== null || canon.offers.length > stub.offers.length)) continue;
    // Spärr 2: stubben får aldrig bära mer meritlista än målet.
    const stubCM = stub.offers.some((o) => o.retailer.name === "Cardmarket");
    const canonCM = canon.offers.some((o) => o.retailer.name === "Cardmarket");
    if ((stubCM && !canonCM) || stub._count.priceSnapshots > canon._count.priceSnapshots) {
      console.log(`⚠ HOPPAR "${stub.title}" — stubben har mer meritlista än målet.`);
      continue;
    }

    // Spärr 3: domaren, på RÅTITLARNA.
    asked++;
    const verdict = await judgeSameProduct(stub.title, canon.title);
    if (!verdict?.same) continue;

    console.log(`${APPLY ? "MERGAR" : "SKULLE MERGA"} (${near.score.toFixed(3)})`);
    console.log(`   stub : ${stub.title}`);
    console.log(`   →      ${canon.title}`);
    if (APPLY) await mergeStubInto(stub.id, canon.id, () => {});
    merged++;
  }

  // Priscachen räknas om EN gång för hela katalogen, inte per merge — funktionen tar
  // inga argument och gör en katalogbred SQL-omräkning. GOTCHA från 2026-07-13: utan
  // den står den överlevande produktens rubrikpris kvar på sitt gamla värde trots att
  // den fått stubbens butikslänkar.
  if (APPLY && merged > 0) await recomputeProductPriceCache();

  console.log(`\n${merged} ${APPLY ? "sammanslagna" : "skulle slås ihop"} (domaren tillfrågad ${asked} gånger).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    process.exit(process.exitCode ?? 0);
  });
