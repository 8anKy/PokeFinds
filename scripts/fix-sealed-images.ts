/**
 * Re-pekar sealed-produkters bild till CardMarket-katalogens per-produkt-bild
 * (images.tcggo.com) via cardmarket_id (idProduct i CM-offer-URL). Fixar:
 *   - pokemontcg.io kort-art felaktigt satt på sealed (single-card-bild på en box)
 *   - Amazon/tcgplayer set-bilder delade över flera former (box-bild på pack/ETB/blister)
 *   - saknade bilder
 * tcggo-bilden kommer från samma CM-katalog vi prissätter sealed från → bilden
 * matchar alltid priset + produktlänken. Idempotent (skriver bara när bilden ändras).
 *
 * Dry run:  npx tsx scripts/fix-sealed-images.ts
 * Skriv:    APPLY=1 npx tsx scripts/fix-sealed-images.ts
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

import { PrismaClient, type ProductCategory } from "@prisma/client";

const prisma = new PrismaClient();
const APPLY = process.env.APPLY === "1";
const SEALED = ["BOOSTER_BOX", "BOOSTER_PACK", "ETB", "COLLECTION_BOX", "TIN", "BLISTER", "BUNDLE"] as ProductCategory[];
const CACHE = path.join(process.cwd(), ".cache", "rapidapi-sealed.json");
const HOST = process.env.CARDMARKET_RAPIDAPI_HOST ?? "cardmarket-api-tcg.p.rapidapi.com";
const KEY = process.env.CARDMARKET_RAPIDAPI_KEY ?? "";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface ApiProduct { cardmarket_id: number | null; image?: string }

async function loadCatalog(): Promise<ApiProduct[]> {
  if (fs.existsSync(CACHE)) return JSON.parse(fs.readFileSync(CACHE, "utf-8"));
  if (!KEY) throw new Error("Cache saknas och CARDMARKET_RAPIDAPI_KEY ej satt");
  const out: ApiProduct[] = [];
  let page = 1, total = 1;
  do {
    const r = await fetch(`https://${HOST}/pokemon/products?page=${page}`, { headers: { "x-rapidapi-host": HOST, "x-rapidapi-key": KEY } });
    if (!r.ok) break;
    const d = (await r.json()) as { data: ApiProduct[]; paging: { total: number } };
    total = d.paging.total; out.push(...d.data); await sleep(220);
  } while (page++ < total);
  fs.mkdirSync(path.dirname(CACHE), { recursive: true });
  fs.writeFileSync(CACHE, JSON.stringify(out));
  return out;
}

const domain = (u: string | null) => { if (!u) return "(ingen)"; try { return new URL(u).host; } catch { return "(ogiltig)"; } };

async function main() {
  const catalog = await loadCatalog();
  const imgById = new Map<number, string>();
  for (const p of catalog) if (p.cardmarket_id != null && p.image) imgById.set(p.cardmarket_id, p.image);
  console.log(`CM-katalog: ${imgById.size} produkter med (cardmarket_id + bild)\n`);

  const prods = await prisma.product.findMany({
    where: { category: { in: SEALED } },
    select: { id: true, title: true, imageUrl: true, category: true, offers: { select: { url: true } } },
  });

  const byOldDomain: Record<string, number> = {};
  const byCat: Record<string, number> = {};
  let noMapping = 0, alreadyOk = 0;
  const updates: { id: string; title: string; oldImg: string | null; image: string }[] = [];

  for (const p of prods) {
    const cmId = p.offers.map((o) => o.url.match(/idProduct=(\d+)/)?.[1]).find(Boolean);
    const target = cmId ? imgById.get(parseInt(cmId, 10)) : undefined;
    if (!target) { noMapping++; continue; }
    if (target === p.imageUrl) { alreadyOk++; continue; }
    byOldDomain[domain(p.imageUrl)] = (byOldDomain[domain(p.imageUrl)] ?? 0) + 1;
    byCat[p.category] = (byCat[p.category] ?? 0) + 1;
    updates.push({ id: p.id, title: p.title, oldImg: p.imageUrl, image: target });
  }

  console.log(`Ändras: ${updates.length} · redan rätt (tcggo): ${alreadyOk} · ingen CM-mappning: ${noMapping}\n`);
  console.log("Ändras per gammal bild-domän:");
  for (const [d, n] of Object.entries(byOldDomain).sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(4)}  ${d}`);
  console.log("\nÄndras per kategori:");
  for (const [c, n] of Object.entries(byCat).sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(4)}  ${c}`);

  if (APPLY) {
    let done = 0;
    for (const u of updates) {
      await prisma.product.update({ where: { id: u.id }, data: { imageUrl: u.image } });
      if (++done % 100 === 0) console.log(`  ...${done}/${updates.length}`);
    }
    console.log(`\n✅ Uppdaterade ${updates.length} sealed-bilder.`);
  } else {
    // Sample: visa form-känsliga ändringar (pack/ETB) så vi ser att rätt form-bild väljs.
    const picky = updates.filter((u) => /pack|elite|trainer/i.test(u.title)).slice(0, 8);
    const rest = updates.filter((u) => !/pack|elite|trainer/i.test(u.title)).slice(0, 6);
    console.log("\nStickprov (titel → ny tcggo-bil):");
    for (const u of [...picky, ...rest]) {
      console.log(`  ${u.title}`);
      console.log(`      gammal: ${u.oldImg}`);
      console.log(`      ny:     ${u.image}`);
    }
    console.log("\n(dry run — kör APPLY=1 för att skriva)");
  }
}
main().finally(() => prisma.$disconnect());
