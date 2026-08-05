/**
 * FRUSNA CARDMARKET-PRISER — vilka produkter visar ett pris som inte uppdaterats?
 *
 * Rapport, aldrig reparation. Läser bara, kostar ingen API-kvot alls.
 *
 *   node scripts/with-prod-db.mjs npx tsx scripts/frozen-cm-report.ts
 *   node scripts/with-prod-db.mjs npx tsx scripts/frozen-cm-report.ts --csv > frusna.csv
 *
 * Env: STALE_DAYS=3   hur många dygn utan uppdatering som räknas som fruset
 *
 * ⛔ MÄT PÅ `PriceObservation`, INTE `PriceSnapshot` — grafen byggs av den förra
 *    (`getPriceHistoryBySource` → `bucketObservationsBySource`). En mätning på
 *    snapshots ser rimlig ut men svarar på en annan fråga.
 *
 * ⚠️ "Sista punkt 2026-07-25" betyder INTE att kortet mättes den dagen. Ett
 *    engångs-backfill skrev då en CM-punkt för 20 153 singlar med deras BEFINTLIGA
 *    offer-pris — ett falskt livstecken. Kolumnen "offern rörd" är det ärliga måttet:
 *    den bumpas bara när en körning faktiskt hittade kortet.
 */
import { prisma } from "../src/lib/db";

const CSV = process.argv.includes("--csv");
const STALE_DAYS = Number(process.env.STALE_DAYS) || 3;

interface Row {
  title: string;
  slug: string;
  category: string;
  setname: string | null;
  variantlabel: string | null;
  priceore: number | null;
  lastseen: Date;
  lastobs: Date | null;
  hasid: boolean;
  url: string;
}

async function main() {
  const rows = await prisma.$queryRaw<Row[]>`
    SELECT p.title, p.slug, p.category::text AS category, cs.name AS setname,
           p."variantLabel" AS variantlabel, o.price AS priceore,
           o."lastSeenAt" AS lastseen, x.last AS lastobs,
           (o.url LIKE '%idProduct=%') AS hasid, o.url
    FROM "Product" p
    JOIN "Offer" o ON o."productId" = p.id
      AND o."retailerId" = (SELECT id FROM "Retailer" WHERE name = 'Cardmarket' LIMIT 1)
    LEFT JOIN "CardSet" cs ON cs.id = p."setId"
    LEFT JOIN (
      SELECT po."productId", MAX(po."observedAt") AS last
      FROM "PriceObservation" po
      JOIN "ScrapeSource" s ON s.id = po."sourceId"
      WHERE s.name = 'Cardmarket'
      GROUP BY po."productId"
    ) x ON x."productId" = p.id
    WHERE o.price IS NOT NULL
      AND o."lastSeenAt" < NOW() - (${STALE_DAYS} || ' days')::interval
    ORDER BY o."lastSeenAt" ASC
  `;

  if (CSV) {
    console.log("titel;set;kategori;tryckning;pris_kr;offern_rord;sista_grafpunkt;har_idProduct;url");
    for (const r of rows)
      console.log(
        [
          r.title.replace(/;/g, ","),
          r.setname ?? "",
          r.category,
          r.variantlabel ?? "",
          r.priceore != null ? (r.priceore / 100).toFixed(2).replace(".", ",") : "",
          r.lastseen.toISOString().slice(0, 10),
          r.lastobs ? r.lastobs.toISOString().slice(0, 10) : "",
          r.hasid ? "ja" : "nej",
          r.url,
        ].join(";")
      );
    return;
  }

  console.log(
    `FRUSNA CM-PRISER — ${rows.length} produkter vars CM-offer inte rörts på ≥${STALE_DAYS} dygn\n`
  );
  const byCat = new Map<string, number>();
  for (const r of rows) byCat.set(r.category, (byCat.get(r.category) ?? 0) + 1);
  for (const [c, n] of [...byCat].sort((a, b) => b[1] - a[1])) console.log(`  ${c.padEnd(15)} ${n}`);
  const noId = rows.filter((r) => !r.hasid).length;
  console.log(
    `\n  ${rows.length - noId} har idProduct i länken (guide-reserven kan rädda dem)\n` +
    `  ${noId} har bara en slug-länk → kör scripts/recover-cm-idproduct.ts\n`
  );

  console.log(
    "offern rörd | grafpunkt  | pris        | id | produkt"
  );
  for (const r of rows)
    console.log(
      [
        r.lastseen.toISOString().slice(0, 10),
        " | ",
        (r.lastobs ? r.lastobs.toISOString().slice(0, 10) : "—".padEnd(10)),
        " | ",
        (r.priceore != null ? (r.priceore / 100).toFixed(2) + " kr" : "–").padStart(11),
        " | ",
        r.hasid ? "ja" : "– ",
        " | ",
        r.title + (r.variantlabel ? ` [${r.variantlabel}]` : ""),
      ].join("")
    );
}

main()
  .catch((e) => {
    console.error("FEL:", (e as Error).message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
