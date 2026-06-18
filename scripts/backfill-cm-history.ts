/**
 * Backfill av ÄKTA daglig CM-prishistorik via CardMarket API TCG (RapidAPI).
 * Endpoint `/pokemon/cards/history?tcgid={tcgid}` ger historiska dagliga priser
 * per kort (bekräftad existens 2026-06-18; svarsform verifieras med DESCRIBE=1).
 *
 * En historikpunkt = en PriceObservation (källa "Cardmarket") daterad observedAt
 * = den historiska dagen → produktgrafen (getPriceHistoryBySource) får riktiga
 * dagliga punkter bakåt i tiden. Idempotent: hoppar (productId,dag) vi redan har.
 *
 * Kvot: 3000/dygn, ~20k singlar → körs popularast-först, resumerbar, MAX_CALLS/
 * körning. Kör några dagar tills hela katalogen är ifylld; den dagliga
 * cardmarket-refresh håller den à jour framåt.
 *
 *   DESCRIBE=1 npx tsx scripts/backfill-cm-history.ts   # dumpa råsvaret för 1 kort
 *   APPLY=1   npx tsx scripts/backfill-cm-history.ts     # skriv historik
 *   Mot prod: DATABASE_URL="$NEON_DATABASE_URL" APPLY=1 npx tsx scripts/backfill-cm-history.ts
 */
import * as fs from "fs";
import * as path from "path";
const envPath = path.join(process.cwd(), ".env");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.+?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
import { PrismaClient } from "@prisma/client";
import { getRatesOre } from "../src/lib/exchange-rate";

const prisma = new PrismaClient();
const HOST = process.env.CARDMARKET_RAPIDAPI_HOST ?? "cardmarket-api-tcg.p.rapidapi.com";
const KEY = process.env.CARDMARKET_RAPIDAPI_KEY ?? "";
const APPLY = process.env.APPLY === "1";
const DESCRIBE = process.env.DESCRIBE === "1";
const MAX_CALLS = parseInt(process.env.MAX_CALLS ?? "2500", 10); // lämna marginal under 3000
const THROTTLE_MS = parseInt(process.env.THROTTLE_MS ?? "220", 10);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let remaining = Infinity;
async function api(url: string): Promise<any | null> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const r = await fetch(url, { headers: { "x-rapidapi-host": HOST, "x-rapidapi-key": KEY } });
    const rem = r.headers.get("x-ratelimit-requests-remaining");
    if (rem != null) remaining = parseInt(rem, 10);
    if (r.status === 429) { console.error("KVOT SLUT (429) — avbryter."); return "QUOTA"; }
    if (r.status >= 500) { await sleep(1000 * (attempt + 1)); continue; }
    if (!r.ok) return null;
    return await r.json();
  }
  return null;
}

/**
 * Plockar dagliga {date, priceEur} ur ett (ännu overifierat) historiksvar.
 * Robust mot formvarianter: hittar en array och i varje post ett datum-fält
 * (date/day/timestamp) + ett pris-fält (prefererar trend → avg → lowest_near_mint).
 */
function parseHistory(json: any): { date: string; eur: number }[] {
  const arr: any[] = Array.isArray(json) ? json
    : Array.isArray(json?.data) ? json.data
    : Array.isArray(json?.history) ? json.history
    : Array.isArray(json?.data?.history) ? json.data.history
    : Array.isArray(json?.prices) ? json.prices : [];
  const out: { date: string; eur: number }[] = [];
  for (const p of arr) {
    const rawDate = p.date ?? p.day ?? p.timestamp ?? p.created_at ?? p.t;
    const eur = p.trend ?? p.trend_price ?? p.avg ?? p.average ?? p.lowest_near_mint ?? p.low ?? p.price;
    if (rawDate == null || eur == null) continue;
    const d = new Date(rawDate);
    if (isNaN(d.getTime())) continue;
    out.push({ date: d.toISOString().slice(0, 10), eur: Number(eur) });
  }
  return out;
}

async function main() {
  if (!KEY) throw new Error("CARDMARKET_RAPIDAPI_KEY saknas.");
  const dbName = (await prisma.$queryRawUnsafe<{ d: string }[]>("select current_database() as d"))[0].d;

  if (DESCRIBE) {
    const sample = await prisma.card.findFirst({ where: { tcgExternalId: { not: null } }, select: { tcgExternalId: true } });
    const url = `https://${HOST}/pokemon/cards/history?tcgid=${encodeURIComponent(sample!.tcgExternalId!)}`;
    const json = await api(url);
    console.log("RÅSVAR för", sample!.tcgExternalId, ":\n", JSON.stringify(json, null, 2).slice(0, 2000));
    console.log("\nTolkade punkter:", parseHistory(json).slice(0, 5), "...");
    await prisma.$disconnect();
    return;
  }

  const { eurToOre } = await getRatesOre();
  const cmSource = await prisma.scrapeSource.findFirst({ where: { name: "Cardmarket" }, select: { id: true } });
  if (!cmSource) throw new Error("Cardmarket-källa saknas.");
  console.log(`DB=${dbName} · APPLY=${APPLY} · MAX_CALLS=${MAX_CALLS} · EUR→öre=${eurToOre}\n`);

  // Populäraste först. Hoppa kort som redan har ≥10 CM-historikpunkter (gjorda).
  const cards = await prisma.product.findMany({
    where: { category: "SINGLE_CARD", card: { tcgExternalId: { not: null } } },
    select: { id: true, viewCount: true, card: { select: { tcgExternalId: true } } },
    orderBy: { viewCount: "desc" },
  });

  let calls = 0, wrote = 0, skipped = 0, done = 0;
  for (const p of cards) {
    if (calls >= MAX_CALLS) { console.log(`Nådde MAX_CALLS (${MAX_CALLS}) — pausar (resumerbar).`); break; }
    const tcgid = p.card!.tcgExternalId!;
    // Redan ifylld? (≥10 dagars CM-historik) → hoppa, gör backfill resumerbar.
    const have = await prisma.priceObservation.count({ where: { productId: p.id, source: { name: "Cardmarket" } } });
    if (have >= 10) { skipped++; continue; }

    const json = await api(`https://${HOST}/pokemon/cards/history?tcgid=${encodeURIComponent(tcgid)}`);
    calls++;
    if (json === "QUOTA") break;
    await sleep(THROTTLE_MS);
    if (!json) continue;
    const pts = parseHistory(json);
    if (pts.length === 0) continue;

    if (APPLY) {
      // Skriv bara dagar vi inte redan har (dedupe per dag).
      const existing = new Set(
        (await prisma.priceObservation.findMany({
          where: { productId: p.id, source: { name: "Cardmarket" } },
          select: { observedAt: true },
        })).map((o) => o.observedAt.toISOString().slice(0, 10))
      );
      const rows = pts
        .filter((pt) => !existing.has(pt.date))
        .map((pt) => ({ productId: p.id, sourceId: cmSource.id, price: Math.round(pt.eur * eurToOre), currency: "SEK", observedAt: new Date(pt.date + "T12:00:00Z") }));
      if (rows.length) { await prisma.priceObservation.createMany({ data: rows }); wrote += rows.length; }
    }
    done++;
    if (done % 100 === 0) console.log(`  ${done} kort, ${wrote} punkter, ${calls} anrop (kvot kvar ${remaining})`);
  }
  console.log(`\nKlart: ${done} kort behandlade, ${wrote} historikpunkter skrivna, ${skipped} redan ifyllda, ${calls} anrop (kvot kvar ${remaining}).`);
  if (!APPLY) console.log("(dry run — kör APPLY=1 för att skriva)");
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
