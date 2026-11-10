/**
 * One Piece-kort som leverantören gett SAMMA Cardmarket-id som ett annat kort (11 st 2026-11-10).
 * Kortet som skapades utan cardmarketId fick ändå en CM-offer med det andra kortets länk och pris.
 *
 *   node scripts/with-prod-db.mjs npx tsx scripts/op-duplicate-cm-ids.ts           (rapport)
 *   node scripts/with-prod-db.mjs npx tsx scripts/op-duplicate-cm-ids.ts --apply   (tar bort de lånade offerna)
 *
 * ⛔ Identiteten gissas aldrig: kortet som FICK id:t behåller sin offer, det andra blir prislöst ("–").
 * Samma titel som ägaren (leverantören listar promon två gånger) ⇒ dubbletten döljs dessutom.
 */
import { prisma } from "../src/lib/db";
import { exitJob } from "../src/lib/job-exit";
import { OP_CARD_EXTERNAL_PREFIX } from "../src/jobs/op-singles-import";

async function main() {
  const apply = process.argv.includes("--apply");
  const rows = await prisma.$queryRaw<{ offerId: string; productId: string; title: string; url: string; owner: string | null }[]>`
    SELECT o.id AS "offerId", p.id AS "productId", p.title, o.url,
           (SELECT p2.title FROM "Card" c2 JOIN "Product" p2 ON p2."cardId" = c2.id
             WHERE c2."cardmarketId" = substring(o.url from 'idProduct=([0-9]+)')::int LIMIT 1) AS owner
      FROM "Offer" o
      JOIN "Product" p ON p.id = o."productId"
      JOIN "Card" c ON c.id = p."cardId"
      JOIN "Retailer" r ON r.id = o."retailerId"
     WHERE r.name = 'Cardmarket' AND p.game::text = 'ONE_PIECE' AND p.category = 'SINGLE_CARD'
       AND c."tcgExternalId" LIKE ${OP_CARD_EXTERNAL_PREFIX + "%"} AND c."cardmarketId" IS NULL`;
  for (const r of rows) console.log(`  ${r.title}  →  länken tillhör: ${r.owner ?? "(inget kort)"}`);
  console.log(`${rows.length} lånade offers`);
  if (!apply || rows.length === 0) return;
  const del = await prisma.offer.deleteMany({ where: { id: { in: rows.map((r) => r.offerId) } } });
  const dupes = rows.filter((r) => r.owner === r.title).map((r) => r.productId);
  const hid = await prisma.product.updateMany({ where: { id: { in: dupes }, hiddenAt: null }, data: { hiddenAt: new Date() } });
  console.log(`Borttagna offers: ${del.count}, dolda dubbletter: ${hid.count}`);
}
main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => exitJob());
