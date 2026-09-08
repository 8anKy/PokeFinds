/**
 * VAD SAKNAS UR TCGGO:s SEALED-KATALOG? Ren rapport, inga skrivningar.
 *
 *   node scripts/with-prod-db.mjs npx tsx scripts/audit-tcggo-sealed-gap.ts
 *
 * ÄGARENS REGEL (2026-09-08): importera engelska sealed-produkter som har en RIKTIG
 * Cardmarket-länk, dvs ett EU-pris ("EU LOW" på tcggo). Produkter med BARA ett
 * US/TCGplayer-pris ska INTE in — "Chaos Rising: Booster Pack Art Set" har EU LOW
 * N/A och hör inte hemma i en svensk prisjämförelse.
 *
 * ⛔ `cardmarket_id` och EU-priset är OLIKA fält och följs inte åt: "Delta Reign
 *    Sleeved Booster" har `cardmarket_id: null` men `lowest: 7.99`. Testet på ÄGARENS
 *    kriterium är PRISET; id:t är en separat fråga (kan återfinnas ur CM:s gratiskatalog
 *    på exakt namn, se lib/cm-catalog-names.ts).
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
import { normalizeTitle } from "../src/lib/utils";

const prisma = new PrismaClient();
const HOST = process.env.CARDMARKET_RAPIDAPI_HOST ?? "cardmarket-api-tcg.p.rapidapi.com";
const KEY = process.env.CARDMARKET_RAPIDAPI_KEY ?? "";
const CACHE = path.join(process.cwd(), ".cache", "rapidapi-sealed.json");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface ApiProduct {
  id: number; name: string; slug?: string; cardmarket_id: number | null; tcgplayer_id?: number | null;
  image?: string; tcggo_url?: string;
  prices?: { cardmarket?: { lowest?: number | null; lowest_EU_only?: number | null; available_items?: number | null } | null;
             tcgplayer?: { market?: number | null } | null } | null;
  episode?: { name?: string; slug?: string; code?: string; series?: { name?: string } | null } | null;
}

async function loadCatalog(): Promise<ApiProduct[]> {
  if (fs.existsSync(CACHE) && Date.now() - fs.statSync(CACHE).mtimeMs < 6 * 3600_000) {
    return JSON.parse(fs.readFileSync(CACHE, "utf-8"));
  }
  if (!KEY) throw new Error("Cache saknas och CARDMARKET_RAPIDAPI_KEY ej satt");
  const out: ApiProduct[] = [];
  let page = 1, total = 1;
  do {
    const r = await fetch(`https://${HOST}/pokemon/products?page=${page}`, {
      headers: { "x-rapidapi-host": HOST, "x-rapidapi-key": KEY },
    });
    if (!r.ok) { console.error(`sida ${page}: HTTP ${r.status}`); break; }
    const d = (await r.json()) as { data: ApiProduct[]; paging: { total: number } };
    total = d.paging.total;
    out.push(...d.data);
    if (page % 20 === 0) console.error(`  … sida ${page}/${total}`);
    await sleep(220);
  } while (page++ < total);
  fs.mkdirSync(path.dirname(CACHE), { recursive: true });
  fs.writeFileSync(CACHE, JSON.stringify(out));
  return out;
}

/** Japanskt set? TCGGO blandar EN och JP i samma endpoint. */
function isJapanese(p: ApiProduct): boolean {
  const hay = `${p.name} ${p.episode?.name ?? ""} ${p.episode?.slug ?? ""}`.toLowerCase();
  return /\b(japan|japanese|japansk|\(jp\)|jp\b)/.test(hay);
}

async function main() {
  const all = await loadCatalog();
  console.log(`TCGGO sealed totalt: ${all.length}`);

  const en = all.filter((p) => !isJapanese(p));
  console.log(`  varav ej uppenbart japanska: ${en.length}`);

  const euPrice = (p: ApiProduct) => p.prices?.cardmarket?.lowest ?? p.prices?.cardmarket?.lowest_EU_only ?? null;
  const withEu = en.filter((p) => euPrice(p) != null);
  const usOnly = en.filter((p) => euPrice(p) == null && (p.prices?.tcgplayer?.market ?? p.tcgplayer_id) != null);
  const neither = en.filter((p) => euPrice(p) == null && (p.prices?.tcgplayer?.market ?? p.tcgplayer_id) == null);
  console.log(`  med EU-pris (ÄGARENS KRITERIUM): ${withEu.length}`);
  console.log(`  utan EU-pris men med US/TCGplayer (SKA EJ IN): ${usOnly.length}`);
  console.log(`  utan bådadera: ${neither.length}`);
  console.log(`  med cardmarket_id: ${withEu.filter((p) => p.cardmarket_id != null).length} av ${withEu.length}`);

  // Vad har vi redan? Matcha på cardmarket_id (offer-URL) och på normaliserad titel.
  const ours = await prisma.product.findMany({
    where: { category: { notIn: ["SINGLE_CARD", "GRADED_CARD"] } },
    select: { id: true, title: true, normalizedTitle: true },
  });
  const ourTitles = new Set(ours.map((p) => p.normalizedTitle));
  const cmOffers = await prisma.offer.findMany({
    where: { retailer: { name: "Cardmarket" } },
    select: { url: true },
  });
  const ourCmIds = new Set<number>();
  for (const o of cmOffers) {
    const m = o.url.match(/\/Products\/Singles\/[^/]+\/(\d+)|idProduct=(\d+)|\/(\d+)(?:\?|$)/);
    const id = m ? Number(m[1] ?? m[2] ?? m[3]) : NaN;
    if (Number.isFinite(id)) ourCmIds.add(id);
  }

  const missing = withEu.filter(
    (p) => !ourTitles.has(normalizeTitle(p.name)) && !(p.cardmarket_id && ourCmIds.has(p.cardmarket_id))
  );
  console.log(`\nSAKNAS hos oss (EU-pris, ej titel/CM-id-träff): ${missing.length}`);

  const bySeries = new Map<string, number>();
  for (const p of missing) {
    const k = p.episode?.series?.name ?? p.episode?.name ?? "(okänd)";
    bySeries.set(k, (bySeries.get(k) ?? 0) + 1);
  }
  console.log(`\nPer serie (topp 15):`);
  for (const [k, v] of [...bySeries].sort((a, b) => b[1] - a[1]).slice(0, 15)) {
    console.log(`  ${String(v).padStart(4)}  ${k}`);
  }
  console.log(`\nEXEMPEL (30 st):`);
  for (const p of missing.slice(0, 30)) {
    console.log(`  ${String(euPrice(p)).padStart(8)} €  cm_id=${String(p.cardmarket_id ?? "–").padStart(7)}  ${p.name.slice(0, 58)}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
