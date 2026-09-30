/**
 * JAPANSKA SEALED SKAPAS UR CARDMARKET, ALDRIG UR EN BUTIK (2026-09-30, ägarbeslut).
 *
 * Katalogen ska växa från EN källa med exakta id:n — Cardmarkets `idProduct` — och
 * butikerna ska bara KOPPLAS på det som redan finns. Engelska sealed kom redan så
 * (`scripts/import-sealed-from-cardmarket.ts`), men japanska sealed hade ingen sådan
 * väg: de SKAPADES av butiksimporten och mappades till CM i efterhand
 * (`runJapaneseSealedRefresh`). Varje butik som skrev titeln lite annorlunda blev en
 * egen produkt — ägaren städade dubbletter för hand varje vecka.
 *
 * Källa: leverantörens kuraterade japanska produktlista (`/pokemon-jp/products`,
 * ~16 sidor à 20). Varje produkt bär `cardmarket_id`; saknas det (helt nya set, t.ex.
 * 30th Celebration JP) slås det upp i CM:s EGEN katalog på EXAKT namn
 * (`cm-catalog-names.ts`, samma regel som den engelska importen). ⛔ UTAN id SKAPAS
 * INGET — identiteten gissas aldrig; produkten kommer nästa natt när id:t finns.
 *
 * Dublettskyddet är exakt, ingen LLM: ett `idProduct` som redan ägs av en produkt
 * (via CM-offerns URL) hoppas över, liksom ett namn en japansk produkt redan bär.
 * Körs EFTER `runJapaneseSealedRefresh` så befintliga butiksprodukter hinner göra
 * anspråk på sina id:n först. Den nya produkten får en LÄNK-offer (utan pris) — nästa
 * körning sätter pris och set-etikett ur prisguiden, precis som för en nymappad.
 */
import type { ProductCategory } from "@prisma/client";
import { prisma } from "@/lib/db";
import { buildCmIdByName, cmCatalogNameKey } from "@/lib/cm-catalog-names";
import { cardmarketJapaneseProductUrl } from "@/lib/marketplace-urls";
import { normalizeTitle, slugify } from "@/lib/utils";
import { guessListingCategory } from "@/scrapers/listing-category";

const NONSINGLES_URL =
  "https://downloads.s3.cardmarket.com/productCatalog/productList/products_nonsingles_6.json";
const THROTTLE_MS = 220;

/** Kategorier en japansk katalogprodukt får ha — samma familj som JP-refreshens mappning. */
const JP_SEALED_CATEGORIES = new Set<string>(["BOOSTER_PACK", "BOOSTER_BOX", "ETB", "TIN", "COLLECTION_BOX", "BUNDLE", "BLISTER"]);

/**
 * Grossistenheter (samma ägarbeslut som den engelska importen 2026-09-08): ingen svensk
 * butik säljer en "Booster Box Case", så produkten hade bara visat en CM-siffra.
 * ⛔ `\bcase\b` med ordgräns — "Showcase" är ett riktigt produktnamn.
 */
const WHOLESALE_RE = /\bcase\b|\bfun pack\b|(?:box|blister|bundle|collection|deck)\s+display\b/i;
/** Kinesiska/koreanska utgåvor hör aldrig hemma i en japansk lista, men vakta ändå. */
const FOREIGN_RE = /^cs[a-z0-9.]*c:|\bchinese\b|\bkorean\b|\bindonesian\b|\bthai\b/i;

interface JpApiProduct {
  id: number;
  name: string;
  cardmarket_id: number | null;
  image?: string | null;
  episode?: { name?: string | null } | null;
}

export interface JpSealedImportResult {
  apiCalls: number;
  listed: number;
  created: number;
  idFromCatalog: number;
  skippedNoId: number;
  skippedOwned: number;
  skippedFiltered: number;
  createdTitles: string[];
}

/** Ren dom: ska leverantörens rad bli en katalogprodukt, och i så fall vilken kategori? */
export function jpSealedCategory(name: string): ProductCategory | null {
  if (WHOLESALE_RE.test(name) || FOREIGN_RE.test(name)) return null;
  const cat = guessListingCategory(name);
  return JP_SEALED_CATEGORIES.has(cat) ? (cat as ProductCategory) : null;
}

export async function runJapaneseSealedImport(
  opts: { apply?: boolean; log?: (s: string) => void } = {}
): Promise<JpSealedImportResult> {
  const apply = opts.apply ?? true;
  const log = opts.log ?? ((s: string) => console.log(s));
  const res: JpSealedImportResult = {
    apiCalls: 0, listed: 0, created: 0, idFromCatalog: 0, skippedNoId: 0, skippedOwned: 0, skippedFiltered: 0, createdTitles: [],
  };
  const HOST = process.env.CARDMARKET_RAPIDAPI_HOST || "cardmarket-api-tcg.p.rapidapi.com";
  const KEY = process.env.CARDMARKET_RAPIDAPI_KEY || "";
  if (!KEY) return res;
  const cm = await prisma.retailer.findFirst({ where: { name: "Cardmarket" }, select: { id: true } });
  if (!cm) return res;

  // ── 1. Leverantörens japanska produktlista ──────────────────────────────────
  const items: JpApiProduct[] = [];
  let page = 1;
  let total = 1;
  do {
    const r = await fetch(`https://${HOST}/pokemon-jp/products?page=${page}`, {
      headers: { "x-rapidapi-key": KEY, "x-rapidapi-host": HOST },
    });
    res.apiCalls++;
    // ⛔ Fail loud: en tappad sida = tyst uteblivna produkter. Kvoten slut ⇒ vänta till i morgon.
    if (!r.ok) throw new Error(`[cm-jp-import] /pokemon-jp/products?page=${page} HTTP ${r.status}`);
    const d = (await r.json()) as { data?: JpApiProduct[]; paging?: { total?: number } };
    total = d.paging?.total ?? 1;
    items.push(...(d.data ?? []));
    page++;
    await new Promise((ok) => setTimeout(ok, THROTTLE_MS));
  } while (page <= total);
  res.listed = items.length;

  // ── 2. Saknade id:n ur CM:s egen katalog, på EXAKT namn ──────────────────────
  const catRes = await fetch(NONSINGLES_URL);
  if (!catRes.ok) throw new Error(`[cm-jp-import] nonsingles-katalog HTTP ${catRes.status}`);
  const catalog = (await catRes.json()) as { products: { idProduct: number; name: string }[] };
  const idByName = buildCmIdByName(catalog.products);

  // ── 3. Vad äger vi redan? (idProduct via CM-offerns URL + japanska namn) ────
  const cmOffers = await prisma.offer.findMany({
    where: { retailerId: cm.id, url: { contains: "idProduct=" } },
    select: { url: true },
  });
  const owned = new Set<number>();
  for (const o of cmOffers) {
    const m = o.url.match(/idProduct=(\d+)/);
    if (m) owned.add(parseInt(m[1], 10));
  }
  const jpNames = new Set(
    (await prisma.product.findMany({ where: { language: "JP", cardId: null }, select: { title: true } })).map((p) =>
      cmCatalogNameKey(p.title)
    )
  );

  // ── 4. Skapa det som saknas ─────────────────────────────────────────────────
  for (const it of items) {
    const name = (it.name ?? "").trim();
    // ⛔ `lang` är NAMNETS språk ("en" = latinsk skrift), inte produktens — hela listan är japansk.
    if (!name) { res.skippedFiltered++; continue; }
    const category = jpSealedCategory(name);
    if (!category) { res.skippedFiltered++; continue; }
    let idProduct = it.cardmarket_id;
    if (idProduct == null) {
      idProduct = idByName.get(cmCatalogNameKey(name)) ?? null;
      if (idProduct != null) res.idFromCatalog++;
    }
    if (idProduct == null) { res.skippedNoId++; continue; }
    if (owned.has(idProduct) || jpNames.has(cmCatalogNameKey(name))) { res.skippedOwned++; continue; }

    res.created++;
    res.createdTitles.push(`${name} [${category}] #${idProduct}`);
    owned.add(idProduct);
    jpNames.add(cmCatalogNameKey(name));
    if (!apply) continue;

    let slug = slugify(`${name} jp`) || `jp-${idProduct}`;
    if (await prisma.product.findUnique({ where: { slug }, select: { id: true } })) slug = `${slug}-${idProduct}`;
    const product = await prisma.product.create({
      data: {
        title: name,
        normalizedTitle: normalizeTitle(name),
        slug,
        category,
        language: "JP",
        imageUrl: it.image ?? null,
      },
      select: { id: true },
    });
    // LÄNK-offer utan pris: identiteten (idProduct) sitter i URL:en. Nästa körning av
    // runJapaneseSealedRefresh prissätter den och jp-set-label sätter setet.
    await prisma.offer.create({
      data: {
        productId: product.id,
        retailerId: cm.id,
        condition: "SEALED",
        language: "JP",
        price: null,
        currency: "SEK",
        stockStatus: "OUT_OF_STOCK",
        url: cardmarketJapaneseProductUrl(idProduct),
      },
    });
  }

  log(
    `[cm-jp-import] ${res.listed} japanska produkter hos leverantören → ${res.created} ${apply ? "skapade" : "SKULLE skapas"}` +
      ` (${res.idFromCatalog} id ur CM-katalogen), ${res.skippedOwned} fanns redan, ${res.skippedNoId} utan CM-id (väntar),` +
      ` ${res.skippedFiltered} ej sealed/grossist. ${res.apiCalls} API-anrop.`
  );
  for (const t of res.createdTitles) log(`[cm-jp-import]   + ${t}`);
  return res;
}
