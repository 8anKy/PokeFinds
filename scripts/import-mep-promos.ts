/**
 * Importerar "MEP Black Star Promos" (Mega Evolution-promos) från CardMarket API
 * TCG (tcggo, episode 412). tcggo rapporterar cards_total=0 för detta set i
 * episode-listan (metadata-bugg) → vår vanliga katalog-import hoppade över det,
 * men cards-endpointen ger 93 riktiga kort med cardmarket_id + NM-From-pris + bild.
 * Korten saknar pokemontcg.io-tcgid → identitet = Card.cardmarketId (idProduct).
 *
 * Dry run:  npx tsx scripts/import-mep-promos.ts
 * Skriv:    APPLY=1 npx tsx scripts/import-mep-promos.ts
 * Mot prod: DATABASE_URL="$NEON_DATABASE_URL" APPLY=1 npx tsx scripts/import-mep-promos.ts
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
import { getRatesOre } from "../src/lib/exchange-rate";
import { cardmarketProductUrl } from "../src/lib/marketplace-urls";

const prisma = new PrismaClient();
const HOST = process.env.CARDMARKET_RAPIDAPI_HOST ?? "cardmarket-api-tcg.p.rapidapi.com";
const KEY = process.env.CARDMARKET_RAPIDAPI_KEY ?? "";
const APPLY = process.env.APPLY === "1";
const EPISODE_ID = 412; // MEP Black Star Promos
const SET_EXTERNAL_ID = "mep";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface CmCard {
  name: string;
  card_number: number | null;
  card_code_number: string | null;
  rarity: string | null;
  // "Staff" / "Pokémon Center" / "3D" = engelska varianttryck (samma nummer, eget
  // cardmarket_id + pris) → behåll alla, men särskilj i titel/slug.
  version: string | null;
  supertype: string | { name?: string } | null;
  artist: string | { name?: string } | null;
  cardmarket_id: number | null;
  image: string | null;
  prices?: { cardmarket?: { lowest_near_mint?: number | null; trend?: number | null } | null } | null;
}

const slugify = (s: string) =>
  s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

async function api<T>(url: string): Promise<T | null> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(url, { headers: { "x-rapidapi-host": HOST, "x-rapidapi-key": KEY } });
    if (res.status === 429 || res.status >= 500) { await sleep(1000 * (attempt + 1)); continue; }
    if (!res.ok) { console.error(`  ! ${res.status} ${url}`); return null; }
    return (await res.json()) as T;
  }
  return null;
}

async function main() {
  if (!KEY) throw new Error("CARDMARKET_RAPIDAPI_KEY saknas i .env");
  const dbName = (await prisma.$queryRawUnsafe<{ d: string }[]>("select current_database() as d"))[0].d;
  const { eurToOre } = await getRatesOre();
  console.log(`DB=${dbName} · APPLY=${APPLY} · EUR→öre=${eurToOre}\n`);

  // Episod-metadata (namn/logo/series) + alla kort
  const ep = await api<{ name: string; logo?: string; series?: { name?: string } }>(
    `https://${HOST}/pokemon/episodes/${EPISODE_ID}`
  );
  const cards: CmCard[] = [];
  let page = 1, total = 1;
  do {
    const d = await api<{ data: CmCard[]; paging: { total: number } }>(
      `https://${HOST}/pokemon/episodes/${EPISODE_ID}/cards?page=${page}`
    );
    if (!d) break;
    total = d.paging.total;
    cards.push(...d.data);
    await sleep(220);
  } while (page++ < total);

  const setName = ep?.name ?? "MEP Black Star Promos";
  const series = ep?.series?.name ?? "Mega Evolution";
  console.log(`tcggo "${setName}": ${cards.length} kort\n`);

  const cm = await prisma.retailer.findFirst({ where: { name: "Cardmarket" }, select: { id: true } });
  if (!cm) throw new Error("Cardmarket-retailer saknas");

  // Set (skapa/uppdatera)
  let setId: string;
  const existingSet = await prisma.cardSet.findUnique({ where: { externalId: SET_EXTERNAL_ID } });
  if (existingSet) setId = existingSet.id;
  else if (APPLY) {
    const s = await prisma.cardSet.create({
      data: { name: setName, series, externalId: SET_EXTERNAL_ID, totalCards: cards.length, logoUrl: ep?.logo ?? null },
    });
    setId = s.id;
    console.log(`+ Set skapat: ${setName}`);
  } else { setId = "(dry)"; console.log(`(dry) skulle skapa set: ${setName}`); }

  let created = 0, updated = 0, skipped = 0;
  const sample: string[] = [];

  for (const c of cards) {
    if (!c.cardmarket_id) { skipped++; continue; }
    const num = c.card_number != null ? String(c.card_number).padStart(3, "0") : (c.card_code_number ?? "?");
    const ver = c.version?.trim() || null;
    const dispName = ver ? `${c.name} (${ver})` : c.name;
    const str = (v: string | { name?: string } | null) => (typeof v === "string" ? v : v?.name ?? null);
    const title = `${dispName} · ${setName} ${num}`;
    const eur = c.prices?.cardmarket?.lowest_near_mint ?? null;
    const priceOre = eur != null ? Math.round(eur * eurToOre) : null;
    const url = cardmarketProductUrl(c.cardmarket_id, { nearMint: true });
    if (sample.length < 10) sample.push(`  #${num} ${dispName} → ${priceOre != null ? (priceOre / 100).toFixed(2) + " kr" : "–"}`);

    const exists = await prisma.card.findUnique({ where: { cardmarketId: c.cardmarket_id }, select: { id: true } });
    if (exists) { updated++; if (!APPLY) continue; }
    else { created++; }
    if (!APPLY) continue;

    const card = await prisma.card.upsert({
      where: { cardmarketId: c.cardmarket_id },
      update: { name: c.name, number: num, imageUrl: c.image, rarity: c.rarity ?? "Promo" },
      create: {
        name: c.name, setId, number: num, rarity: c.rarity ?? "Promo", imageUrl: c.image,
        language: "EN", cardmarketId: c.cardmarket_id, supertype: str(c.supertype), artist: str(c.artist),
      },
    });
    let slug = slugify(`${c.name}-${ver ?? ""}-mep-${num}`);
    const slugClash = await prisma.product.findFirst({ where: { slug, NOT: { cardId: card.id } }, select: { id: true } });
    if (slugClash) slug = `${slug}-${c.cardmarket_id}`;
    const product = await prisma.product.upsert({
      where: { slug },
      update: { title, normalizedTitle: normalizeTitle(title), imageUrl: c.image, lowestPriceOre: priceOre },
      create: {
        title, normalizedTitle: normalizeTitle(title), slug, category: "SINGLE_CARD",
        cardId: card.id, setId, imageUrl: c.image, language: "EN", lowestPriceOre: priceOre,
      },
    });
    await prisma.offer.upsert({
      where: { productId_retailerId_condition_language: { productId: product.id, retailerId: cm.id, condition: "NEAR_MINT", language: "EN" } },
      update: { url, price: priceOre, stockStatus: priceOre != null ? "IN_STOCK" : "UNKNOWN", lastSeenAt: new Date() },
      create: {
        productId: product.id, retailerId: cm.id, url, price: priceOre, currency: "SEK",
        stockStatus: priceOre != null ? "IN_STOCK" : "UNKNOWN", condition: "NEAR_MINT", language: "EN",
      },
    });
  }

  console.log("Exempel:\n" + sample.join("\n"));
  console.log(`\n${APPLY ? "Skapade" : "Skulle skapa"}: ${created} · uppdaterar: ${updated} · skippade (ingen cmid): ${skipped}`);
  if (!APPLY) console.log("\n(dry run — kör APPLY=1 för att skriva)");
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
