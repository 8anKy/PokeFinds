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
import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/db";
import {
  cleanListingTitle,
  languageMismatch,
  scoreSimilarity,
  seriesMismatch,
  setMarkerMismatch,
} from "@/scrapers/matching";

const MODEL = process.env.DEDUPE_MODEL ?? "claude-haiku-4-5-20251001";
const STUB_WINDOW_DAYS = Number(process.env.DEDUPE_WINDOW_DAYS ?? "14");
const MIN_SIM = 0.4;
const MAX_CANDIDATES = 3;

// Kategorier som ofta förväxlas av butiksfeeds (checklane = pack/blister).
const COMPATIBLE = new Set(["BOOSTER_PACK|BLISTER", "BLISTER|BOOSTER_PACK"]);

const SYSTEM = [
  "Du avgör om två titlar beskriver SAMMA Pokémon TCG sealed-produkt (samma SKU).",
  "Titel A är en butiksannons, titel B en katalogprodukt. Svara same=false vid en KONKRET motsägelse:",
  "olika set/expansion, olika Pokémon/variant, olika produkttyp (pack ≠ box ≠ ETB ≠ tin ≠ blister ≠ bundle ≠ collection),",
  "olika antal (3-pack ≠ enkelpack, 18 ≠ 36 paket), 'Deluxe'/'Premium'/'Ultra-Premium' ≠ vanlig utgåva,",
  "Pokémon Center-utgåva ≠ vanlig utgåva, japansk ≠ engelsk, olika serienummer (Series 1 ≠ Series 2).",
  "Följande är INTE skillnader: era-/serieprefix (Scarlet & Violet, SV10.5, Mega Evolution m.fl. är setets familj),",
  "'Display' = 'Booster Box' (gäller boosterlådor), ordföljd/stavning/svenska vs engelska beskrivningsord, butiksbrus",
  "(t.ex. 'max 1 per kund', 'förhandsbokning'). OBS: 'Mini Tin Display' är en LÅDA MED FLERA tins",
  "≠ en enskild mini tin — det ÄR en konkret motsägelse. Osäker UTAN konkret motsägelse: same=true.",
  "Anropa alltid report_same.",
].join(" ");

const SAME_TOOL: Anthropic.Tool = {
  name: "report_same",
  description: "Rapportera om titlarna avser samma produkt.",
  input_schema: {
    type: "object",
    properties: {
      same: { type: "boolean", description: "Samma SKU?" },
      reason: { type: "string", description: "Kort motivering på svenska." },
    },
    required: ["same", "reason"],
  },
};

async function sameProduct(
  client: Anthropic,
  listingTitle: string,
  catalogTitle: string
): Promise<{ same: boolean; reason: string }> {
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 256,
    system: SYSTEM,
    tools: [SAME_TOOL],
    tool_choice: { type: "tool", name: "report_same" },
    messages: [
      {
        role: "user",
        content: `A (butiksannons): ${listingTitle}\nB (katalogprodukt): ${catalogTitle}\n\nSamma produkt? Anropa report_same.`,
      },
    ],
  });
  const toolUse = response.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
  const input = (toolUse?.input ?? {}) as Record<string, unknown>;
  return {
    same: input.same === true,
    reason: typeof input.reason === "string" ? input.reason.slice(0, 150) : "",
  };
}

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
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    log("[dedupe-stubs] ANTHROPIC_API_KEY saknas — hoppar över.");
    return res;
  }
  const client = new Anthropic({ apiKey });
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
      const v = await sameProduct(client, stubTitle, c.title);
      if (v.same) {
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
