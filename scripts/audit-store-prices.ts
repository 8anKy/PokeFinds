/**
 * REVISION: stämmer butikernas priser hos oss med butikens EGEN sida just nu?
 *
 *   node scripts/with-prod-db.mjs npx tsx scripts/audit-store-prices.ts
 *   node scripts/with-prod-db.mjs npx tsx scripts/audit-store-prices.ts --per-store 15 --store Webhallen
 *   node scripts/with-prod-db.mjs npx tsx scripts/audit-store-prices.ts --json out.json
 *
 * Rapport ONLY — skriver aldrig. Stickprov per butik (default 8 offers med direktlänk och
 * pris; hälften färskast sedda, hälften äldst sedda, så både "fel fält" och "fryst offer"
 * syns). Butikens pris läses på samma vägar som stock-verify (Shopifys `.js`, Webhallens
 * API, annars sidans JSON-LD) — ett tvetydigt svar (flera Product-noder med olika pris)
 * räknas som "vet inte", aldrig som en avvikelse.
 *
 * Avvikelser klassas: EX_VAT (vårt = live/1,25), INC_VAT (vårt = live×1,25), CURRENCY
 * (live ej SEK), STALE (offern inte sedd i feeden på > 2 dygn), FRESH_MISMATCH (sedd
 * nyligen men ändå fel = fel fält/fel produkt/variant), GONE (sidan borta).
 * Marknadsplatser (Cardmarket, CardTrader, Tradera) ingår inte — de har egna jobb.
 */
import { PrismaClient } from "@prisma/client";
import { writeFileSync } from "node:fs";
import { politeFetch } from "../src/scrapers/http";
import { liveStorePrice, classifyPriceMismatch, type LivePrice } from "../src/scrapers/store-price-audit";

const prisma = new PrismaClient();
const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const PER_STORE = Number(arg("--per-store") ?? 8);
const ONLY = arg("--store");
const JSON_OUT = arg("--json");
const MARKETPLACES = new Set(["Cardmarket", "CardTrader", "Tradera", "eBay"]);
const STALE_MS = 2 * 86_400_000;

interface Row {
  store: string;
  product: string;
  url: string;
  ourOre: number;
  live: LivePrice | null;
  lastSeenAgeH: number;
  verdict: string;
}

async function main() {
  const retailers = await prisma.retailer.findMany({
    where: { isActive: true, ...(ONLY ? { name: ONLY } : {}) },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
  const rows: Row[] = [];
  for (const r of retailers) {
    if (MARKETPLACES.has(r.name)) continue;
    const base = {
      retailerId: r.id,
      price: { gt: 0 },
      product: { hiddenAt: null },
    } as const;
    const half = Math.ceil(PER_STORE / 2);
    const select = { url: true, price: true, lastSeenAt: true, product: { select: { title: true } } } as const;
    const fresh = await prisma.offer.findMany({ where: base, select, orderBy: { lastSeenAt: "desc" }, take: half });
    const old = await prisma.offer.findMany({ where: base, select, orderBy: { lastSeenAt: "asc" }, take: PER_STORE - half });
    const seen = new Set<string>();
    const sample = [...fresh, ...old].filter((o) => (seen.has(o.url) ? false : (seen.add(o.url), true)));
    for (const o of sample) {
      const live = await liveStorePrice(r.name, o.url, politeFetch).catch(() => null);
      const ageH = (Date.now() - o.lastSeenAt.getTime()) / 3_600_000;
      const verdict = classifyPriceMismatch(o.price!, live, ageH * 3_600_000 > STALE_MS);
      rows.push({ store: r.name, product: o.product.title, url: o.url, ourOre: o.price!, live, lastSeenAgeH: Math.round(ageH), verdict });
      if (verdict !== "OK" && verdict !== "UNKNOWN") {
        console.log(
          `${verdict.padEnd(15)} ${r.name.padEnd(16)} ours ${(o.price! / 100).toFixed(2)} live ${live?.priceOre != null ? (live.priceOre / 100).toFixed(2) : "–"} ${live?.currency ?? ""} seen ${Math.round(ageH)}h  ${o.url}`
        );
      }
    }
    const mine = rows.filter((x) => x.store === r.name);
    const tally = mine.reduce<Record<string, number>>((a, x) => ((a[x.verdict] = (a[x.verdict] ?? 0) + 1), a), {});
    console.log(`== ${r.name}: ${mine.length} provade  ${JSON.stringify(tally)}`);
  }
  const total = rows.reduce<Record<string, number>>((a, x) => ((a[x.verdict] = (a[x.verdict] ?? 0) + 1), a), {});
  console.log(`\nTOTALT ${rows.length}: ${JSON.stringify(total)}`);
  if (JSON_OUT) writeFileSync(JSON_OUT, JSON.stringify(rows, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
