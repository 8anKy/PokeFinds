/**
 * PRODUKTBILDEN SKA VARA KORTETS BILD — synka de som glidit isär.
 *
 * `fix-card-images.ts` lagar `Card.imageUrl` (verifierad 200, hash-vaktad mot
 * Scrydex kortbaksida) men skriver bara `Product.imageUrl` när den var NULL.
 * Produkter som redan hade en bild behöll den — och den ruttnar på två sätt,
 * båda mätta 2026-09-22 på 30th Celebration (34 produkter):
 *  1. **TCGGO roterar storage-id:n** → `images.tcggo.com/…/storage/54972/…` 404:ar
 *     (Mew G/128, R/128) medan kortet hade en fungerande Scrydex-adress.
 *  2. **En Scrydex-URL byggd på ett `tcggo:`-id** (`…/pokemon/tcggo:65710/large`)
 *     svarar 200 med KORTETS BAKSIDA (Nidoran ♀ 87/128 visade en vänd Pokéboll).
 *
 * Regeln: kortets bild vinner när den bevisligen är en bild (200 + image/* + inte
 * baksidans hash). ⛔ Produktbilden rörs ALDRIG om kortets bild inte klarar det —
 * en trasig URL som ersätter en fungerande döljer bara felet.
 *
 * Efter en skarp körning kastas de rättade sidorna ur 30-dygnscachen via
 * `POST /api/revalidate { slugs }` — annars ser besökarna den gamla bilden i upp
 * till en månad. Kräver CRON_SECRET i miljön; utan den skrivs slug-listan ut.
 *
 *   node scripts/with-prod-db.mjs npx tsx scripts/sync-product-images-from-card.ts            # torrt
 *   node scripts/with-prod-db.mjs npx tsx scripts/sync-product-images-from-card.ts --apply    # skriver
 *   SET=<setId> …   # bara ett set
 */
import "dotenv/config";
import { createHash } from "node:crypto";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");
const SET = process.env.SET;
/** Ett id Scrydex saknar → de svarar 200 med baksidan. Referensen för hash-vakten. */
const CARD_BACK_PROBE = "https://images.scrydex.com/pokemon/tcggo:0/large";
const UA = "FoilioBot/1.0 (+https://foilio.se)";

async function probe(url: string): Promise<{ ok: boolean; hash: string }> {
  try {
    const r = await fetch(url, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(15_000) });
    if (!r.ok || !(r.headers.get("content-type") ?? "").startsWith("image/")) return { ok: false, hash: "" };
    const buf = Buffer.from(await r.arrayBuffer());
    return { ok: true, hash: createHash("md5").update(buf).digest("hex") };
  } catch {
    return { ok: false, hash: "" };
  }
}

async function revalidate(slugs: string[]) {
  const secret = process.env.CRON_SECRET?.trim();
  const base = process.env.SITE_URL ?? "https://foilio.se";
  if (!secret) {
    console.log(`CRON_SECRET saknas — kasta cachen själv:\n  ${slugs.join(" ")}`);
    return;
  }
  const r = await fetch(`${base}/api/revalidate`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-cron-secret": secret },
    body: JSON.stringify({ slugs }),
  });
  console.log(`revalidate → HTTP ${r.status} ${await r.text()}`);
}

async function main() {
  const back = await probe(CARD_BACK_PROBE);
  if (!back.ok) throw new Error("Kunde inte hämta Scrydex-baksidan — hash-vakten vore blind, avbryter.");

  const rows = await prisma.$queryRaw<{ id: string; slug: string; pimg: string | null; cimg: string | null }[]>`
    SELECT p.id, p.slug, p."imageUrl" AS pimg, c."imageUrl" AS cimg
    FROM "Product" p JOIN "Card" c ON c.id = p."cardId"
    WHERE p."imageUrl" IS DISTINCT FROM c."imageUrl"
      AND p."hiddenAt" IS NULL
      AND (${SET ?? null}::text IS NULL OR c."setId" = ${SET ?? null})
    ORDER BY p.slug`;
  console.log(`${rows.length} produkter skiljer sig från sitt kort${APPLY ? "" : " (torrkörning)"}`);

  const synced: string[] = [];
  let broken = 0;
  let skipped = 0;
  for (const r of rows) {
    if (!r.cimg) {
      skipped++;
      continue;
    }
    const c = await probe(r.cimg);
    if (!c.ok || c.hash === back.hash) {
      console.log(`SKIP  ${r.slug} — kortets bild duger inte (${r.cimg})`);
      skipped++;
      continue;
    }
    const p = r.pimg ? await probe(r.pimg) : { ok: false, hash: "" };
    const wasBroken = !p.ok || p.hash === back.hash;
    if (wasBroken) broken++;
    console.log(`${wasBroken ? "FIX " : "SYNC"}  ${r.slug} → ${r.cimg}`);
    if (APPLY) await prisma.product.update({ where: { id: r.id }, data: { imageUrl: r.cimg } });
    synced.push(r.slug);
  }
  console.log({ synced: synced.length, broken, skipped, apply: APPLY });
  if (APPLY && synced.length) await revalidate(synced);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
