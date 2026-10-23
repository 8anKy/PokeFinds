/**
 * Skriver "Rek. pris (EU)" (`Product.euRrpCents`) ur sealed-raderna som cardmarket-refresh
 * REDAN hämtar varje natt — noll extra anrop mot leverantören. Domen (vilka tal som är ett
 * trovärdigt europris) bor i lib/eu-rrp.ts.
 *
 * Nyckeln är EXAKT: radens `cardmarket_id` mot idProduct i produktens Cardmarket-länk, aldrig
 * namn. Anropas EFTER att cardmarket_id återfunnits ur CM-katalogen för nya set.
 *
 * En fråga för att läsa, en update per produkt vars värde ÄNDRATS (normalt 0 efter första
 * natten). Körs i ett jobb där Neon redan är vaken.
 */
import type { PrismaClient } from "@prisma/client";
import { euRrpByCmId, type EuRrpRow } from "@/lib/eu-rrp";

export interface EuRrpSyncResult {
  withRrp: number;
  changed: number;
  cleared: number;
}

export async function syncEuRrp(
  prisma: PrismaClient,
  rows: readonly EuRrpRow[],
  opts: { dryRun?: boolean } = {}
): Promise<EuRrpSyncResult> {
  const byCmId = euRrpByCmId(rows);
  const offers = await prisma.offer.findMany({
    where: {
      retailer: { name: "Cardmarket" },
      url: { contains: "idProduct=" },
      product: { category: { notIn: ["SINGLE_CARD", "GRADED_CARD", "ACCESSORY"] } },
    },
    select: { url: true, product: { select: { id: true, euRrpCents: true } } },
  });

  const res: EuRrpSyncResult = { withRrp: 0, changed: 0, cleared: 0 };
  const writes: { id: string; cents: number | null }[] = [];
  const seen = new Set<string>();
  for (const o of offers) {
    const m = o.url.match(/idProduct=(\d+)/);
    if (!m || seen.has(o.product.id)) continue;
    seen.add(o.product.id);
    const id = parseInt(m[1], 10);
    if (!byCmId.has(id)) continue; // inte listad i dag ⇒ rör inte
    const cents = byCmId.get(id) ?? null;
    if (cents != null) res.withRrp++;
    if (cents === o.product.euRrpCents) continue;
    if (cents == null) res.cleared++;
    else res.changed++;
    writes.push({ id: o.product.id, cents });
  }

  if (!opts.dryRun) {
    const now = new Date();
    for (const w of writes) {
      await prisma.product.update({
        where: { id: w.id },
        data: { euRrpCents: w.cents, euRrpAt: w.cents == null ? null : now },
      });
    }
  }
  console.log(
    `[eu-rrp] ${res.withRrp} sealed med EU-riktpris · ${res.changed} nya/ändrade · ${res.cleared} tömda` +
      (opts.dryRun ? " (torrkörning)" : "")
  );
  return res;
}
