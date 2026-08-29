/**
 * DIREKTA CARDMARKET-LÄNKAR FÖR JAPANSKA SINGLAR — ur CM:s GRATIS dagliga katalog
 * (2026-08-30, ägarfråga: "kan vi få länken ur den dagliga katalogen?" — ja).
 *
 *   node scripts/with-prod-db.mjs npx tsx scripts/link-jp-singles-to-cardmarket.ts           # torrkörning
 *   node scripts/with-prod-db.mjs npx tsx scripts/link-jp-singles-to-cardmarket.ts --apply
 *
 * VARFÖR DET GÅR: `products_singles_6.json` bär `idExpansion` per singel, och våra
 * JP-set bär `cmExpansionId` (samma CM-expansioner). Inom en expansion är CM:s namn
 * det engelska kortnamnet (+ attacker i hakparentes), och kort med SAMMA namn
 * (vanlig / SAR / SIR) ligger i CM:s id-ordning = kortnummerordning. Regeln:
 *   1. gruppera på normaliserat namn inom expansionen, hos båda,
 *   2. en grupp matchas BARA när antalet versioner är lika på båda sidor,
 *   3. inom gruppen paras k:te CM-id:t med k:te kortnumret.
 * Mätt 2026-08-30: 4 613 av 4 723 kort i 38 set entydiga; 50 utan CM-namn (energi,
 * promo-rader) och 60 där versionsantalet skiljer (CM listar t.ex. reverse/holo-
 * varianter som EGNA produkter i S-eran) — de behåller söklänken.
 * ⛔ Vid olika antal versioner gissas ALDRIG (det var exakt så lånade cardmarket_id
 *    uppstod 2026-08-05). Söklänk > fel länk.
 *
 * Set utan `cmExpansionId` (skapade av singelimporten) får ett via CM:s sealed-
 * katalog: `deriveJpSetName` på expansionens booster-rader måste ge VÅRT setnamn.
 *
 * Skriver: `Card.cardmarketId` (unik, gör omkörning + framtida refresh idempotent)
 * och Cardmarket-offerns `url` → `cardmarketJapaneseProductUrl(idProduct)`.
 * jp-singles-refresh bevarar en produktsida framför söklänken.
 */
import "./load-env";
import { prisma } from "../src/lib/db";
import { cardmarketJapaneseProductUrl, isCardmarketJpSearchUrl } from "../src/lib/marketplace-urls";
import { deriveJpSetName, type CmCatalogRow } from "../src/lib/jp-set-name";
import { mapPool } from "../src/lib/concurrency";

const APPLY = process.argv.includes("--apply");
const SINGLES = "https://downloads.s3.cardmarket.com/productCatalog/productList/products_singles_6.json";
const NONSINGLES = "https://downloads.s3.cardmarket.com/productCatalog/productList/products_nonsingles_6.json";

interface CmSingle { idProduct: number; name: string; idExpansion: number }
interface CmNonSingle extends CmCatalogRow { idProduct: number; idExpansion: number }

/** Samma normalisering på båda sidor: attacker/suffix bort, accenter + skiljetecken bort. */
export function cmNameKey(s: string): string {
  return s
    .replace(/\s*\[.*$/, "")
    .replace(/\s*\(JP\)\s*$/, "")
    .replace(/\s+-\s+.*$/, "")
    .replace(/^basic\s+/i, "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

const setKey = (s: string) => cmNameKey(s.replace(/\s*\([A-Za-z0-9-]{1,6}\)\s*$/, ""));

async function main() {
  const [singles, nonsingles] = await Promise.all([
    fetch(SINGLES).then((r) => r.json() as Promise<{ products: CmSingle[] }>),
    fetch(NONSINGLES).then((r) => r.json() as Promise<{ products: CmNonSingle[] }>),
  ]);
  const singlesByExp = new Map<number, CmSingle[]>();
  for (const r of singles.products) singlesByExp.set(r.idExpansion, [...(singlesByExp.get(r.idExpansion) ?? []), r]);
  const sealedByExp = new Map<number, CmNonSingle[]>();
  for (const r of nonsingles.products) sealedByExp.set(r.idExpansion, [...(sealedByExp.get(r.idExpansion) ?? []), r]);

  const sets = await prisma.cardSet.findMany({
    where: { language: "JP", cards: { some: {} } },
    select: {
      id: true, name: true, cmExpansionId: true,
      cards: {
        select: { id: true, name: true, number: true, cardmarketId: true, products: { where: { language: "JP" }, select: { id: true }, take: 1 } },
        orderBy: { numberSortKey: "asc" },
      },
    },
  });
  const cm = await prisma.retailer.findFirst({ where: { name: "Cardmarket" }, select: { id: true } });
  if (!cm) throw new Error("Retailer Cardmarket saknas");

  // ── Set utan cmExpansionId: härled ur sealed-katalogen (unikt namn krävs) ──
  const taken = new Set(sets.map((s) => s.cmExpansionId).filter((x): x is number => x != null));
  const derivedNames = new Map<string, number[]>();
  for (const [exp, rows] of sealedByExp) {
    if (taken.has(exp)) continue;
    const n = deriveJpSetName(rows);
    if (n) derivedNames.set(setKey(n), [...(derivedNames.get(setKey(n)) ?? []), exp]);
  }
  let expLinked = 0;
  for (const s of sets) {
    if (s.cmExpansionId != null) continue;
    const cands = derivedNames.get(setKey(s.name)) ?? [];
    if (cands.length === 1 && (singlesByExp.get(cands[0])?.length ?? 0) > 0) {
      console.log(`EXPANSION  ${s.name} ← cmExpansionId ${cands[0]} (${singlesByExp.get(cands[0])!.length} CM-singlar)`);
      s.cmExpansionId = cands[0];
      expLinked++;
      if (APPLY) await prisma.cardSet.update({ where: { id: s.id }, data: { cmExpansionId: cands[0] } });
    } else {
      console.log(`EXPANSION? ${s.name}: ${cands.length} kandidater — hoppar över`);
    }
  }

  // ── Kort → idProduct ──────────────────────────────────────────────────────
  const ops: { cardId: string; productId: string; idProduct: number; name: string }[] = [];
  let noName = 0, versionMismatch = 0, already = 0;
  for (const s of sets) {
    if (s.cmExpansionId == null) continue;
    const rows = (singlesByExp.get(s.cmExpansionId) ?? []).sort((a, b) => a.idProduct - b.idProduct);
    const cmGroups = new Map<string, CmSingle[]>();
    for (const r of rows) cmGroups.set(cmNameKey(r.name), [...(cmGroups.get(cmNameKey(r.name)) ?? []), r]);
    const ourGroups = new Map<string, typeof s.cards>();
    for (const c of s.cards) ourGroups.set(cmNameKey(c.name), [...(ourGroups.get(cmNameKey(c.name)) ?? []), c]);
    for (const [k, cards] of ourGroups) {
      const group = cmGroups.get(k);
      if (!group) { noName += cards.length; continue; }
      if (group.length !== cards.length) { versionMismatch += cards.length; continue; }
      cards.forEach((c, i) => {
        if (c.cardmarketId === group[i].idProduct) { already++; return; }
        if (c.products[0]) ops.push({ cardId: c.id, productId: c.products[0].id, idProduct: group[i].idProduct, name: c.name });
      });
    }
  }
  console.log(`\nKort: ${ops.length} att länka, ${already} redan länkade, ${noName} utan CM-namn, ${versionMismatch} med olika versionsantal (behåller söklänk). Set kopplade: ${expLinked}.`);
  console.log(ops.slice(0, 5).map((o) => `  ${o.name} → idProduct ${o.idProduct}`).join("\n"));

  if (APPLY) {
    let written = 0;
    await mapPool(ops, 8, async (o) => {
      await prisma.card.update({ where: { id: o.cardId }, data: { cardmarketId: o.idProduct } });
      const offer = await prisma.offer.findUnique({
        where: { productId_retailerId_condition_language: { productId: o.productId, retailerId: cm.id, condition: "NEAR_MINT", language: "JP" } },
        select: { id: true, url: true },
      });
      const url = cardmarketJapaneseProductUrl(o.idProduct);
      if (offer && (isCardmarketJpSearchUrl(offer.url) || offer.url !== url)) {
        await prisma.offer.update({ where: { id: offer.id }, data: { url } });
      } else if (!offer) {
        await prisma.offer.create({ data: { productId: o.productId, retailerId: cm.id, condition: "NEAR_MINT", language: "JP", price: null, currency: "SEK", stockStatus: "UNKNOWN", url } });
      }
      written++;
    });
    console.log(`SKRIVET: ${written} kort + offers.`);
  }
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
