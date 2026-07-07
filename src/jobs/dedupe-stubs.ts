/**
 * Stub-dedup: auto-importen (ensureListingProduct) skapar en NY katalogprodukt när
 * matchProduct < 0.85 — olika butikers namn på SAMMA SKU ("Pokemon SV10.5 - Black Bolt
 * ETB" vs "Pokémon, Scarlet & Violet 10.5: ... Black Bolt Elite Trainer Box") hamnar
 * då som dubblettprodukter. Mekaniska trösklar kan inte klustra fritext-varianterna,
 * så en billig LLM-dom (Haiku, bara två titlar per anrop ≈ $0.001) avgör "samma
 * produkt?" för stubbens topp-kandidater; bekräftad dubblett merge:as in i den
 * etablerade produkten (offers flyttas, stubben raderas).
 *
 * Körs VECKOVIS (store-health.yml) över stubbar ≤ STUB_WINDOW_DAYS gamla — äldre har
 * redan dömts (ingen verdict-cache behövs när fönstret är kort och anropen är öre).
 * Kräver ANTHROPIC_API_KEY (annars no-op). Kandidater filtreras hårt innan LLM:
 * samma/kompatibel kategori, likhet ≥ MIN_SIM och matcherns hårda vakter
 * (serie-/sifferset-/språk-mismatch = aldrig samma produkt).
 */
import { prisma } from "@/lib/db";
import { judgeSameProduct } from "@/lib/same-product";
import {
  cleanListingTitle,
  languageMismatch,
  scoreSimilarity,
  seriesMismatch,
  setMarkerMismatch,
} from "@/scrapers/matching";

const STUB_WINDOW_DAYS = Number(process.env.DEDUPE_WINDOW_DAYS ?? "14");
const MIN_SIM = 0.4;
const MAX_CANDIDATES = 3;

// Kategorier som ofta förväxlas av butiksfeeds (checklane = pack/blister).
const COMPATIBLE = new Set(["BOOSTER_PACK|BLISTER", "BLISTER|BOOSTER_PACK"]);

/** Flytta stubbens data till den kanoniska produkten och radera stubben. */
export async function mergeStubInto(
  stubId: string,
  canonicalId: string,
  log: (msg: string) => void = console.log
): Promise<void> {
  const stub = await prisma.product.findUnique({
    where: { id: stubId },
    select: {
      title: true,
      imageUrl: true,
      offers: { select: { id: true, url: true, retailerId: true, condition: true, language: true } },
      watchlistItems: { select: { id: true, userId: true } },
      collectionItems: { select: { id: true } },
    },
  });
  if (!stub) return;
  for (const o of stub.offers) {
    const conflict = await prisma.offer.findFirst({
      where: { productId: canonicalId, retailerId: o.retailerId, condition: o.condition, language: o.language },
      select: { id: true },
    });
    if (conflict) await prisma.offer.delete({ where: { id: o.id } });
    else await prisma.offer.update({ where: { id: o.id }, data: { productId: canonicalId } });
  }
  for (const w of stub.watchlistItems) {
    const dup = await prisma.watchlistItem.findFirst({
      where: { userId: w.userId, productId: canonicalId },
      select: { id: true },
    });
    if (dup) await prisma.watchlistItem.delete({ where: { id: w.id } });
    else await prisma.watchlistItem.update({ where: { id: w.id }, data: { productId: canonicalId } });
  }
  if (stub.collectionItems.length > 0) {
    await prisma.collectionItem.updateMany({
      where: { productId: stubId },
      data: { productId: canonicalId },
    });
  }
  const canonical = await prisma.product.findUnique({ where: { id: canonicalId }, select: { imageUrl: true } });
  if (stub.imageUrl && canonical && !canonical.imageUrl) {
    await prisma.product.update({ where: { id: canonicalId }, data: { imageUrl: stub.imageUrl } });
  }
  await prisma.traderaMatch.deleteMany({ where: { productId: stubId } });
  await prisma.product.delete({ where: { id: stubId } });
  log(`   🔀 mergade "${stub.title}" → ${canonicalId}`);
}

export interface DedupeResult {
  stubs: number;
  llmCalls: number;
  merged: number;
}

export async function dedupeStubs(log: (msg: string) => void = console.log): Promise<DedupeResult> {
  const res: DedupeResult = { stubs: 0, llmCalls: 0, merged: 0 };
  if (!process.env.ANTHROPIC_API_KEY) {
    log("[dedupe-stubs] ANTHROPIC_API_KEY saknas — hoppar över.");
    return res;
  }
  const windowStart = new Date(Date.now() - STUB_WINDOW_DAYS * 24 * 3600 * 1000);

  const stubs = await prisma.product.findMany({
    where: {
      setId: null,
      cardId: null,
      category: { notIn: ["SINGLE_CARD", "GRADED_CARD", "ACCESSORY"] },
      createdAt: { gte: windowStart },
    },
    orderBy: { createdAt: "asc" },
    select: { id: true, title: true, category: true, createdAt: true },
  });
  res.stubs = stubs.length;
  const catalog = await prisma.product.findMany({
    where: { category: { notIn: ["SINGLE_CARD", "GRADED_CARD", "ACCESSORY"] } },
    select: { id: true, title: true, category: true, setId: true, createdAt: true },
  });
  log(`[dedupe-stubs] ${stubs.length} stubbar (≤${STUB_WINDOW_DAYS} dgr), ${catalog.length} sealed-produkter i katalogen.`);

  const mergedIds = new Set<string>();
  for (const stub of stubs) {
    if (mergedIds.has(stub.id)) continue;
    const stubTitle = cleanListingTitle(stub.title);
    const candidates = catalog
      .filter(
        (c) =>
          c.id !== stub.id &&
          !mergedIds.has(c.id) &&
          (c.category === stub.category || COMPATIBLE.has(`${stub.category}|${c.category}`)) &&
          // Merge bara in i en mer etablerad produkt (set-märkt eller äldre) —
          // annars kan två färska stubbar sluka varandra åt fel håll.
          (c.setId != null || c.createdAt < stub.createdAt) &&
          !seriesMismatch(stubTitle, c.title) &&
          !setMarkerMismatch(stubTitle, c.title) &&
          !languageMismatch(stubTitle, c.title) &&
          // Tin-display (låda med flera tins) ≠ enskild tin — hård mekanisk spärr;
          // LLM:en luras annars av "Display = Booster Box"-ekvivalensen.
          !(
            (stub.category === "TIN" || c.category === "TIN") &&
            /\bdisplay\b/i.test(stubTitle) !== /\bdisplay\b/i.test(c.title)
          )
      )
      .map((c) => ({ c, sim: scoreSimilarity(stubTitle, c.title) }))
      .filter((x) => x.sim >= MIN_SIM)
      .sort((a, b) => b.sim - a.sim)
      .slice(0, MAX_CANDIDATES);

    for (const { c } of candidates) {
      res.llmCalls++;
      const v = await judgeSameProduct(stubTitle, c.title);
      if (v?.same) {
        await mergeStubInto(stub.id, c.id, log);
        mergedIds.add(stub.id);
        res.merged++;
        break;
      }
    }
  }

  log(`[dedupe-stubs] klart: ${res.merged} mergade av ${res.stubs} stubbar (${res.llmCalls} LLM-anrop).`);
  return res;
}
