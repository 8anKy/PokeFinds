/**
 * Matchar våra singelkort mot Cardmarkets officiella produktkatalog och
 * skriver om CM-offer-URL:er till direkta produktsidor med ?language=1.
 *
 * Datakälla: https://downloads.s3.cardmarket.com/productCatalog/productList/products_singles_6.json
 * (officiellt publicerad katalog — ingen scraping).
 *
 * Resultat: offer.url = https://www.cardmarket.com/en/Pokemon/Products?idProduct={id}&language=1
 * som redirectar till den exakta produktsidan MED engelskt filter.
 *
 * Körs med: npx tsx scripts/match-cm-singles.ts
 * Env:      DRY_RUN=1 (enbart matchningsrapport, inga DB-ändringar)
 *           REFRESH=1 (ladda ner färsk katalog)
 */
import { PrismaClient } from "@prisma/client";
import * as fs from "fs";
import * as path from "path";
import { cardmarketProductUrl } from "../src/lib/marketplace-urls";

const prisma = new PrismaClient();
const DRY_RUN = process.env.DRY_RUN === "1";
const REFRESH = process.env.REFRESH === "1";
const CACHE_DIR = path.join(process.cwd(), ".cache", "cardmarket");
const SINGLES_FILE = path.join(CACHE_DIR, "products_singles_6.json");
const NONSINGLES_FILE = path.join(CACHE_DIR, "products_nonsingles_6.json");
const SINGLES_URL =
  "https://downloads.s3.cardmarket.com/productCatalog/productList/products_singles_6.json";
const BATCH = 500;

interface CmSingle {
  idProduct: number;
  name: string;
  idExpansion: number;
  idMetacard: number;
}

/** Normalize string for comparison. */
function norm(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Strip attack info from CM card name: "Charizard ex [Slash | Burn]" → "charizard ex" */
function cleanCmName(name: string): string {
  return norm(
    name
      .replace(/\s*\[.*\]\s*$/, "")
      .replace(/\s*Lv\.?\d+/i, "")
  );
}

/**
 * Manual aliases for sets whose names differ between pokemontcg.io and Cardmarket.
 * Maps our CardSet.name (normalized) → search term to find in nonsingles catalog.
 */
const SET_ALIASES: Record<string, string> = {
  "hs triumphant": "Triumphant",
  "hs undaunted": "Undaunted",
  "hs unleashed": "Unleashed",
  "celebrations classic collection": "Celebrations",
  "scarlet violet energies": "", // No separate expansion
};

async function loadCatalog(): Promise<CmSingle[]> {
  if (REFRESH || !fs.existsSync(SINGLES_FILE)) {
    console.log("📥 Laddar ner CM-singel-katalog...");
    const res = await fetch(SINGLES_URL, {
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) throw new Error(`CM catalog HTTP ${res.status}`);
    const text = await res.text();
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(SINGLES_FILE, text);
    return (JSON.parse(text) as { products: CmSingle[] }).products;
  }
  return (
    JSON.parse(fs.readFileSync(SINGLES_FILE, "utf-8")) as {
      products: CmSingle[];
    }
  ).products;
}

async function main() {
  const catalog = await loadCatalog();
  console.log(`📦 CM-katalog: ${catalog.length} singlar`);

  // Load nonsingles to build set name → expansion ID mapping
  const nonsingles = JSON.parse(
    fs.readFileSync(NONSINGLES_FILE, "utf-8")
  ) as { products: { idExpansion: number; name: string }[] };

  // Build expansion lookup: normalized set name → idExpansion
  // Strategy: for each nonsingles product, check if its name starts with a set name
  const expByNorm = new Map<string, number>();
  for (const p of nonsingles.products) {
    const n = norm(p.name);
    // Already indexed this expansion?
    if ([...expByNorm.values()].includes(p.idExpansion)) continue;
    expByNorm.set(n, p.idExpansion);
  }

  // Get our sets
  const sets = await prisma.cardSet.findMany({
    select: { id: true, name: true, externalId: true },
  });

  // Match our sets to CM expansions
  const setToExp = new Map<string, number>();
  for (const set of sets) {
    const setNorm = norm(set.name);

    // Check manual alias first
    const alias = SET_ALIASES[setNorm];
    if (alias === "") continue; // Explicitly skip (no CM expansion)
    if (alias) {
      const aliasNorm = norm(alias);
      for (const [key, expId] of expByNorm) {
        if (key.startsWith(aliasNorm)) {
          setToExp.set(set.id, expId);
          break;
        }
      }
      if (setToExp.has(set.id)) continue;
    }

    // Strategy 1: nonsingles product name starts with our set name
    for (const [key, expId] of expByNorm) {
      if (key.startsWith(setNorm)) {
        setToExp.set(set.id, expId);
        break;
      }
    }

    // Strategy 2: our set name is contained in product name (min 5 chars to avoid false positives)
    if (!setToExp.has(set.id) && setNorm.length >= 5) {
      for (const [key, expId] of expByNorm) {
        if (key.includes(setNorm)) {
          setToExp.set(set.id, expId);
          break;
        }
      }
    }
  }

  console.log(
    `🗺️  Set-matchning: ${setToExp.size}/${sets.length} set → CM-expansion`
  );

  // Build CM lookup: (idExpansion, cleanName) → CmSingle[]
  const cmByExpName = new Map<string, CmSingle[]>();
  for (const cm of catalog) {
    const key = `${cm.idExpansion}:${cleanCmName(cm.name)}`;
    if (!cmByExpName.has(key)) cmByExpName.set(key, []);
    cmByExpName.get(key)!.push(cm);
  }

  // Sort each group by idProduct (ascending ≈ card number order)
  for (const group of cmByExpName.values()) {
    group.sort((a, b) => a.idProduct - b.idProduct);
  }

  // Pre-compute ordinal positions: for each (setId, normalizedName), sort
  // cards by number and assign ordinals. This lets us disambiguate when CM has
  // multiple products with the same name in the same expansion (e.g., regular
  // art + special illustration rare).
  console.log("🔢 Beräknar ordinaler för kort med samma namn...");
  const cardOrdinals = new Map<string, number>(); // cardId → ordinal (0-based)
  {
    const allCards = await prisma.card.findMany({
      where: { setId: { in: [...setToExp.keys()] } },
      select: { id: true, name: true, number: true, setId: true },
      orderBy: [{ setId: "asc" }, { number: "asc" }],
    });
    // Group by (setId, normalizedName)
    const groups = new Map<string, { id: string; number: string }[]>();
    for (const c of allCards) {
      const gKey = `${c.setId}:${norm(c.name)}`;
      if (!groups.has(gKey)) groups.set(gKey, []);
      groups.get(gKey)!.push({ id: c.id, number: c.number });
    }
    // Sort each group by numeric card number and assign ordinals
    for (const members of groups.values()) {
      members.sort((a, b) => {
        const na = parseInt(a.number, 10);
        const nb = parseInt(b.number, 10);
        if (!isNaN(na) && !isNaN(nb)) return na - nb;
        return a.number.localeCompare(b.number);
      });
      members.forEach((m, i) => cardOrdinals.set(m.id, i));
    }
    console.log(`   ${cardOrdinals.size} kort indexerade`);
  }

  // Now match our cards
  const cm = await prisma.retailer.findFirstOrThrow({
    where: { name: "Cardmarket" },
  });

  let matched = 0;
  let ambiguous = 0;
  let noMatch = 0;
  let noExp = 0;
  let updated = 0;
  let alreadyCorrect = 0;
  let cursor: string | undefined;

  while (true) {
    const offers = await prisma.offer.findMany({
      take: BATCH,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: "asc" },
      where: {
        retailerId: cm.id,
        product: { category: "SINGLE_CARD" },
      },
      select: {
        id: true,
        url: true,
        product: {
          select: {
            id: true,
            card: {
              select: {
                id: true,
                name: true,
                number: true,
                setId: true,
              },
            },
          },
        },
      },
    });
    if (offers.length === 0) break;
    cursor = offers[offers.length - 1].id;

    for (const o of offers) {
      const card = o.product.card;
      if (!card) {
        noMatch++;
        continue;
      }

      const expId = setToExp.get(card.setId);
      if (!expId) {
        noExp++;
        continue;
      }

      const cardNorm = norm(card.name);
      const key = `${expId}:${cardNorm}`;
      const candidates = cmByExpName.get(key);

      if (!candidates || candidates.length === 0) {
        noMatch++;
        continue;
      }

      let cmProduct: CmSingle;
      if (candidates.length === 1) {
        cmProduct = candidates[0];
      } else {
        // Disambiguate by ordinal position: card #79 is ordinal 0 among
        // same-name cards, #281 is ordinal 1 → picks first/second CM product.
        const ordinal = cardOrdinals.get(card.id) ?? 0;
        const idx = Math.min(ordinal, candidates.length - 1);
        cmProduct = candidates[idx];
        ambiguous++;
      }

      matched++;
      const newUrl = cardmarketProductUrl(cmProduct.idProduct);

      if (o.url === newUrl) {
        alreadyCorrect++;
        continue;
      }

      if (!DRY_RUN) {
        await prisma.offer.update({
          where: { id: o.id },
          data: { url: newUrl },
        });
      }
      updated++;
    }

    const total = matched + noMatch + noExp;
    if (total % 2000 === 0 || offers.length < BATCH) {
      console.log(
        `  ✅ ${matched} matchade (${ambiguous} flertydiga) | ❌ ${noMatch} ej funna | 🚫 ${noExp} saknar expansion`
      );
    }
  }

  console.log("\n🎉 Klart!");
  console.log(`   Matchade kort:      ${matched}`);
  console.log(`   Flertydiga (valt):  ${ambiguous}`);
  console.log(`   Ej funna i CM:      ${noMatch}`);
  console.log(`   Saknar expansion:   ${noExp}`);
  console.log(`   Uppdaterade i DB:   ${updated}`);
  console.log(`   Redan korrekta:     ${alreadyCorrect}`);
  if (DRY_RUN) console.log("   ⚠️ DRY_RUN — inga ändringar gjorda");
}

main()
  .catch((e) => {
    console.error("Misslyckades:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
