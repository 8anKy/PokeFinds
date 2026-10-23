/**
 * REVISION AV "I LÅDAN" — rapport, skriver inget.
 *
 * Visar per kategori hur många förseglade produkter som får en innehållslista
 * (kurerad tabell eller familjeregel), vilka KURERADE slugs som inte längre
 * finns i katalogen (sammanslagning/omdöpning ⇒ raden tappas tyst) och de mest
 * visade produkterna i lager som fortfarande saknar lista — dvs nästa att
 * researcha för `src/data/sealed-contents-curated.ts`.
 *
 *   node scripts/with-prod-db.mjs npx tsx scripts/audit-sealed-contents.ts [--top 40]
 *
 * LEVERANTÖRENS INNEHÅLL SOM KANDIDATER (2026-10-23): prisleverantören (TCGGO) har sedan
 * 2026-10-20 `contained_items` (`/pokemon/products?include_contained_items=1`, samma kvot som
 * vanligt). Det är ett TIPS, aldrig en källa: listan visas aldrig för användaren och skrivs
 * aldrig in automatiskt. Rapporten ställer leverantörens rader bredvid våra — saknar produkten
 * lista ⇒ kandidat att verifiera och lägga i den kurerade tabellen MED källa; har den lista ⇒
 * en avvikande boosterräkning flaggas. Regeln står kvar: aldrig ett gissat antal.
 *
 *   --provider              hämtar hela katalogen live (~135 anrop; nyckeln ur env — kör via
 *                           `npx railway run --service PokeFinds -- node scripts/with-prod-db.mjs …`)
 *   --provider-file <json>  läser en tidigare dump i stället (noll anrop)
 *   --save-provider <json>  sparar dumpen från --provider
 */
import { PrismaClient } from "@prisma/client";
import { CURATED_SEALED_CONTENTS } from "../src/data/sealed-contents-curated";
import { buildProductFacts, type ContentsLine } from "../src/lib/product-facts";
import { readFileSync, writeFileSync } from "node:fs";

const prisma = new PrismaClient();
const argv = process.argv.slice(2);
const TOP = Number(argv[argv.indexOf("--top") + 1]) || 40;
const argAfter = (flag: string) => (argv.includes(flag) ? argv[argv.indexOf(flag) + 1] : undefined);

interface ProviderItem { type?: string; name?: string; quantity?: number | null }
interface ProviderRow { cardmarket_id: number | null; name: string; contained_items?: ProviderItem[] | null }

async function loadProviderRows(): Promise<ProviderRow[] | null> {
  const file = argAfter("--provider-file");
  if (file) return JSON.parse(readFileSync(file, "utf8")) as ProviderRow[];
  if (!argv.includes("--provider")) return null;
  const HOST = process.env.CARDMARKET_RAPIDAPI_HOST ?? "cardmarket-api-tcg.p.rapidapi.com";
  const KEY = process.env.CARDMARKET_RAPIDAPI_KEY;
  if (!KEY) throw new Error("CARDMARKET_RAPIDAPI_KEY saknas — kör via `npx railway run`.");
  const rows: ProviderRow[] = [];
  let page = 1, total = 1;
  do {
    const r = await fetch(`https://${HOST}/pokemon/products?page=${page}&include_contained_items=1`, {
      headers: { "x-rapidapi-host": HOST, "x-rapidapi-key": KEY },
    });
    if (!r.ok) throw new Error(`leverantören svarade ${r.status} på sida ${page}`);
    const body = (await r.json()) as { data: ProviderRow[]; paging: { total: number } };
    rows.push(...body.data);
    total = body.paging.total;
    await new Promise((res) => setTimeout(res, 250));
  } while (page++ < total);
  const save = argAfter("--save-provider");
  if (save) writeFileSync(save, JSON.stringify(rows));
  return rows;
}

/** Leverantörens rader som text, t.ex. "9× 30th Celebration Booster". */
const describe = (items: ProviderItem[]) =>
  items.map((i) => `${i.quantity ?? "?"}× ${i.name ?? "?"}${i.type && i.type !== "product" ? ` [${i.type}]` : ""}`).join(", ");

/** Antal boosters enligt leverantören: produktrader vars namn slutar på "Booster". */
const providerBoosters = (items: ProviderItem[]) =>
  items.filter((i) => /\bbooster$/i.test(i.name?.trim() ?? "")).reduce((n, i) => n + (i.quantity ?? 0), 0);
const ourBoosters = (lines: ContentsLine[]) => lines.filter((l) => l.key === "boosters").reduce((n, l) => n + l.qty, 0);

async function main() {
  const rows = await prisma.product.findMany({
    where: { hiddenAt: null, category: { notIn: ["SINGLE_CARD", "GRADED_CARD", "ACCESSORY", "OTHER"] } },
    select: {
      slug: true,
      title: true,
      category: true,
      language: true,
      viewCount: true,
      releaseDate: true,
      set: { select: { name: true, series: true, releaseDate: true, totalCards: true, totalCardsFull: true } },
      offers: { where: { stockStatus: "IN_STOCK" }, select: { id: true }, take: 1 },
    },
  });
  // idProduct per produkt (Cardmarket-länken) — bara för kandidatsektionen.
  const cmOffers = await prisma.offer.findMany({
    where: { retailer: { name: "Cardmarket" }, url: { contains: "idProduct=" }, product: { category: { notIn: ["SINGLE_CARD", "GRADED_CARD", "ACCESSORY"] } } },
    select: { url: true, product: { select: { slug: true } } },
  });
  const cmIdBySlug = new Map<string, number>();
  for (const o of cmOffers) {
    const m = o.url.match(/idProduct=(\d+)/);
    if (m) cmIdBySlug.set(o.product.slug, parseInt(m[1], 10));
  }
  const providerRows = await loadProviderRows();
  const by = new Map<string, { total: number; covered: number; inStock: number; coveredInStock: number }>();
  const missing: typeof rows = [];
  for (const r of rows) {
    const facts = buildProductFacts({ ...r, card: null });
    const covered = !!facts?.contents?.length;
    const b = by.get(r.category) ?? { total: 0, covered: 0, inStock: 0, coveredInStock: 0 };
    b.total++;
    if (covered) b.covered++;
    if (r.offers.length) {
      b.inStock++;
      if (covered) b.coveredInStock++;
      else missing.push(r);
    }
    by.set(r.category, b);
  }
  console.log("Täckning per kategori (synliga produkter):");
  for (const [cat, b] of [...by.entries()].sort()) {
    console.log(`  ${cat.padEnd(15)} ${b.covered}/${b.total} totalt · i lager ${b.coveredInStock}/${b.inStock}`);
  }
  const slugs = new Set(rows.map((r) => r.slug));
  const orphans = Object.keys(CURATED_SEALED_CONTENTS).filter((s) => !slugs.has(s));
  console.log(`\nKurerade poster: ${Object.keys(CURATED_SEALED_CONTENTS).length}, utan produkt: ${orphans.length}`);
  for (const o of orphans) console.log(`  ⚠️ ${o}`);
  missing.sort((a, b) => b.viewCount - a.viewCount);
  console.log(`\nI lager utan lista: ${missing.length}. Mest visade:`);
  for (const m of missing.slice(0, TOP)) console.log(`  ${String(m.viewCount).padStart(5)}  ${m.category.padEnd(15)} ${m.slug}  —  ${m.title}`);

  if (!providerRows) return;
  const itemsByCmId = new Map<number, ProviderItem[]>();
  for (const p of providerRows) {
    if (p.cardmarket_id != null && p.contained_items?.length) itemsByCmId.set(p.cardmarket_id, p.contained_items);
  }
  const candidates: { r: (typeof rows)[number]; items: ProviderItem[] }[] = [];
  const disagreements: { r: (typeof rows)[number]; ours: number; theirs: number; items: ProviderItem[] }[] = [];
  for (const r of rows) {
    const id = cmIdBySlug.get(r.slug);
    const items = id != null ? itemsByCmId.get(id) : undefined;
    if (!items) continue;
    const lines = buildProductFacts({ ...r, card: null })?.contents ?? null;
    if (!lines?.length) candidates.push({ r, items });
    else {
      const theirs = providerBoosters(items);
      const ours = ourBoosters(lines);
      if (theirs > 0 && ours > 0 && theirs !== ours) disagreements.push({ r, ours, theirs, items });
    }
  }
  console.log(
    `\nLeverantörens innehåll (${itemsByCmId.size} rader med contained_items) — KANDIDATER, overifierade.` +
      `\nVerifiera mot en källa (tillverkaren/butikens produktblad) innan raden läggs i sealed-contents-curated.ts:`
  );
  candidates.sort((a, b) => b.r.viewCount - a.r.viewCount);
  for (const c of candidates.slice(0, TOP))
    console.log(`  ${String(c.r.viewCount).padStart(5)}  ${c.r.slug}  —  ${describe(c.items)}`);
  if (candidates.length > TOP) console.log(`  … +${candidates.length - TOP} till (höj --top)`);
  console.log(`\nBoosterantal där vår lista och leverantören är OENSE (${disagreements.length}) — granska vem som har fel:`);
  for (const d of disagreements) console.log(`  ${d.r.slug}  vi ${d.ours} · leverantören ${d.theirs}  (${describe(d.items)})`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
