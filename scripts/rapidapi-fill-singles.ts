/**
 * Fyller offer-priset för ALLA singelkort med Cardmarkets engelska NM-lägsta
 * ("From") från CardMarket API TCG (RapidAPI, Pro). Länken sätts till den
 * engelska, NM-filtrerade CM-produktsidan (language=1 & minCondition=2).
 *
 * Effektivt via set-paginering: /pokemon/episodes/{id}/cards?page=N ger 20 kort
 * per anrop med fulla priser → hela katalogen i ~1000 anrop. Kort matchas mot
 * vår DB via tcgid (= Card.tcgExternalId). Prishistoriken/grafen (trend) rörs
 * INTE — endast Offer.price (det visade "lägsta pris").
 *
 * Dry run:  npx tsx scripts/rapidapi-fill-singles.ts
 * Skriv:    APPLY=1 npx tsx scripts/rapidapi-fill-singles.ts
 * Test:     LIMIT_EPISODES=2 APPLY=1 npx tsx scripts/rapidapi-fill-singles.ts
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
import {
  cardmarketProductUrl,
  isEnglishCardmarketUrl,
  withNearMint,
} from "../src/lib/marketplace-urls";

const prisma = new PrismaClient();
const HOST = process.env.CARDMARKET_RAPIDAPI_HOST ?? "cardmarket-api-tcg.p.rapidapi.com";
const KEY = process.env.CARDMARKET_RAPIDAPI_KEY ?? "";
const APPLY = process.env.APPLY === "1";
const THROTTLE_MS = parseInt(process.env.THROTTLE_MS ?? "220", 10); // <300/min (Pro)
// Användaren vill ha EXAKT Cardmarket "From" (matcha CM 1:1) → ingen outlier-vakt
// som default (0 = av). Sätt OUTLIER_MULT>0 för att återinföra utjämning.
const OUTLIER_MULT = parseFloat(process.env.OUTLIER_MULT ?? "0");
const LIMIT_EPISODES = process.env.LIMIT_EPISODES ? parseInt(process.env.LIMIT_EPISODES, 10) : 0;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Episode { id: number; name: string; cards_total: number }
interface CmCard {
  tcgid: string | null;
  cardmarket_id: number | null;
  prices?: { cardmarket?: { lowest_near_mint?: number | null; "30d_average"?: number | null } | null } | null;
}

let lastRemaining = Infinity;
async function api<T>(url: string): Promise<T | null> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(url, { headers: { "x-rapidapi-host": HOST, "x-rapidapi-key": KEY } });
    const rem = res.headers.get("x-ratelimit-requests-remaining");
    if (rem != null) lastRemaining = parseInt(rem, 10);
    if (res.status === 429 || res.status >= 500) {
      await sleep(1000 * (attempt + 1));
      continue;
    }
    if (!res.ok) { console.error(`  ! ${res.status} ${url}`); return null; }
    return (await res.json()) as T;
  }
  return null;
}

async function allEpisodes(): Promise<Episode[]> {
  const out: Episode[] = [];
  let page = 1, total = 1;
  do {
    const d = await api<{ data: Episode[]; paging: { total: number } }>(
      `https://${HOST}/pokemon/episodes?page=${page}`
    );
    if (!d) break;
    total = d.paging.total;
    out.push(...d.data);
    await sleep(THROTTLE_MS);
  } while (page++ < total);
  return out.filter((e) => e.cards_total > 0);
}

async function main() {
  if (!KEY) throw new Error("CARDMARKET_RAPIDAPI_KEY saknas");
  const rates = await getRatesOre();
  console.log(`1 EUR = ${(rates.eurToOre / 100).toFixed(3)} kr · APPLY=${APPLY} · throttle ${THROTTLE_MS}ms\n`);

  const cm = await prisma.retailer.findFirst({ where: { name: "Cardmarket" } });
  if (!cm) throw new Error("Cardmarket-retailer saknas");

  // tcgExternalId → vår produkt + ev. befintlig CM-offer
  console.log("Laddar singelkatalog från DB …");
  const products = await prisma.product.findMany({
    where: { category: "SINGLE_CARD", card: { tcgExternalId: { not: null } } },
    select: {
      id: true,
      card: { select: { tcgExternalId: true } },
      offers: { where: { retailerId: cm.id }, select: { id: true, url: true, price: true }, take: 1 },
    },
  });
  const map = new Map<string, { productId: string; offerId?: string; url?: string }>();
  for (const p of products) {
    const ext = p.card?.tcgExternalId;
    if (ext) map.set(ext, { productId: p.id, offerId: p.offers[0]?.id, url: p.offers[0]?.url });
  }
  console.log(`  ${map.size} singlar med tcgExternalId\n`);

  let episodes = await allEpisodes();
  const onlyIds = process.env.EPISODE_IDS?.split(",").map((s) => parseInt(s.trim(), 10));
  if (onlyIds?.length) episodes = episodes.filter((e) => onlyIds.includes(e.id));
  if (LIMIT_EPISODES) episodes = episodes.slice(0, LIMIT_EPISODES);
  const totalReq = episodes.reduce((s, e) => s + Math.ceil(e.cards_total / 20), 0);
  console.log(`${episodes.length} set, ~${totalReq} kort-anrop\n`);

  const stat = { matched: 0, updated: 0, created: 0, guarded: 0, usedAvg: 0, noPrice: 0, seen: 0 };
  let reqDone = 0;

  for (const ep of episodes) {
    const pages = Math.ceil(ep.cards_total / 20);
    for (let pg = 1; pg <= pages; pg++) {
      const d = await api<{ data: CmCard[] }>(
        `https://${HOST}/pokemon/episodes/${ep.id}/cards?page=${pg}`
      );
      reqDone++;
      await sleep(THROTTLE_MS);
      if (!d) continue;
      for (const card of d.data) {
        stat.seen++;
        const entry = card.tcgid ? map.get(card.tcgid) : undefined;
        if (!entry) continue;
        stat.matched++;

        const cmp = card.prices?.cardmarket ?? {};
        const eur = cmp.lowest_near_mint ?? null;
        const avg = cmp["30d_average"] ?? null;
        let chosen: number | null;
        if (eur == null) { chosen = avg; if (avg != null) stat.usedAvg++; }
        else if (OUTLIER_MULT > 0 && avg != null && eur > avg * OUTLIER_MULT) { chosen = avg; stat.guarded++; }
        else chosen = eur; // exakt CM "From"
        if (chosen == null) { stat.noPrice++; continue; }
        const priceOre = Math.round(chosen * rates.eurToOre);

        // Länk: behåll löst engelsk slug (+NM) annars idProduct-form (+NM)
        const url =
          entry.url && isEnglishCardmarketUrl(entry.url)
            ? withNearMint(entry.url)
            : card.cardmarket_id != null
              ? cardmarketProductUrl(card.cardmarket_id, { nearMint: true })
              : entry.url ?? null;
        if (!url) { stat.noPrice++; continue; }

        if (APPLY) {
          if (entry.offerId) {
            await prisma.offer.update({
              where: { id: entry.offerId },
              data: { price: priceOre, url, stockStatus: "IN_STOCK", condition: "NEAR_MINT", lastSeenAt: new Date() },
            });
            stat.updated++;
          } else {
            await prisma.offer.upsert({
              where: {
                productId_retailerId_condition_language: {
                  productId: entry.productId, retailerId: cm.id, condition: "NEAR_MINT", language: "EN",
                },
              },
              update: { price: priceOre, url, stockStatus: "IN_STOCK", lastSeenAt: new Date() },
              create: {
                productId: entry.productId, retailerId: cm.id, condition: "NEAR_MINT", language: "EN",
                price: priceOre, currency: "SEK", stockStatus: "IN_STOCK", url,
              },
            });
            stat.created++;
          }
        }
      }
      if (reqDone % 50 === 0)
        console.log(`  …${reqDone}/${totalReq} anrop · matchade ${stat.matched} · kvot kvar ${lastRemaining}`);
    }
  }

  console.log("\n=== KLART ===");
  console.log(`Kort sedda i API:        ${stat.seen}`);
  console.log(`Matchade mot vår DB:     ${stat.matched}`);
  console.log(`  uppdaterade offers:    ${stat.updated}`);
  console.log(`  nya offers:            ${stat.created}`);
  console.log(`  outlier-skyddade (→30d-snitt): ${stat.guarded}`);
  console.log(`  saknade lägsta (→30d-snitt):   ${stat.usedAvg}`);
  console.log(`  utan pris alls (skippade):     ${stat.noPrice}`);
  console.log(`API-anrop:               ${reqDone} · kvot kvar: ${lastRemaining}`);
  if (!APPLY) console.log("\n(dry run — inget skrevs. Kör APPLY=1 för att fylla priserna)");
}

main().finally(() => prisma.$disconnect());
