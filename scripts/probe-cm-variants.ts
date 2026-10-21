/**
 * PROBE: leverantörens `?include_variants=1` (2026-10-21, Ultra/Mega). Ger den ett ENGELSKT
 * NM-pris för Reverse Holo / Poké Ball / Master Ball, och kostar parametern extra kvot?
 *
 *   node scripts/with-prod-db.mjs npx tsx scripts/probe-cm-variants.ts sv3pt5-1 me1-1 …
 *   node scripts/with-prod-db.mjs npx tsx scripts/probe-cm-variants.ts --raw sv3pt5-1
 *
 * Jämför varje variant mot CM:s prisguide (reverseHoloLow/Trend — alla språk/skick) och mot
 * vår CardTrader-offer på samma kort. Skriver ALDRIG ut nyckeln. Två anrop per tcgid.
 */
import { PrismaClient } from "@prisma/client"; // laddar .env

const prisma = new PrismaClient();
const HOST = process.env.CARDMARKET_RAPIDAPI_HOST ?? "cardmarket-api-tcg.p.rapidapi.com";
const KEY = process.env.CARDMARKET_RAPIDAPI_KEY ?? "";
const CM_GUIDE = "https://downloads.s3.cardmarket.com/productCatalog/priceGuide/price_guide_6.json";
const RAW = process.argv.includes("--raw");
const TCGIDS = process.argv.slice(2).filter((a) => !a.startsWith("--"));

async function api(url: string): Promise<{ body: any; remaining: string | null }> {
  const r = await fetch(url, { headers: { "x-rapidapi-host": HOST, "x-rapidapi-key": KEY } });
  const remaining = r.headers.get("x-ratelimit-requests-remaining");
  if (!r.ok) {
    console.error(`  HTTP ${r.status} ${(await r.text()).slice(0, 300)}`);
    return { body: null, remaining };
  }
  return { body: await r.json(), remaining };
}

async function main() {
  if (!KEY) throw new Error("CARDMARKET_RAPIDAPI_KEY saknas i .env");
  const g = await fetch(CM_GUIDE);
  const guide = new Map<number, Record<string, number>>(
    ((await g.json()) as { priceGuides: Record<string, number>[] }).priceGuides.map((e) => [e.idProduct, e])
  );

  for (const id of TCGIDS) {
    const plain = await api(`https://${HOST}/pokemon/cards?tcgid=${encodeURIComponent(id)}`);
    const withV = await api(`https://${HOST}/pokemon/cards?tcgid=${encodeURIComponent(id)}&include_variants=1`);
    console.log(`\n=== ${id}  kvot kvar: ${plain.remaining} → ${withV.remaining}`);
    const rows = (withV.body?.data ?? []) as any[];
    if (RAW) console.log(JSON.stringify(rows.slice(0, 2), null, 2));
    for (const row of rows) {
      const cmId = row.cardmarket_id ?? row.prices?.cardmarket?.cardmarket_id ?? null;
      const g0 = cmId ? guide.get(Number(cmId)) : undefined;
      console.log(
        `  ${row.name} #${row.card_number} ${row.version ?? ""}  idProduct=${cmId}  From=${row.prices?.cardmarket?.lowest_near_mint ?? "–"} €`
      );
      if (g0) console.log(`    guide: low=${g0.low} trend=${g0.trend} | reverseHoloLow=${g0["reverseHoloLow"]} reverseHoloTrend=${g0["reverseHoloTrend"]}`);
      const vs = (row.variants ?? null) as any[] | null;
      if (vs === null) console.log("    variants: (fältet saknas)");
      for (const v of vs ?? []) {
        const vg = v.id ? guide.get(Number(v.id)) : undefined;
        console.log(`    variant ${JSON.stringify(v)}${vg ? `  | guide för id: low=${vg.low} trend=${vg.trend}` : ""}`);
      }
    }
    // Vår CardTrader-offer på samma kort (Reverse Holo-produkten).
    const products = await prisma.product.findMany({
      where: { card: { tcgExternalId: id } },
      select: {
        title: true,
        variantLabel: true,
        offers: { select: { price: true, url: true, retailer: { select: { name: true } } } },
      },
    });
    for (const p of products) {
      const o = p.offers.map((x) => `${x.retailer.name}=${x.price != null ? (x.price / 100).toFixed(2) : "–"} kr`).join(", ");
      console.log(`  vår produkt: ${p.title} [${p.variantLabel ?? "ordinarie"}]  ${o}`);
    }
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
