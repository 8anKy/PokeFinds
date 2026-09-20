/**
 * TVILLINGAR NÄR POKEMONTCG.IO DELAR ETT SLÄPP I HUVUDSET + UNDERSET (2026-09-20).
 *
 * `import-en-set-from-provider.ts` skapar ALLA kort i ett släpp i ETT set (leverantören
 * har en episod), med leverantörens nummer — Classic Collection-korten heter där
 * "BS004" (Base Set Charizard), "PLB097", "TM099". När pokemontcg.io kommer ikapp
 * lägger den samma kort i ett EGET set ("30th Celebration: Classic Collection", me55c)
 * med nummer "4", "97", "99", och söndagsimportens adoption (samma set + samma nummer)
 * hittar dem inte. Resultat 2026-09-20: 30 kort TVÅ gånger — leverantörens rad i me55
 * med pris, historik och användarnas samlingsposter; pokemontcg.io:s rad i me55c
 * tom. Prisjobbet blev rött ("me55c har 30 singlar och 0 CM-offers").
 *
 * Mergen behåller det BÄSTA av båda: pokemontcg.io:s KORT (kanonisk identitet,
 * `tcgExternalId`, bild, rarity) och leverantörens PRODUKT (slug, offers, historik,
 * bevakningar, samlingsposter). Leverantörens `cardmarketId` följer med till kortet.
 * Den tomma pokemontcg.io-produkten mergas in i den behållna (mergeStubInto) och
 * leverantörens kortrad raderas.
 *
 *   node scripts/with-prod-db.mjs npx tsx scripts/merge-subset-twins.ts --parent me55
 *   ... --apply     # skriver
 *
 * Matchning är EXAKT: samma namn (cmCardNameAgrees) OCH samma nummer när ursprungs-
 * setets kod skalats av (cmNumberKeyOriginCode) — eller namnet ensamt när exakt ETT
 * kort i målsetet håller med. Tvetydigt ⇒ paret listas och hoppas över.
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "../src/lib/db";
import { exitJob } from "../src/lib/job-exit";
import { normalizeTitle } from "../src/lib/utils";
import { mergeStubInto } from "../src/jobs/dedupe-stubs";
import {
  cmCardNameAgrees,
  cmNumberKey,
  cmNumberKeyOriginCode,
  cmSubsetParentKey,
  cmSetNameKey,
  pickBestSubsetHit,
  pickSubsetCandidate,
} from "../src/jobs/cardmarket-refresh";

const APPLY = process.argv.includes("--apply");
const arg = (n: string) => {
  const i = process.argv.indexOf(n);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const PROVIDER_PREFIX = "tcggo:";

function productTitle(name: string, setName: string, number: string, printedTotal: number): string {
  const denom = printedTotal > 0 ? `/${printedTotal}` : "";
  return `${name} · ${setName} ${number}${denom}`;
}

const cardSelect = {
  id: true, setId: true, number: true, name: true, tcgExternalId: true, cardmarketId: true, imageUrl: true,
  products: {
    where: { category: "SINGLE_CARD" as const, variantLabel: null },
    select: {
      id: true, slug: true, imageUrl: true,
      _count: { select: { offers: true, priceSnapshots: true, collectionItems: true, watchlistItems: true } },
    },
  },
  _count: { select: { collectionItems: true } },
};
type CardRow = Awaited<ReturnType<typeof loadCards>>[number];
function loadCards(where: Prisma.CardWhereInput) {
  return prisma.card.findMany({ where, select: cardSelect });
}

async function main() {
  const parentExt = arg("--parent");
  if (!parentExt) throw new Error("Ange --parent <externalId> (t.ex. me55).");
  const parent = await prisma.cardSet.findUnique({
    where: { externalId: parentExt },
    select: { id: true, name: true, totalCards: true },
  });
  if (!parent) throw new Error(`Inget set med externalId ${parentExt}.`);

  // Målset = huvudsetet självt + alla EN-underset med huvudsetets namn som prefix.
  const parentKey = cmSetNameKey(parent.name);
  const allSets = await prisma.cardSet.findMany({
    where: { language: "EN" },
    select: { id: true, name: true, externalId: true, totalCards: true },
  });
  const targets = allSets.filter((s) => s.id === parent.id || cmSubsetParentKey(s.name) === parentKey);
  console.log(
    `Huvudset "${parent.name}" + ${targets.length - 1} underset: ` +
    (targets.filter((s) => s.id !== parent.id).map((s) => s.name).join(", ") || "–"),
  );

  const providerCards = await loadCards({ setId: parent.id, tcgExternalId: { startsWith: PROVIDER_PREFIX } });
  console.log(`${providerCards.length} leverantörskort (${PROVIDER_PREFIX}…) kvar i huvudsetet.\n`);
  if (providerCards.length === 0) return;

  // Kandidater per målset: pokemontcg.io-kort (tcgExternalId utan leverantörsprefix).
  const bySet = new Map<string, { entry: CardRow; cardName: string; numKey: string }[]>();
  for (const s of targets) {
    const cards = await loadCards({
      setId: s.id,
      tcgExternalId: { not: null },
      NOT: { tcgExternalId: { startsWith: PROVIDER_PREFIX } },
    });
    bySet.set(s.id, cards.map((c) => ({ entry: c, cardName: c.name, numKey: cmNumberKey(c.number) })));
  }

  let merged = 0, skipped = 0;
  for (const prov of providerCards) {
    // "B/RGB" (leverantören) mot "B" (pokemontcg.io): första ledet före snedstrecket.
    const numKeys = [...new Set([cmNumberKeyOriginCode(prov.number), cmNumberKey(prov.number.split("/")[0])])];
    const hits: { set: (typeof targets)[number]; card: CardRow; viaNumber: boolean; exact: boolean }[] = [];
    for (const s of targets) {
      const cands = bySet.get(s.id) ?? [];
      for (const k of numKeys) {
        const picked = pickSubsetCandidate(cands, prov.name, k);
        if (picked) { hits.push({ set: s, card: picked.entry, viaNumber: picked.viaNumber, exact: picked.exact }); break; }
      }
    }
    // Nummerträff slår namnträff (Lugia AQ149: me55c #149 vinner över me55 #121), exakt
    // namn slår prefix (TEU033: "Pikachu & Zekrom-GX" i me55c vinner över Pikachu #33 i me55).
    const best = pickBestSubsetHit(hits);
    if (!best) {
      const why = hits.length === 0 ? "ingen tvilling" : `TVETYDIG (${hits.map((h) => `${h.set.name} #${h.card.number}`).join(" / ")})`;
      console.log(`⏭️  ${prov.number.padEnd(7)} ${prov.name.padEnd(30)} — ${why}`);
      skipped++;
      continue;
    }
    const { set, card: twin } = best;
    const keepProduct = prov.products[0];
    const emptyProduct = twin.products[0];
    if (!keepProduct) {
      console.log(`⏭️  ${prov.number} ${prov.name} — leverantörskortet saknar produkt, hoppar.`);
      skipped++;
      continue;
    }
    const kc = keepProduct._count;
    const ec = emptyProduct?._count;
    console.log(
      `🔀 ${prov.number.padEnd(7)} ${prov.name.padEnd(30)} → ${set.externalId ?? set.name} #${twin.number} (${twin.tcgExternalId})` +
      `  behåller ${keepProduct.slug} [offers ${kc.offers}, hist ${kc.priceSnapshots}, saml ${kc.collectionItems}]` +
      (ec ? `; mergar in ${emptyProduct!.slug} [offers ${ec.offers}, hist ${ec.priceSnapshots}, saml ${ec.collectionItems}]` : "; ingen tvillingprodukt") +
      (!cmCardNameAgrees(prov.name, twin.name) ? "  ⚠️ namn" : ""),
    );
    if (!APPLY) { merged++; continue; }

    await prisma.$transaction(async (tx) => {
      // 1. Kortet: pokemontcg.io:s rad behålls; leverantörens cardmarketId följer med.
      //    ⛔ Kolumnen är UNIK — släpp den från leverantörsraden FÖRST, annars P2002.
      if (prov.cardmarketId != null && twin.cardmarketId == null) {
        await tx.card.update({ where: { id: prov.id }, data: { cardmarketId: null } });
        await tx.card.update({ where: { id: twin.id }, data: { cardmarketId: prov.cardmarketId } });
      }
      // 2. Samlingsposter som pekar på leverantörens KORT → tvillingen.
      await tx.collectionItem.updateMany({ where: { cardId: prov.id }, data: { cardId: twin.id } });
      // 3. Produkten: flytta till tvillingens kort + set, ny titel i pokemontcg.io:s format.
      const title = productTitle(twin.name, set.name, twin.number, set.totalCards);
      await tx.product.update({
        where: { id: keepProduct.id },
        data: { cardId: twin.id, setId: set.id, title, normalizedTitle: normalizeTitle(title) },
      });
    });
    // 4. Den tomma pokemontcg.io-produkten in i den behållna (butiks-offers/samlingar/
    //    bevakningar följer med, marknadsplatslänkar raderas — kanonprodukten har redan sin).
    if (emptyProduct) await mergeStubInto(emptyProduct.id, keepProduct.id, () => {});
    // 5. Leverantörens kortrad bort (inga produkter, inga samlingsposter kvar).
    const rest = await prisma.card.findUnique({
      where: { id: prov.id },
      select: { _count: { select: { products: true, collectionItems: true } } },
    });
    if (rest && rest._count.products === 0 && rest._count.collectionItems === 0) {
      await prisma.card.delete({ where: { id: prov.id } });
    } else {
      console.log(`   ⚠️ leverantörskortet ${prov.id} har fortfarande ${rest?._count.products} produkter / ${rest?._count.collectionItems} samlingsposter — lämnas.`);
    }
    merged++;
  }
  console.log(`\n${APPLY ? "Mergade" : "Skulle merga"}: ${merged}, hoppade: ${skipped}.${APPLY ? "" : " Kör med --apply för att skriva."}`);
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => exitJob());
