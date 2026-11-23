/**
 * VARFÖR STÅR FÖRSEGLAT SOM "UPPSKATTAT"? (2026-11-23, RAPPORT — skriver ingenting)
 *
 * Ägaren: "many products still say estimate, but the API is accurate" (Mega Evolution Fun Pack:
 * leverantören engelsk lägsta 1,36 €, vi visade en uppskattning på 783,75 kr). Rapporten hämtar
 * leverantörens förseglade lista + Cardmarkets prisguide och säger, per produkt som saknar ett
 * riktigt pris hos oss, VILKEN vakt som fäller leverantörens engelska `lowest` just nu.
 *
 * Körs i Actions (leverantörsnyckeln finns bara där): workflow "CM: uppskattat-rapport".
 *   npx tsx scripts/cm-sealed-estimate-report.ts
 */
import { prisma } from "../src/lib/db";
import {
  cmGuideRefEur,
  fetchCmGuide,
  FROM_LANG_CORROBORATE,
  isJunkLowOnLiquidMarket,
  lowIsCredible,
  sealedPremiumFromOk,
  THIN_ITEMS,
} from "../src/jobs/cardmarket-refresh";

interface Row {
  name: string;
  cardmarket_id: number | null;
  prices?: {
    cardmarket?: {
      lowest?: number | null;
      "30d_average"?: number | null;
      "7d_average"?: number | null;
      available_items?: number | null;
      lowest_DE?: number | null;
      lowest_FR?: number | null;
      lowest_ES?: number | null;
      lowest_IT?: number | null;
    } | null;
  } | null;
}

const HOST = process.env.CARDMARKET_RAPIDAPI_HOST ?? "cardmarket-api-tcg.p.rapidapi.com";
const KEY = process.env.CARDMARKET_RAPIDAPI_KEY ?? "";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function api<T>(url: string): Promise<T | null> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const r = await fetch(url, { headers: { "x-rapidapi-host": HOST, "x-rapidapi-key": KEY } });
    if (r.status === 429 || r.status >= 500) { await sleep(1000 * (attempt + 1)); continue; }
    if (!r.ok) return null;
    return (await r.json()) as T;
  }
  return null;
}

const f = (v: number | null | undefined) => (v == null ? "–" : v.toFixed(2));

async function main() {
  if (!KEY) throw new Error("CARDMARKET_RAPIDAPI_KEY saknas.");
  const cm = await prisma.retailer.findFirst({ where: { name: "Cardmarket" }, select: { id: true } });
  const offers = await prisma.offer.findMany({
    where: { retailerId: cm!.id, product: { hiddenAt: null, game: "POKEMON", language: "EN", category: { notIn: ["SINGLE_CARD", "GRADED_CARD"] } } },
    select: { url: true, price: true, stockStatus: true, product: { select: { title: true, slug: true } } },
  });
  const rows: Row[] = [];
  let page = 1, total = 1, calls = 0;
  do {
    const d = await api<{ data: Row[]; paging: { total: number } }>(`https://${HOST}/pokemon/products?page=${page}`);
    calls++;
    if (!d) throw new Error(`sida ${page}/${total} gick inte att hämta`);
    total = d.paging.total;
    rows.push(...d.data);
    await sleep(120);
  } while (page++ < total);
  const byId = new Map<number, Row>();
  for (const r of rows) if (r.cardmarket_id != null && !byId.has(r.cardmarket_id)) byId.set(r.cardmarket_id, r);
  const guide = await fetchCmGuide();

  const counts: Record<string, number> = {};
  const lines: string[] = [];
  let live = 0;
  for (const o of offers) {
    const isLive = o.stockStatus === "IN_STOCK" && o.price != null;
    if (isLive) { live++; continue; }
    const id = Number(/idProduct=(\d+)/.exec(o.url)?.[1] ?? NaN);
    const row = byId.get(id);
    const g = guide.get(id);
    const cmp = row?.prices?.cardmarket ?? {};
    const low = cmp.lowest ?? null;
    const avg = cmp["30d_average"] ?? null;
    const trend = cmGuideRefEur(g);
    const items = cmp.available_items ?? 0;
    const langLows = [cmp.lowest_DE, cmp.lowest_FR, cmp.lowest_ES, cmp.lowest_IT].filter((v): v is number => typeof v === "number" && v > 0);
    const corroborated = low != null && langLows.length > 0 && Math.min(...langLows) <= FROM_LANG_CORROBORATE * low && Math.max(...langLows.filter((v) => v <= 3 * low).concat(low)) >= low / FROM_LANG_CORROBORATE;
    let why: string;
    if (!Number.isFinite(id)) why = "ingen CM-länk med id";
    else if (!row) why = "saknas hos leverantören";
    else if (low == null) why = langLows.length ? "ingen ENGELSK lägsta (andra språk finns)" : "ingen lägsta alls";
    else if (isJunkLowOnLiquidMarket(low, avg ?? g?.avg30 ?? g?.avg ?? null, trend, items) && !corroborated) why = "likvid-golvet";
    else if (lowIsCredible(low, avg, trend) || sealedPremiumFromOk(low, g)) why = "GODKÄND NU (flippar / hålls av dag- eller historikvakt)";
    else if (trend != null && low > trend) why = "över taket (From > 3x trend)";
    else why = corroborated ? "UNDER GOLVET men andra språk ligger på samma nivå" : items > THIN_ITEMS ? "under golvet, obekräftad" : "under golvet, tunn marknad";
    counts[why] = (counts[why] ?? 0) + 1;
    lines.push(
      `${why.slice(0, 44).padEnd(44)} | ${o.product.title.slice(0, 52).padEnd(52)} | EN ${f(low).padStart(8)} | DE/FR/ES/IT ${langLows.map((v) => v.toFixed(2)).join("/") || "–"} | 30d ${f(avg)} | trend ${f(trend)} | ${items} ann | vi ${o.price != null ? Math.round(o.price / 100) + " kr" : "–"} ${o.stockStatus === "OUT_OF_STOCK" ? "uppsk." : ""}`
    );
  }
  console.log(`EN förseglat: ${offers.length} med CM-länk · ${live} riktigt pris · ${offers.length - live} uppskattat/utan pris. ${rows.length} rader hos leverantören (${calls} anrop).\n`);
  for (const [k, v] of Object.entries(counts).sort((a, b) => b[1] - a[1])) console.log(`${String(v).padStart(4)}  ${k}`);
  console.log("");
  for (const l of lines.sort()) console.log(l);
}
main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
