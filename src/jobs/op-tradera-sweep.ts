/**
 * ONE PIECE PÅ TRADERA (2026-11-13) — nattligt svep av Traderas One Piece-kategori (1001268).
 *
 * Till skillnad från Pokémon-svepet (namn-sökning per produkt, roterande) läser det här HELA
 * kategorin varje natt: ~6 900 aktiva annonser = ~140 sökanrop av metodens 10 000/dygn. Det gör
 * svepet till en komplett bild, och en annons som inte syns i en FULLSTÄNDIG körning är borta.
 *
 *  - Singlar: kortkoden i titeln (`lib/one-piece-tradera.ts` — kod, namn, tryckning, annars ingen träff).
 *  - Förseglat: samma matchare som butikerna (`matchProduct` → `matchOnePieceListing`, set + form).
 *  - Prisvakten är Pokémon-svepets (`getListingPriceGuard`): en dyr variant utan märke fälls där.
 *  - Auktioner och graderade kort släpps redan av `parseItemsFromXml`.
 *  - ⛔ En singel sätter pris BARA när FOTOT bevisats vara det engelska kortet (`lib/op-listing-language.ts`):
 *    koden är densamma på japanska och ~1 av 6 annonser var japanska utan märke i titeln.
 *
 * Skriver Tradera-offern (billigaste annonsen), en prisobservation och skena-raderna — samma
 * tabeller som Pokémon, så produktsidan, grafen och "Fler annonser på Tradera" fungerar utan mer kod.
 * ⛔ Pensionering BARA efter en fullständig genomläsning (alla sidor, inga fel) — en avbruten körning
 *    hade annars raderat varje pris den inte hann fram till.
 * Torrkörning som standard: `apply: true` krävs för att skriva.
 */
import { StockStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { mapPool } from "@/lib/concurrency";
import { normalizeTitle } from "@/lib/utils";
import { getListingPriceGuard, loadMatchIndex, matchProduct } from "@/scrapers/matching";
import { MAX_RAIL_LISTINGS, parseItemsFromXml, type TraderaItem } from "@/jobs/tradera-sweep";
import { looksLikeOnePieceSingle, matchOnePieceTraderaSingle, type OpCardRow } from "@/lib/one-piece-tradera";
import { judgeOnePieceListingLanguage } from "@/jobs/op-listing-language";
import { isConfirmedEnglish, traderaPhotoUrl } from "@/lib/op-listing-language";

export const TRADERA_ONE_PIECE_CATEGORY = 1001268;
const SEARCH_API = "https://api.tradera.com/v3/searchservice.asmx";
/** API:t serverar ~200 sidor per fråga; kategorin är ~140. Över taket ⇒ körningen räknas som ofullständig. */
const MAX_PAGES = 200;
const DB_CONCURRENCY = 8;

export interface OpTraderaResult {
  apiCalls: number;
  listings: number;
  complete: boolean;
  matchedSingles: number;
  matchedSealed: number;
  implausible: number;
  products: number;
  written: number;
  railRows: number;
  retired: number;
  reasons: Record<string, number>;
}

async function fetchPage(appId: string, appKey: string, page: number): Promise<string> {
  const body = `<?xml version="1.0"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><SearchAdvanced xmlns="http://api.tradera.com"><request><SearchWords></SearchWords><CategoryId>${TRADERA_ONE_PIECE_CATEGORY}</CategoryId><SearchInDescription>false</SearchInDescription><PageNumber>${page}</PageNumber><OrderBy>PriceAscending</OrderBy><ItemStatus>Active</ItemStatus><ItemType>All</ItemType><ItemsPerPage>50</ItemsPerPage><CountyId>0</CountyId><OnlyAuctionsWithBuyNow>false</OnlyAuctionsWithBuyNow><OnlyItemsWithThumbnail>false</OnlyItemsWithThumbnail></request></SearchAdvanced></soap:Body></soap:Envelope>`;
  const res = await fetch(`${SEARCH_API}?appId=${appId}&appKey=${appKey}`, {
    method: "POST",
    headers: { "Content-Type": "text/xml; charset=utf-8", SOAPAction: `"http://api.tradera.com/SearchAdvanced"` },
    body,
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text().catch(() => "")).slice(0, 160)}`);
  return res.text();
}

/** Katalogens One Piece-singlar per kortkod — delas med sålt-svepet (tradera-sold-sweep.ts). */
export async function loadOnePieceCardRows(): Promise<Map<string, OpCardRow[]>> {
  const cards = await prisma.product.findMany({
    where: { game: "ONE_PIECE", category: "SINGLE_CARD", hiddenAt: null, card: { isNot: null } },
    select: { id: true, title: true, card: { select: { number: true, name: true, imageUrl: true, set: { select: { code: true } } } } },
  });
  const byNumber = new Map<string, OpCardRow[]>();
  for (const p of cards) {
    const row: OpCardRow = {
      productId: p.id, title: p.title, number: p.card!.number, name: p.card!.name, setCode: p.card!.set.code,
      imageUrl: p.card!.imageUrl,
    };
    (byNumber.get(row.number) ?? byNumber.set(row.number, []).get(row.number)!).push(row);
  }
  return byNumber;
}

/**
 * EN One Piece-annons → produkt (singel på kortkoden, annars förseglat via butiksmatcharen).
 * Samma dom för aktiva annonser och sålda affärer — två matchare hade gett två sanningar.
 */
export async function matchOnePieceTraderaListing(
  title: string,
  cardsByNumber: ReadonlyMap<string, readonly OpCardRow[]>,
  matchIndex: Awaited<ReturnType<typeof loadMatchIndex>>,
  categoryOf: (productId: string) => string | null | undefined
): Promise<{ productId: string; kind: "single" | "sealed"; code?: string } | { productId: null; reason: string }> {
  const single = matchOnePieceTraderaSingle(title, cardsByNumber);
  if (!("reason" in single)) return { productId: single.productId, kind: "single", code: single.code };
  // Förseglat: bara annonser UTAN kortkod (en kod = en singel vi valde att inte matcha) och utan
  // korttyp/sällsynthet — "Koza - Extra Booster Memorial Collection - Character" är ett kort för 6 kr,
  // inte en booster (torrkörningen 2026-11-13: sealed-stickprovet var nästan bara sådana).
  if (single.reason === "ingen kortkod" && !looksLikeOnePieceSingle(title)) {
    // Kategorin ÄR One Piece — säg det åt matcharen när säljaren inte gjorde det.
    const raw = /one\s*piece/i.test(title) ? title : `One Piece ${title}`;
    const m = await matchProduct(normalizeTitle(raw), matchIndex, raw);
    const cat = m ? categoryOf(m.productId) : null;
    if (m && cat && cat !== "SINGLE_CARD" && cat !== "GRADED_CARD") return { productId: m.productId, kind: "sealed" };
  }
  return { productId: null, reason: single.reason };
}

export async function runOnePieceTraderaSweep(
  opts: { apply?: boolean; log?: (s: string) => void; sample?: number } = {}
): Promise<OpTraderaResult> {
  const apply = opts.apply ?? false;
  const log = opts.log ?? ((s: string) => console.log(s));
  const res: OpTraderaResult = {
    apiCalls: 0, listings: 0, complete: false, matchedSingles: 0, matchedSealed: 0, implausible: 0,
    products: 0, written: 0, railRows: 0, retired: 0, reasons: {},
  };
  const appId = process.env.TRADERA_APP_ID;
  const appKey = process.env.TRADERA_APP_KEY;
  if (!appId || !appKey) { log("[op-tradera] saknar TRADERA_APP_ID/KEY — hoppar över."); return res; }

  // ── 1. Hela kategorin ───────────────────────────────────────────────────────
  const items = new Map<string, TraderaItem>();
  let totalPages = 1;
  let failed = false;
  for (let page = 1; page <= Math.min(totalPages, MAX_PAGES); page++) {
    let parsed: { items: TraderaItem[]; totalPages: number } | null = null;
    for (const wait of [0, 3000, 10_000]) {
      if (wait) await new Promise((r) => setTimeout(r, wait));
      try {
        const xml = await fetchPage(appId, appKey, page);
        res.apiCalls++;
        parsed = parseItemsFromXml(xml);
        // Rå radräkning: en sida full av bortfiltrerade rader (auktioner, graderat) är inte en tom sida.
        if (parsed.items.length === 0 && !xml.includes("<Items>")) parsed = page === 1 ? null : parsed;
        if (parsed) break;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("429") || msg.includes("AboveCallLimit")) { failed = true; break; }
      }
    }
    if (!parsed || failed) { failed = true; break; }
    totalPages = parsed.totalPages;
    for (const it of parsed.items) if (!items.has(it.itemId)) items.set(it.itemId, it);
  }
  res.listings = items.size;
  res.complete = !failed && totalPages <= MAX_PAGES && items.size > 0;
  log(`[op-tradera] ${items.size} fastprisannonser på ${totalPages} sidor (${res.apiCalls} anrop)${res.complete ? "" : " — OFULLSTÄNDIG körning, inget pensioneras"}.`);
  if (items.size === 0) return res;

  // ── 2. Katalogen ────────────────────────────────────────────────────────────
  const cardsByNumber = await loadOnePieceCardRows();
  const matchIndex = await loadMatchIndex({ visibleOnly: true });
  const meta = new Map(
    (await prisma.product.findMany({ where: { game: "ONE_PIECE" }, select: { id: true, category: true, title: true } }))
      .map((p) => [p.id, p])
  );

  // ── 3. Matchning ────────────────────────────────────────────────────────────
  const guards = new Map<string, Promise<(priceOre: number) => boolean>>();
  const guardFor = (productId: string) => {
    let g = guards.get(productId);
    if (!g) guards.set(productId, (g = getListingPriceGuard(productId)));
    return g;
  };
  const byProduct = new Map<string, TraderaItem[]>();
  const samples: string[] = [];
  const bump = (reason: string) => { res.reasons[reason] = (res.reasons[reason] ?? 0) + 1; };
  const hits: { item: TraderaItem; productId: string; kind: "single" | "sealed"; code?: string }[] = [];
  await mapPool([...items.values()], DB_CONCURRENCY, async (item) => {
    const m = await matchOnePieceTraderaListing(item.title, cardsByNumber, matchIndex, (id) => meta.get(id)?.category);
    if ("reason" in m) { bump(m.reason); return; }
    hits.push({ item, ...m });
  });

  // ── 3b. Språkdomen på fotot (singlar) ───────────────────────────────────────
  const refImage = new Map<string, string>();
  for (const rows of cardsByNumber.values()) for (const r of rows) if (r.imageUrl) refImage.set(r.productId, r.imageUrl);
  const lang = await judgeOnePieceListingLanguage(
    hits.filter((h) => h.kind === "single").map((h) => ({
      itemId: h.item.itemId, code: h.code!, productId: h.productId, priceOre: h.item.priceOre,
      photo: traderaPhotoUrl(h.item.imageUrl), ref: refImage.get(h.productId) ?? null,
    })),
    new Set(items.keys()),
    log
  );

  await mapPool(hits, DB_CONCURRENCY, async ({ item, productId, kind }) => {
    if (kind === "single" && !isConfirmedEnglish(lang, item.itemId)) {
      const v = lang[item.itemId]?.v;
      bump(
        v === "jp" ? "japanskt kort på bilden"
          : v === "unclear" ? "bilden visar inte kortet tydligt (fel kort/slab/alt. konst)"
          : v === "noalign" ? "fotot gick inte att rikta mot kortet"
          : v === "nojp" ? "ingen japansk jämförelsebild"
          : "språkdom saknas ännu (prövas nästa natt)"
      );
      return;
    }
    if (!(await guardFor(productId))(item.priceOre)) { res.implausible++; return; }
    if (kind === "single") res.matchedSingles++; else res.matchedSealed++;
    (byProduct.get(productId) ?? byProduct.set(productId, []).get(productId)!).push(item);
    if (kind === "sealed" && samples.length < (opts.sample ?? 60)) {
      samples.push(`  [${meta.get(productId)?.title}] <- ${item.title} — ${Math.round(item.priceOre / 100)} kr`);
    }
  });
  res.products = byProduct.size;
  log(
    `[op-tradera] träffar: ${res.matchedSingles} singel- + ${res.matchedSealed} sealed-annonser på ${res.products} produkter; ` +
      `${res.implausible} fällda av prisvakten.`
  );
  log(`[op-tradera] utan träff: ${Object.entries(res.reasons).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(" · ")}`);
  if (samples.length) log(`[op-tradera] sealed-träffar (stickprov):\n${samples.join("\n")}`);
  if (!apply) { log("[op-tradera] TORRKÖRNING — inget skrivet."); return res; }

  // ── 4. Skrivning ────────────────────────────────────────────────────────────
  const [tradera, source] = await Promise.all([
    prisma.retailer.findFirst({ where: { name: "Tradera" }, select: { id: true } }),
    prisma.scrapeSource.findFirst({ where: { name: "Tradera" }, select: { id: true } }),
  ]);
  if (!tradera) { log("[op-tradera] Tradera-retailern saknas."); return res; }
  const rail: { productId: string; itemId: string; title: string; price: number; url: string; imageUrl: string | null }[] = [];
  await mapPool([...byProduct.entries()], DB_CONCURRENCY, async ([productId, list]) => {
    list.sort((a, b) => a.priceOre - b.priceOre);
    const best = list[0];
    const condition = meta.get(productId)?.category === "SINGLE_CARD" ? "NEAR_MINT" : "SEALED";
    const key = { productId_retailerId_condition_language: { productId, retailerId: tradera.id, condition, language: "EN" } } as const;
    await prisma.offer.upsert({
      where: key,
      update: { price: best.priceOre, currency: "SEK", stockStatus: StockStatus.IN_STOCK, url: best.url, lastSeenAt: new Date() },
      create: {
        productId, retailerId: tradera.id, price: best.priceOre, currency: "SEK", stockStatus: StockStatus.IN_STOCK,
        url: best.url, condition, language: "EN", lastSeenAt: new Date(),
      },
    });
    res.written++;
    if (source) {
      await prisma.priceObservation.create({
        data: {
          productId, sourceId: source.id, price: best.priceOre, currency: "SEK", condition,
          rawData: { itemId: best.itemId, title: best.title, priceOre: best.priceOre, url: best.url, source: "op-tradera-sweep" },
        },
      });
    }
    for (const it of list.slice(0, MAX_RAIL_LISTINGS)) {
      rail.push({ productId, itemId: it.itemId, title: it.title, price: it.priceOre, url: it.url, imageUrl: it.imageUrl ?? null });
    }
  });

  if (res.complete) {
    // Fullständig bild ⇒ skenan ersätts i sin helhet och offers utan annons i natt är borta.
    const opProductIds = [...meta.keys()];
    await prisma.traderaListing.deleteMany({ where: { productId: { in: opProductIds } } });
    const gone = await prisma.offer.deleteMany({
      where: { retailerId: tradera.id, productId: { in: opProductIds.filter((id) => !byProduct.has(id)) } },
    });
    res.retired = gone.count;
  } else {
    await prisma.traderaListing.deleteMany({ where: { productId: { in: [...byProduct.keys()] } } });
  }
  for (let i = 0; i < rail.length; i += 1000) {
    res.railRows += (await prisma.traderaListing.createMany({ data: rail.slice(i, i + 1000), skipDuplicates: true })).count;
  }
  log(`[op-tradera] skrev ${res.written} offers, ${res.railRows} skena-rader, pensionerade ${res.retired}.`);
  return res;
}
