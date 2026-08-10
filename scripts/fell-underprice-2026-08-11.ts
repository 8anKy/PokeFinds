/**
 * FÄLLER 10 TRADERA-UNDERPRISANNONSER (ägargodkänt 2026-08-11) enligt Riolu-receptet
 * (2026-07-19): radera offern på OFFER-ID, skriv TraderaMatch ok=false för
 * (itemId, productId) så domen verkställs i både runner-loopen och verify-matches,
 * och radera annonsens förgiftade PriceObservations (matchade på rawData.itemId,
 * aldrig på pris — ett prisband kan träffa legitima observationer).
 *
 * Kyogre ★ · Delta Species (offer cmq9jqosi0cgectgz09gsokdu, itemId 742335928) FÄLLS
 * INTE — ägaren kontrollerade auktionen 2026-08-11: äkta annons, äkta rabatt. Den
 * kommer att fortsätta flaggas av veckorapporten (<15 %-tröskeln läser bara priser);
 * det är känt och accepterat.
 *
 *   node scripts/with-prod-db.mjs npx tsx scripts/fell-underprice-2026-08-11.ts          # torrkörning
 *   node scripts/with-prod-db.mjs npx tsx scripts/fell-underprice-2026-08-11.ts --apply  # verkställ
 */
import { PrismaClient } from "@prisma/client";
import { recomputeProductPriceCache } from "../src/services/products";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");
const REASON = "underpris <15% av CM-referensen — ägargodkänd fällning 2026-08-11 (veckorapporten 2026-08-10)";

const FELL: { offerId: string; itemId: string; label: string }[] = [
  { offerId: "cmq9jqp5i0elsctgzkhlfzmzz", itemId: "743244496", label: "Clefable · Jungle 1/64 (149 kr mot 8 776)" },
  { offerId: "cmq9jqp5g0eh6ctgzulhs5b2b", itemId: "740067860", label: "Jigglypuff · Base Set 2 (12 kr mot 560)" },
  { offerId: "cmq9jqoi40amxctgz8hqvxuuw", itemId: "739807179", label: "Vulpix · HS—Unleashed (23 kr mot 878)" },
  { offerId: "cmsbcyq1z011lmfl93zmfsre7", itemId: "742936010", label: "Paldean Fates: Smoliv Mini Tin (29 kr mot 433)" },
  { offerId: "cmrssvwke02gw3au05kxtlpor", itemId: "744142534", label: "Ascended Heroes: Riolu Mini Tin (19 kr mot 233)" },
  { offerId: "cmsmp7y7b01i648nak5wcme0j", itemId: "744142530", label: "BB&WF: Garbodor Mini Tin (19 kr mot 186)" },
  { offerId: "cmrrclpuq00hzgbjrnpo3sa68", itemId: "744142532", label: "BB&WF: Mienshao Mini Tin (19 kr mot 185)" },
  { offerId: "cms1g06t403qbe4fx2undh6dn", itemId: "738901335", label: "Zekrom · B&W 114/114 (annonsen är BW005-promon — fel kort)" },
  { offerId: "cmrssvxrp02h83au04y2cwl8i", itemId: "735516980", label: "BB&WF: Lilligant Mini Tin (19 kr mot 174)" },
  { offerId: "cmq9jqna30312ctgz25kg4f9c", itemId: "743694796", label: "Rayquaza VMAX TG20 (annonsen säger TG29 — fel kort)" },
];

async function main() {
  console.log(APPLY ? "== VERKSTÄLLER ==" : "== TORRKÖRNING (inga skrivningar) ==");
  for (const f of FELL) {
    const offer = await prisma.offer.findUnique({
      where: { id: f.offerId },
      select: { id: true, productId: true, price: true },
    });
    if (!offer) {
      console.log(`  SAKNAS (redan borta?): ${f.label} — ingen dom skriven, kontrollera manuellt`);
      continue;
    }
    // Förgiftade observationer: matcha på annonsens EGEN identitet i rawData.
    const obs = await prisma.priceObservation.findMany({
      where: { productId: offer.productId, source: { name: "Tradera" } },
      select: { id: true, rawData: true },
    });
    const poisoned = obs.filter((o) => {
      const raw = o.rawData as { itemId?: unknown } | null;
      return String(raw?.itemId ?? "") === f.itemId;
    });
    console.log(`  fäller: ${f.label} — offer ${offer.id}, ${poisoned.length} observationer`);
    if (!APPLY) continue;
    await prisma.traderaMatch.upsert({
      where: { itemId_productId: { itemId: f.itemId, productId: offer.productId } },
      create: { itemId: f.itemId, productId: offer.productId, ok: false, reason: REASON },
      update: { ok: false, reason: REASON },
    });
    if (poisoned.length) {
      await prisma.priceObservation.deleteMany({ where: { id: { in: poisoned.map((p) => p.id) } } });
    }
    await prisma.offer.delete({ where: { id: offer.id } });
  }
  if (APPLY) {
    await recomputeProductPriceCache();
    console.log("Pris-cache omräknad.");
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
