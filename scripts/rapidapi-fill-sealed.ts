/**
 * Fyller offer-priset för sealed-produkter (booster boxar, paket, ETB, bundles,
 * collection boxar, blister) med Cardmarkets lägsta pris från CardMarket API TCG
 * (RapidAPI). Sealed har inget skick → inget NM-filter; länken är den engelska
 * CM-produktsidan (idProduct&language=1).
 *
 * Hela API:ts sealed-katalog (~1900 produkter) hämtas i ~97 anrop och matchas
 * lokalt mot våra produkter via set (episode) + produktform + namnlikhet.
 *
 * Dry run:  npx tsx scripts/rapidapi-fill-sealed.ts
 * Skriv:    APPLY=1 npx tsx scripts/rapidapi-fill-sealed.ts
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
import { cardmarketProductUrl } from "../src/lib/marketplace-urls";
import { classifyForm, scoreSimilarity } from "../src/scrapers/matching";

const prisma = new PrismaClient();
const HOST = process.env.CARDMARKET_RAPIDAPI_HOST ?? "cardmarket-api-tcg.p.rapidapi.com";
const KEY = process.env.CARDMARKET_RAPIDAPI_KEY ?? "";
const APPLY = process.env.APPLY === "1";
const THROTTLE_MS = parseInt(process.env.THROTTLE_MS ?? "220", 10);
// Exakt CM-match (matcha CM 1:1) → ingen pris-utjämning (0 = av). Matchnings-
// vakterna (booster-namn, poäng, butik-cross-check) behålls för rätt PRODUKT.
const OUTLIER_MULT = parseFloat(process.env.OUTLIER_MULT ?? "0");
const MIN_SCORE = parseFloat(process.env.MIN_SCORE ?? "0.55");
const STORE_MULT = parseFloat(process.env.STORE_MULT ?? "2.5"); // CM > N× butikspris = trolig felmatch
const CACHE_FILE = path.join(process.cwd(), ".cache", "rapidapi-sealed.json");
const CACHE_MAX_AGE_MS = 6 * 60 * 60 * 1000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const norm = (s: string) =>
  s.toLowerCase().replace(/pok[eé]mon|tcg|:/g, "").replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();

// vår produktkategori → förväntad classifyForm-etikett
const EXPECTED_FORM: Record<string, string> = {
  BOOSTER_BOX: "display",
  BOOSTER_PACK: "booster",
  ETB: "etb",
  BUNDLE: "bundle",
  COLLECTION_BOX: "collection",
  BLISTER: "blister",
  TIN: "tin",
};

interface ApiProduct {
  name: string;
  cardmarket_id: number | null;
  prices?: { cardmarket?: { lowest?: number | null; "30d_average"?: number | null } | null } | null;
  episode?: { name?: string } | null;
}

let lastRemaining = Infinity;
async function api<T>(url: string): Promise<T | null> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(url, { headers: { "x-rapidapi-host": HOST, "x-rapidapi-key": KEY } });
    const rem = res.headers.get("x-ratelimit-requests-remaining");
    if (rem != null) lastRemaining = parseInt(rem, 10);
    if (res.status === 429 || res.status >= 500) { await sleep(1000 * (attempt + 1)); continue; }
    if (!res.ok) { console.error(`  ! ${res.status} ${url}`); return null; }
    return (await res.json()) as T;
  }
  return null;
}

async function allApiSealed(): Promise<ApiProduct[]> {
  // Disk-cache → re-körningar (tröskeljustering) kostar ingen kvot
  if (process.env.FORCE_FETCH !== "1" && fs.existsSync(CACHE_FILE)) {
    const age = Date.now() - fs.statSync(CACHE_FILE).mtimeMs;
    if (age < CACHE_MAX_AGE_MS) {
      const cached = JSON.parse(fs.readFileSync(CACHE_FILE, "utf-8")) as ApiProduct[];
      console.log(`  (cache: ${cached.length} sealed, ${Math.round(age / 60000)} min gammal)`);
      return cached;
    }
  }
  const out: ApiProduct[] = [];
  let page = 1, total = 1;
  do {
    const d = await api<{ data: ApiProduct[]; paging: { total: number } }>(
      `https://${HOST}/pokemon/products?page=${page}`
    );
    if (!d) break;
    total = d.paging.total;
    out.push(...d.data);
    if (page % 20 === 0) console.log(`  …läst ${out.length} API-sealed (sida ${page}/${total})`);
    await sleep(THROTTLE_MS);
  } while (page++ < total);
  fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
  fs.writeFileSync(CACHE_FILE, JSON.stringify(out));
  return out;
}

async function main() {
  if (!KEY) throw new Error("CARDMARKET_RAPIDAPI_KEY saknas");
  const rates = await getRatesOre();
  console.log(`1 EUR = ${(rates.eurToOre / 100).toFixed(3)} kr · APPLY=${APPLY}\n`);

  const cm = await prisma.retailer.findFirst({ where: { name: "Cardmarket" } });
  if (!cm) throw new Error("Cardmarket-retailer saknas");

  console.log("Hämtar API:ts sealed-katalog …");
  const apiProducts = await allApiSealed();
  console.log(`  ${apiProducts.length} sealed-produkter i API\n`);

  // indexera API-produkter per normaliserat set-namn
  const byEpisode = new Map<string, ApiProduct[]>();
  for (const p of apiProducts) {
    const ep = norm(p.episode?.name ?? "");
    if (!ep) continue;
    (byEpisode.get(ep) ?? byEpisode.set(ep, []).get(ep)!).push(p);
  }

  const ours = await prisma.product.findMany({
    where: { category: { notIn: ["SINGLE_CARD", "GRADED_CARD", "ACCESSORY"] } },
    include: {
      set: { select: { name: true } },
      offers: { select: { id: true, retailerId: true, price: true, stockStatus: true } },
    },
  });
  console.log(`Våra sealed-produkter: ${ours.length}\n`);

  const stat = { matched: 0, updated: 0, created: 0, guarded: 0, noPrice: 0, noEpisode: 0, noForm: 0, lowScore: 0, storeSkip: 0 };
  const samples: { score: number; line: string }[] = [];

  for (const p of ours) {
    const setKey = norm(p.set?.name ?? "");
    const cands = byEpisode.get(setKey);
    if (!cands || cands.length === 0) { stat.noEpisode++; continue; }
    const expForm = EXPECTED_FORM[p.category] ?? null;
    const ourClean = norm(p.title);

    let best: ApiProduct | null = null;
    let bestScore = 0;
    for (const c of cands) {
      if (expForm && classifyForm(c.name) !== expForm) continue;
      // Booster box: API-namnet MÅSTE innehålla "booster" (annars matchar t.ex.
      // "Tech Sticker Collection Display" för set som saknar riktig boosterbox).
      if (p.category === "BOOSTER_BOX" && !/booster/i.test(c.name)) continue;
      const s = scoreSimilarity(ourClean, norm(c.name));
      if (s > bestScore) { bestScore = s; best = c; }
    }
    if (!best) { stat.noForm++; continue; }
    if (bestScore < MIN_SCORE) { stat.lowScore++; continue; }

    const cmp = best.prices?.cardmarket ?? {};
    const low = cmp.lowest ?? null;
    const avg = cmp["30d_average"] ?? null;
    let chosen: number | null;
    if (low == null) chosen = avg;
    else if (OUTLIER_MULT > 0 && avg != null && low > avg * OUTLIER_MULT) { chosen = avg; stat.guarded++; }
    else chosen = low; // exakt CM lägsta
    if (chosen == null) { stat.noPrice++; continue; }
    if (best.cardmarket_id == null) { stat.noPrice++; continue; }

    const priceOre = Math.round(chosen * rates.eurToOre);

    // Cross-check mot vårt befintliga butikspris (IN_STOCK): CM långt över ett
    // riktigt SE-butikspris = nästan alltid felmatchning → skippa.
    const storePrices = p.offers
      .filter((o) => o.retailerId !== cm.id && o.price != null && o.stockStatus === "IN_STOCK")
      .map((o) => o.price as number);
    const storeMin = storePrices.length ? Math.min(...storePrices) : null;
    if (storeMin != null && priceOre > storeMin * STORE_MULT) {
      stat.storeSkip++;
      samples.push({ score: bestScore, line: `  [SKIP CM ${(priceOre / 100).toFixed(0)}kr > butik ${(storeMin / 100).toFixed(0)}kr] "${p.title}" → "${best.name}"` });
      continue;
    }

    const url = cardmarketProductUrl(best.cardmarket_id); // sealed: language=1, inget NM
    stat.matched++;
    samples.push({ score: bestScore, line: `  [${bestScore.toFixed(2)}] "${p.title}" → "${best.name}"  ${(priceOre / 100).toFixed(0)} kr` });

    if (APPLY) {
      const existing = p.offers.find((o) => o.retailerId === cm.id);
      if (existing) {
        await prisma.offer.update({
          where: { id: existing.id },
          data: { price: priceOre, url, stockStatus: "IN_STOCK", condition: "SEALED", lastSeenAt: new Date() },
        });
        stat.updated++;
      } else {
        await prisma.offer.upsert({
          where: {
            productId_retailerId_condition_language: {
              productId: p.id, retailerId: cm.id, condition: "SEALED", language: "EN",
            },
          },
          update: { price: priceOre, url, stockStatus: "IN_STOCK", lastSeenAt: new Date() },
          create: {
            productId: p.id, retailerId: cm.id, condition: "SEALED", language: "EN",
            price: priceOre, currency: "SEK", stockStatus: "IN_STOCK", url,
          },
        });
        stat.created++;
      }
    }
  }

  console.log("Lägst poängsatta matchningar (mest riskabla — granska):");
  samples.sort((a, b) => a.score - b.score).slice(0, 18).forEach((s) => console.log(s.line));
  console.log("\n=== KLART ===");
  console.log(`Matchade:                ${stat.matched} / ${ours.length}`);
  console.log(`  uppdaterade:           ${stat.updated}`);
  console.log(`  nya:                   ${stat.created}`);
  console.log(`  outlier-skyddade:      ${stat.guarded}`);
  console.log(`Ej matchade — set saknas i API: ${stat.noEpisode} · ingen formträff: ${stat.noForm} · för låg poäng: ${stat.lowScore} · utan pris: ${stat.noPrice} · butik-cross-check skip: ${stat.storeSkip}`);
  console.log(`API-anrop kvot kvar:     ${lastRemaining}`);
  if (!APPLY) console.log("\n(dry run — inget skrevs. Granska matchningarna ovan, kör sen APPLY=1)");
}

main().finally(() => prisma.$disconnect());
