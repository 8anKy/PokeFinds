/**
 * Revision av de butikslänkar "andra chansen" skapade (se nearestCatalogCandidate).
 *
 *   node scripts/with-prod-db.mjs npx tsx scripts/audit-second-chance-links.ts
 *   … --apply     # tar bort de länkar som dagens regel INTE hade skapat
 *
 * VARFÖR: andra chansen låter LLM-domaren binda en annons matcharen avstod från, och
 * en felaktig sådan bindning ger FEL PRIS på en verklig produkt. Domaren är bra men inte
 * ofelbar — den svarade "samma" på "Enhanced 2-Pack Blister" mot "…: Genie Trio".
 * Skyddet mot det är strukturellt och ligger OVANFÖR domaren (`blisterCharacterMismatch`
 * m.fl.); det här skriptet kör om just de vakterna mot befintliga länkar och plockar bort
 * dem som inte längre skulle godkännas.
 *
 * ⛔ RADERAR BARA OFFERN, ALDRIG PRODUKTEN. Nästa restock-skanning ser URL:en som ny
 *    igen och auto-importen skapar då en EGEN produkt för den — vilket är rätt svar när
 *    identiteten inte går att styrka. Det är samma recept som orphan-offers.
 * ⛔ Rör bara offers vars produkt saknar `setId` ELLER vars butik är en Wave 4-butik?
 *    NEJ — urvalet är annonsens TITEL mot produktens, oavsett butik. En felaktig länk är
 *    lika fel oavsett vem som skapade den.
 */
import "./load-env";
import { prisma } from "../src/lib/db";
import {
  blisterCharacterMismatch,
  deckCharacterMismatch,
  packVsBoxMismatch,
  productsConflict,
  classifyForm,
  cleanListingTitle,
  characterNames,
} from "../src/scrapers/matching";
import { normalizeTitle } from "../src/lib/utils";

const APPLY = process.argv.includes("--apply");
/** Bara länkar som skapats efter detta rörs av --apply. Resten RAPPORTERAS. */
const SINCE = process.argv.find((a) => a.startsWith("--sedan="))?.split("=")[1];

/**
 * Samma vetokedja som nearestCatalogCandidate.
 *
 * ⛔ `cleanListingTitle` FÖRST, precis som importen gör. Utan den läses butiksskräp som
 *    produktidentitet: "Pokémon - Booster Bundle - Ascended Heroes (Max 2st per kund)"
 *    klassas som MULTIPACK av "2st" och en helt korrekt länk hade tagits bort.
 *
 * `hard` = får RADERA. ENDA fallet som kvalificerar: annonsen namnger INGEN karaktär
 * alls medan produkten gör det. Cardmarket namnger alla 486 blistrar "Set: KARAKTÄR
 * N-Pack Blister", så en karaktärslös annons kan vara vilken som helst av dem — att ha
 * valt en var ett myntkast.
 *
 * ⛔ INTE varje `blisterCharacterMismatch`. Den slår också när BÅDA namnger karaktärer
 *    men olika många: "3 Pack Blister (Psyduck/Golduck)" mot "Mega Evolution: Psyduck
 *    3-Pack Blister" är samma vara (butiken räknar upp båda utvecklingsstegen), och en
 *    radering där hade tagit bort en korrekt länk. Övrigt rapporteras bara — det kräver
 *    ett mänskligt öga ("Mega Zygard EX" mot "Mega Zygarde ex" är samma vara med
 *    butikens stavfel, men karaktärsvakten ser två olika namn).
 */
function stillAcceptable(rawListingTitle: string, productTitle: string): { ok: boolean; why?: string; hard?: boolean } {
  const listingTitle = cleanListingTitle(rawListingTitle);
  const a = normalizeTitle(listingTitle);
  const b = normalizeTitle(productTitle);
  if (blisterCharacterMismatch(listingTitle, b)) {
    const listingHasNone = characterNames(listingTitle).size === 0;
    const productNames = characterNames(productTitle).size > 0;
    return { ok: false, why: "blister-karaktär", hard: listingHasNone && productNames };
  }
  const fa = classifyForm(a);
  const fb = classifyForm(b);
  if (fa && fb && fa !== fb) return { ok: false, why: `form ${fa} ≠ ${fb}` };
  if (packVsBoxMismatch(listingTitle, b)) return { ok: false, why: "påse ≠ box" };
  if (deckCharacterMismatch(a, b)) return { ok: false, why: "deck-karaktär" };
  if (productsConflict(listingTitle, b)) return { ok: false, why: "productsConflict" };
  return { ok: true };
}

async function main() {
  console.log(APPLY ? "APPLY — tar bort felaktiga länkar.\n" : "TORRKÖRNING — inget skrivs.\n");

  // Huvudboken bär annonsens EGEN titel; offern bär produkten den bands till.
  // Join:en på (retailerId, url) är densamma som runRestockScan använder.
  const listings = await prisma.storeListing.findMany({
    select: { url: true, retailerId: true, title: true, retailer: { select: { name: true } } },
  });
  let checked = 0;
  let bad = 0;
  let removed = 0;

  for (const l of listings) {
    const offer = await prisma.offer.findFirst({
      where: { retailerId: l.retailerId, url: l.url },
      select: { id: true, createdAt: true, product: { select: { id: true, title: true } } },
    });
    if (!offer?.product) continue;
    checked++;
    // Identisk titel = ingen tolkning gjordes; hoppa (billigt och vanligast).
    if (normalizeTitle(l.title) === normalizeTitle(offer.product.title)) continue;
    const verdict = stillAcceptable(l.title, offer.product.title);
    if (verdict.ok) continue;
    bad++;
    const inWindow = !SINCE || offer.createdAt >= new Date(SINCE);
    const willDelete = APPLY && verdict.hard && inWindow;
    console.log(
      `${willDelete ? "TAR BORT" : "rapport "} [${verdict.why}]\n   annons  (${l.retailer.name}): ${l.title}\n   produkt: ${offer.product.title}`
    );
    if (willDelete) {
      await prisma.offer.delete({ where: { id: offer.id } });
      removed++;
    }
  }

  console.log(`\n${checked} länkar prövade, ${bad} avvikande, ${removed} borttagna.`);
  if (removed > 0) {
    console.log("Rubrikpriserna följer med vid nästa recomputeProductPriceCache (scrape-all / cardmarket-refresh).");
  }
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
