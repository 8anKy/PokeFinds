/**
 * Hämtar engelska NM "From"-priset (lägsta) från CardMarket API TCG (RapidAPI)
 * för ett fåtal kort och jämför mot priset vi redan har lagrat.
 *
 * Fält: prices.cardmarket.lowest_near_mint = lägsta NM-listning, engelska
 * (default-språk; _DE/_FR är språk-överstyrningar). Värdet är i DECIMAL EUR.
 *
 * Kör jämförelse (dry run):   npx tsx scripts/rapidapi-cm-compare.ts
 * Skriv priserna till offers: APPLY=1 npx tsx scripts/rapidapi-cm-compare.ts
 */
import * as fs from "fs";
import * as path from "path";

// Ladda .env manuellt (tsx auto-laddar inte, vi undviker dotenv-beroende)
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

// Ett urval kort i olika prisklasser (lätta att verifiera mot cardmarket.com)
const TARGETS = [
  "sv6pt5-25", // Bloodmoon Ursaluna ex (Shrouded Fable)
  "sv6pt5-85", // Pecharunt ex (Shrouded Fable)
  "zsv10pt5-161", // Genesect ex (Black Bolt)
  "smp-SM48", // Zygarde (SM Black Star Promos)
  "ecard2-H1", // Ampharos (Aquapolis)
  "sv8pt5-168", // Bloodmoon Ursaluna ex SIR (Prismatic Evolutions) — chase
];

interface CmCard {
  tcgid: string;
  name: string;
  cardmarket_id: number | null;
  prices: {
    cardmarket?: {
      lowest_near_mint?: number;
      "30d_average"?: number;
      "7d_average"?: number;
      available_items?: number;
    };
  };
}

async function fetchByTcgId(tcgid: string): Promise<CmCard | null> {
  const url = `https://${HOST}/pokemon/cards?tcgid=${encodeURIComponent(tcgid)}`;
  const res = await fetch(url, {
    headers: { "x-rapidapi-host": HOST, "x-rapidapi-key": KEY },
  });
  if (!res.ok) {
    console.error(`  ! API ${res.status} för ${tcgid}`);
    return null;
  }
  const json = (await res.json()) as { data?: CmCard[] };
  return json.data?.[0] ?? null;
}

const kr = (ore: number | null | undefined) =>
  ore == null ? "—" : `${(ore / 100).toFixed(2)} kr`;

async function main() {
  if (!KEY) throw new Error("CARDMARKET_RAPIDAPI_KEY saknas i miljön (.env)");
  const rates = await getRatesOre();
  console.log(`Växelkurs: 1 EUR = ${(rates.eurToOre / 100).toFixed(3)} kr  (APPLY=${APPLY})\n`);

  const cm = await prisma.retailer.findFirst({ where: { name: "Cardmarket" } });
  if (!cm) throw new Error("Cardmarket-retailer saknas");

  const rows: string[] = [];
  for (const tcgid of TARGETS) {
    const product = await prisma.product.findFirst({
      where: { category: "SINGLE_CARD", card: { tcgExternalId: tcgid } },
      include: {
        card: { select: { name: true, set: { select: { name: true } } } },
        offers: { where: { retailerId: cm.id }, take: 1 },
      },
    });
    if (!product) {
      console.log(`SKIP ${tcgid}: finns inte i vår DB`);
      continue;
    }

    const api = await fetchByTcgId(tcgid);
    const eur = api?.prices.cardmarket?.lowest_near_mint;
    const avg30 = api?.prices.cardmarket?.["30d_average"];
    const avail = api?.prices.cardmarket?.available_items;
    const newOre = eur != null ? Math.round(eur * rates.eurToOre) : null;
    const oldOffer = product.offers[0];
    const oldOre = oldOffer?.price ?? null;

    const name = `${product.card?.name} (${product.card?.set.name})`.slice(0, 44);
    console.log(name);
    console.log(`  vårt CM-pris (nu):     ${kr(oldOre)}`);
    console.log(
      `  RapidAPI EN NM lägsta: ${eur != null ? `€${eur} → ${kr(newOre)}` : "—"}` +
        (avg30 != null ? `  (30d-snitt €${avg30}, ${avail ?? "?"} annonser)` : ""),
    );
    console.log(`  länk: ${oldOffer?.url ?? "—"}\n`);

    rows.push(`${name}\t${kr(oldOre)}\t${eur != null ? "€" + eur : "—"}\t${kr(newOre)}`);

    if (APPLY && newOre != null && oldOffer) {
      await prisma.offer.update({
        where: { id: oldOffer.id },
        data: { price: newOre, lastSeenAt: new Date(), stockStatus: "IN_STOCK" },
      });
    }
  }

  console.log("\n=== Sammanfattning  (kort | vårt nuvarande | API €EN-NM-lägsta | API → kr) ===");
  for (const r of rows) console.log(r);
  if (APPLY) console.log("\n✓ Priserna skrevs till Cardmarket-offers (öppna produktsidorna för att jämföra).");
  else console.log("\n(dry run — kör med APPLY=1 för att skriva priserna till sajten)");
}

main().finally(() => prisma.$disconnect());
