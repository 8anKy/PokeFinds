/**
 * TCGGO:s JAPANSKA sealed-katalog mot vår — rapport, inga skrivningar.
 *
 *   node scripts/with-prod-db.mjs npx tsx scripts/audit-tcggo-jp-gap.ts
 *
 * ⛔ JP-sealed har en EGEN endpoint: `/pokemon-jp/products` (13 sidor). Den västerländska
 *    `/pokemon/products` är engelsk-only och `?language=japanese` ignoreras TYST
 *    (dokumenterat i jp-sets.md) — så den kan aldrig ge japanska produkter.
 *
 * Samma ägarregel som engelska passet: bara produkter med ett EU-pris (riktig
 * Cardmarket-koppling) eller ett fungerande cardmarket_id.
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
import { classifyForm, identicalIdentity, productsConflict } from "../src/scrapers/matching";
import { normalizeTitle } from "../src/lib/utils";

const prisma = new PrismaClient();
const HOST = process.env.CARDMARKET_RAPIDAPI_HOST ?? "cardmarket-api-tcg.p.rapidapi.com";
const KEY = process.env.CARDMARKET_RAPIDAPI_KEY ?? "";
const CACHE = path.join(process.cwd(), ".cache", "rapidapi-sealed-jp.json");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface JpProduct {
  id: number; name: string; cardmarket_id: number | null; image?: string;
  prices?: { cardmarket?: { lowest?: number | null; lowest_EU_only?: number | null; "30d_average"?: number | null } | null } | null;
  episode?: { name?: string; code?: string } | null;
}

export async function loadJpCatalog(): Promise<JpProduct[]> {
  if (fs.existsSync(CACHE) && Date.now() - fs.statSync(CACHE).mtimeMs < 6 * 3600_000)
    return JSON.parse(fs.readFileSync(CACHE, "utf-8"));
  if (!KEY) throw new Error("CARDMARKET_RAPIDAPI_KEY saknas");
  const out: JpProduct[] = [];
  let page = 1, total = 1;
  do {
    const r = await fetch(`https://${HOST}/pokemon-jp/products?page=${page}`, {
      headers: { "x-rapidapi-host": HOST, "x-rapidapi-key": KEY },
    });
    if (!r.ok) { console.error(`sida ${page}: HTTP ${r.status}`); break; }
    const d = (await r.json()) as { data: JpProduct[]; paging: { total: number } };
    total = d.paging.total;
    out.push(...d.data);
    await sleep(220);
  } while (page++ < total);
  fs.mkdirSync(path.dirname(CACHE), { recursive: true });
  fs.writeFileSync(CACHE, JSON.stringify(out));
  return out;
}

const WHOLESALE_RE = /\bcase\b|\bfun pack\b|(?:box|blister|bundle|collection|deck)\s+display\b|\bdisplay\s+case\b/i;

async function main() {
  const api = await loadJpCatalog();
  const eu = (p: JpProduct) => p.prices?.cardmarket?.lowest ?? p.prices?.cardmarket?.lowest_EU_only ?? null;
  console.log(`TCGGO JP-sealed: ${api.length}`);
  console.log(`  med EU-pris:        ${api.filter((p) => eu(p) != null).length}`);
  console.log(`  med cardmarket_id:  ${api.filter((p) => p.cardmarket_id != null).length}`);
  console.log(`  grossist (hoppas):  ${api.filter((p) => WHOLESALE_RE.test(p.name)).length}`);

  const ours = await prisma.product.findMany({
    where: { category: { notIn: ["SINGLE_CARD", "GRADED_CARD"] } },
    select: { normalizedTitle: true, language: true, title: true },
  });
  const jpOurs = ours.filter((p) => p.language === "JP");
  console.log(`\nVåra JP-sealed: ${jpOurs.length}`);

  let missing = 0, dupe = 0, wholesale = 0, noForm = 0, noData = 0;
  const rows: string[] = [];
  for (const p of api) {
    const form = classifyForm(p.name);
    if (!form) { noForm++; continue; }
    if (WHOLESALE_RE.test(p.name)) { wholesale++; continue; }
    const price = eu(p) ?? p.prices?.cardmarket?.["30d_average"] ?? null;
    if (price == null && p.cardmarket_id == null) { noData++; continue; }
    const n = normalizeTitle(p.name);
    const twin = ours.find(
      (o) => classifyForm(o.normalizedTitle) === form &&
             identicalIdentity(n, o.normalizedTitle) &&
             !productsConflict(p.name, o.normalizedTitle, o.language)
    );
    if (twin) { dupe++; continue; }
    missing++;
    if (rows.length < 40)
      rows.push(`   cm_id=${String(p.cardmarket_id ?? "–").padStart(7)}  ${price == null ? "utan pris" : `${price} €`.padEnd(9)}  ${p.name.slice(0, 52)}`);
  }
  console.log(`\nSAKNAS hos oss: ${missing}`);
  console.log(`  redan hos oss (identitet+form): ${dupe}`);
  console.log(`  grossist: ${wholesale}   ej målform: ${noForm}   varken pris eller id: ${noData}`);
  if (rows.length) console.log(`\nEXEMPEL:\n${rows.join("\n")}`);
}

if (require.main === module) {
  main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
}
