/**
 * FÄLLER 1 TRADERA-UNDERPRISANNONS (ägargenomgång 2026-08-26) enligt Riolu-receptet
 * (2026-07-19): radera offern på OFFER-ID, skriv TraderaMatch ok=false för
 * (itemId, productId) så domen verkställs i både runner-loopen och verify-matches,
 * och radera annonsens förgiftade PriceObservations (matchade på rawData.itemId,
 * aldrig på pris — ett prisband kan träffa legitima observationer).
 *
 * ⛔ SEX AV SJU FÄLLS INTE. Ägaren öppnade varje annons; underpris-rapporten läser bara
 * priser och kan inte se det den såg. De kommer fortsätta flaggas varje vecka — känt och
 * accepterat, precis som Kyogre ★ 2026-08-11.
 *   • Yveltal · XY32, Ninetales · Base 12/102, Dark Dragonair · TRR 31/109,
 *     Groudon · Emerald 5/106 — ÄKTA annonser. CM-referensen är hög för att det är
 *     ENDA annonsen på en tunn marknad, inte för att Tradera-priset är fel.
 *   • Exploud ex · CG 92/100 — får ligga, CM-priset rättar sig självt senare.
 *   • Professor Elm's Training Method · DF 79/101 — TRADERA HAR RÄTT (9 kr mot CM:s
 *     riktiga From 0,10 €). Det är VÅRT CM-pris som är fel: 22 769 öre skrevs
 *     2026-08-25 mot ~310 öre dagarna före. Egen bugg, egen fix — se
 *     `singlesHeadlineEur`/guide-uppslaget i cardmarket-refresh.ts. Fälls INTE här;
 *     annonsen är korrekt och en dom hade dolt vårt eget fel.
 *
 *   node scripts/with-prod-db.mjs npx tsx scripts/fell-underprice-2026-08-26.ts          # torrkörning
 *   node scripts/with-prod-db.mjs npx tsx scripts/fell-underprice-2026-08-26.ts --apply  # verkställ
 */
import { PrismaClient } from "@prisma/client";
import { recomputeProductPriceCache } from "../src/services/products";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");
const REASON =
  "annonsen visar ett ANNAT kort än titeln (säljaren skrev fel namn) — ägargranskad fällning 2026-08-26";

const FELL: { offerId: string; itemId: string; label: string }[] = [
  {
    offerId: "cmsdk7f5t04gd11ra7vctd0j5",
    itemId: "745872872",
    label: "Dialga · Diamond & Pearl 1/130 (59 kr mot 476) — annonsen är fel vara, fel namn i titeln",
  },
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
