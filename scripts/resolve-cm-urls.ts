/**
 * Löser Cardmarket-redirect-URL:er till direkta produktlänkar med ?language=1.
 *
 * Steg:
 *  1. Hämtar alla CM-offers som pekar på prices.pokemontcg.io/cardmarket/{id}
 *     eller /Products/Search (och där kortet har tcgExternalId).
 *  2. Gör HEAD-request med redirect:'manual' → Location-header = direkt CM-URL.
 *  3. Strippar UTM-parametrar, lägger till ?language=1 (engelska annonser).
 *  4. Uppdaterar offer.url i databasen.
 *
 * Cache: sparar redan lösta URL:er i .cache/cm-resolved-urls.json så att
 * scriptet kan återupptas vid avbrott.
 *
 * Körs med: npx tsx scripts/resolve-cm-urls.ts (resumerbar — kör om tills
 *           "❌ misslyckade" ≈ 0; cachen sparas löpande).
 * Env:      CM_CONCURRENCY=12         (workers i streaming-poolen, default 12)
 *           CM_DELAY_MS=50            (jitter per worker-iteration, default 50)
 *           CM_MAX_RETRIES=3          (backoff vid 429/5xx/timeout, default 3)
 *           CM_REQUEST_TIMEOUT_MS=8000 (avbryt tarpittade requests, default 8s)
 */
import { PrismaClient } from "@prisma/client";
import * as fs from "fs";
import * as path from "path";

const prisma = new PrismaClient();

const CONCURRENCY = Number(process.env.CM_CONCURRENCY ?? 12);
const DELAY_MS = Number(process.env.CM_DELAY_MS ?? 50);
const MAX_RETRIES = Number(process.env.CM_MAX_RETRIES ?? 3);
// prices.pokemontcg.io tarpittar ibland (0,2–10 s). Avbryt långsamma requests
// och försök igen istället för att låta dem blockera en worker i 30 s+.
const REQUEST_TIMEOUT_MS = Number(process.env.CM_REQUEST_TIMEOUT_MS ?? 8000);
const CACHE_DIR = path.join(process.cwd(), ".cache");
const CACHE_FILE = path.join(CACHE_DIR, "cm-resolved-urls.json");
const BATCH_SIZE = 500;

type CacheMap = Record<string, string>; // tcgExternalId → resolved URL

function loadCache(): CacheMap {
  try {
    if (fs.existsSync(CACHE_FILE)) {
      return JSON.parse(fs.readFileSync(CACHE_FILE, "utf-8"));
    }
  } catch {
    // corrupt cache — start fresh
  }
  return {};
}

function saveCache(cache: CacheMap): void {
  if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
}

/** Strips UTM params and appends ?language=1 for English filter. */
function buildFinalUrl(locationHeader: string): string {
  // Normalize: some redirects omit www.
  let url = locationHeader.replace(
    "https://cardmarket.com/",
    "https://www.cardmarket.com/"
  );

  // Strip UTM and other tracking params
  const parsed = new URL(url);
  for (const key of [...parsed.searchParams.keys()]) {
    if (
      key.startsWith("utm_") ||
      key === "source" ||
      key === "medium" ||
      key === "campaign"
    ) {
      parsed.searchParams.delete(key);
    }
  }

  // Add language=1 (English)
  parsed.searchParams.set("language", "1");

  return parsed.toString();
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Resolve a single prices.pokemontcg.io redirect. Retries on rate-limit (429)
 * and transient errors with exponential backoff (honoring Retry-After). Returns
 * null only after exhausting retries — so a throttled card is retried, not
 * silently dropped to a non-English fallback link.
 */
async function resolveRedirect(
  tcgExternalId: string
): Promise<string | null> {
  const redirectUrl = `https://prices.pokemontcg.io/cardmarket/${tcgExternalId}`;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(redirectUrl, {
        method: "GET",
        redirect: "manual",
        headers: {
          "User-Agent": "PokeFinds/1.0 (prisbevakning, https://pokefinds.se)",
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      // Rate-limited / transient server error → back off and retry.
      if (res.status === 429 || res.status >= 500) {
        if (attempt === MAX_RETRIES) return null;
        const retryAfter = Number(res.headers.get("retry-after"));
        const backoff = Number.isFinite(retryAfter) && retryAfter > 0
          ? retryAfter * 1000
          : 1000 * 2 ** attempt; // 1s → 2s → 4s
        await sleep(backoff);
        continue;
      }

      const location = res.headers.get("location");
      if (!location) return null; // genuint omappbart (ingen CM-produkt)
      return buildFinalUrl(location);
    } catch {
      if (attempt === MAX_RETRIES) return null;
      await sleep(1000 * 2 ** attempt);
    }
  }
  return null;
}

/**
 * Resolve a list of tcgExternalIds with a STREAMING worker pool: CONCURRENCY
 * workers pull from a shared cursor and start the next request the instant they
 * finish — så en långsam tarpittad request (9 s) blockerar inte de andra (en
 * batch-barriär gjorde att hela batchen väntade på den långsammaste).
 */
async function processBatch(
  items: { tcgExternalId: string }[],
  cache: CacheMap
): Promise<void> {
  let cursor = 0;
  async function worker(): Promise<void> {
    while (cursor < items.length) {
      const item = items[cursor++];
      if (cache[item.tcgExternalId]) continue; // already resolved
      const url = await resolveRedirect(item.tcgExternalId);
      if (url) cache[item.tcgExternalId] = url;
      if (DELAY_MS > 0) await new Promise((r) => setTimeout(r, DELAY_MS));
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, items.length) }, () => worker())
  );
}

async function main() {
  const cache = loadCache();
  console.log(`📦 Cache: ${Object.keys(cache).length} redan lösta URL:er`);

  const cm = await prisma.retailer.findFirstOrThrow({
    where: { name: "Cardmarket" },
  });

  // Step 1: Get all offers that need resolving
  // a) Redirect URLs (prices.pokemontcg.io/cardmarket/...)
  // b) Search URLs where the card has tcgExternalId
  console.log("🔍 Hämtar offers som behöver lösas...");

  let resolved = 0;
  let failed = 0;
  let skipped = 0;
  let cursor: string | undefined;

  while (true) {
    const offers = await prisma.offer.findMany({
      take: BATCH_SIZE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: "asc" },
      where: {
        retailerId: cm.id,
        OR: [
          { url: { contains: "prices.pokemontcg.io/cardmarket" } },
          { url: { contains: "/Products/Search" } },
        ],
      },
      select: {
        id: true,
        url: true,
        product: {
          select: {
            card: { select: { tcgExternalId: true } },
          },
        },
      },
    });

    if (offers.length === 0) break;
    cursor = offers[offers.length - 1].id;

    // Extract tcgExternalIds that need resolving
    const toResolve: { tcgExternalId: string }[] = [];
    for (const o of offers) {
      const extId = o.product.card?.tcgExternalId;
      if (!extId) continue;
      if (!cache[extId]) toResolve.push({ tcgExternalId: extId });
    }

    // Resolve redirects
    if (toResolve.length > 0) {
      await processBatch(toResolve, cache);
      saveCache(cache);
    }

    // Update offers in DB
    for (const o of offers) {
      const extId = o.product.card?.tcgExternalId;
      if (!extId) {
        skipped++;
        continue;
      }
      const newUrl = cache[extId];
      if (!newUrl) {
        failed++;
        continue;
      }
      if (o.url === newUrl) {
        skipped++;
        continue;
      }
      await prisma.offer.update({
        where: { id: o.id },
        data: { url: newUrl },
      });
      resolved++;
    }

    const total = resolved + failed + skipped;
    if (total % 500 === 0 || offers.length < BATCH_SIZE) {
      console.log(
        `  ✅ ${resolved} lösta | ❌ ${failed} misslyckade | ⏭️ ${skipped} överhoppade | 📦 ${Object.keys(cache).length} cachade`
      );
    }
  }

  // Save final cache
  saveCache(cache);

  console.log("\n🎉 Klart!");
  console.log(`   Lösta (uppdaterade i DB): ${resolved}`);
  console.log(`   Misslyckade (kvar som förut): ${failed}`);
  console.log(`   Överhoppade (redan korrekta / saknar ID): ${skipped}`);
  console.log(`   Cache total: ${Object.keys(cache).length}`);
}

main()
  .catch((e) => {
    console.error("Misslyckades:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
