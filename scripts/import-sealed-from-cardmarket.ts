/**
 * Skapar sealed-produkter (booster box/pack, ETB, collection box, tin, blister,
 * bundle) ur Cardmarket-katalogen (CardMarket API TCG) som vi inte redan har —
 * med lägsta CM-pris + lagerstatus (available_items). Fyller bl.a. ALLA tins.
 *
 * Dry run:  npx tsx scripts/import-sealed-from-cardmarket.ts
 * Skriv:    APPLY=1 npx tsx scripts/import-sealed-from-cardmarket.ts
 * Filtrera: CATEGORIES=TIN,BLISTER APPLY=1 npx tsx scripts/import-sealed-from-cardmarket.ts
 * NYARE-läge (automationen): RECENT_DAYS=90 begränsar till produkter som CM lagt till
 *   de senaste N dagarna (nya/kommande set) i stället för HELA bakåtkatalogen. dateAdded
 *   läses ur CM:s GRATIS publika katalog (S3) — kostar noll RapidAPI. Bilden hämtas ändå
 *   ur RapidAPI-katalogen (p.image = transparent CM-bild, aldrig butiksfoto).
 *   Fallback: nyliga gratis-katalogprodukter som RapidAPI SAKNAR (listan släpar ibland,
 *   t.ex. First Partner Illustration Collection Series 3) importeras ändå, prissatta ur
 *   CM:s officiella prisguide. De får ingen CM-bild förrän RapidAPI hinner ikapp.
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

import { PrismaClient, type ProductCategory } from "@prisma/client";
import { getRatesOre } from "../src/lib/exchange-rate";
import { cardmarketProductUrl } from "../src/lib/marketplace-urls";
import { classifyForm } from "../src/scrapers/matching";

const prisma = new PrismaClient();
const HOST = process.env.CARDMARKET_RAPIDAPI_HOST ?? "cardmarket-api-tcg.p.rapidapi.com";
const KEY = process.env.CARDMARKET_RAPIDAPI_KEY ?? "";
const APPLY = process.env.APPLY === "1";
const THROTTLE_MS = parseInt(process.env.THROTTLE_MS ?? "220", 10);
const CACHE = path.join(process.cwd(), ".cache", "rapidapi-sealed.json");
const ONLY = process.env.CATEGORIES?.split(",").map((s) => s.trim().toUpperCase());
const RECENT_DAYS = process.env.RECENT_DAYS ? parseInt(process.env.RECENT_DAYS, 10) : null;
const NONSINGLES_URL =
  "https://downloads.s3.cardmarket.com/productCatalog/productList/products_nonsingles_6.json";
// Defensiv språk-/region-/skräpvakt. RapidAPI-katalogen är redan engelsk (verifierat
// 2026-07-07), men vi grindar ändå: kinesiska version-set börjar med en kod som slutar
// på "C" ("CSV9C:", "CSVM2cC:", "CSVH5C:"), språknamn kan stå i titeln, Costco/Sam's Club
// är regionsexklusiva, och "Empty"-tins är tomma tillbehör. Hellre missa en udda titel än
// fel-skapa en. EN-only tills vidare (JP prissätts separat via runJapaneseSealedRefresh).
// OBS: punkt i klassen — kinesiska mellanset heter "CSV9.5C:" (utan punkten släpptes
// 22 kinesiska Terastal Gathering-produkter igenom fallbacken, mätt 2026-07-16).
// \bjpn?\b: CM skriver ibland bara "JP" ("30th Celebration JP Booster Box").
const REJECT_RE =
  /^cs[a-z0-9.]*c:|\b(simplified|traditional)\s+chinese\b|\bchinese\b|\bkorean\b|\bindonesian\b|\bthai\b|\bjapanese\b|\bjpn?\b|\bcostco\b|sam'?s\s+club|\bempty\b/i;
// Extra vakt för gratis-katalog-fallbacken: den katalogen är HELA CM (inkl. JP/CN-produkter
// vars namn inte säger språket) — RapidAPI-listan är redan kuraterat engelsk. Uppenbara
// region-/butikspromos och turneringspriser avvisas billigt här; resten grindas av
// syskon-expansionsregeln (se main).
const FALLBACK_REJECT_RE =
  /\btaiwan\b|family\s*mart|\bgym\s+promo\b|dragon\s+boat|prize\s+pack/i;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const norm = (s: string) =>
  s.toLowerCase().replace(/pok[eé]mon|tcg|:/g, "").replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
const slugify = (s: string) =>
  s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/é/g, "e").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);

const FORM_TO_CAT: Record<string, ProductCategory> = {
  display: "BOOSTER_BOX", booster: "BOOSTER_PACK", etb: "ETB",
  collection: "COLLECTION_BOX", tin: "TIN", blister: "BLISTER", bundle: "BUNDLE",
};

interface ApiProduct {
  name: string; slug?: string; cardmarket_id: number | null; image?: string;
  prices?: { cardmarket?: { lowest?: number | null; "30d_average"?: number | null; available_items?: number | null } | null } | null;
  episode?: { name?: string } | null;
}

async function loadCatalog(): Promise<ApiProduct[]> {
  if (fs.existsSync(CACHE) && Date.now() - fs.statSync(CACHE).mtimeMs < 6 * 3600_000) {
    return JSON.parse(fs.readFileSync(CACHE, "utf-8"));
  }
  if (!KEY) throw new Error("Cache saknas och CARDMARKET_RAPIDAPI_KEY ej satt");
  const out: ApiProduct[] = [];
  let page = 1, total = 1;
  do {
    const r = await fetch(`https://${HOST}/pokemon/products?page=${page}`, { headers: { "x-rapidapi-host": HOST, "x-rapidapi-key": KEY } });
    if (!r.ok) break;
    const d = (await r.json()) as { data: ApiProduct[]; paging: { total: number } };
    total = d.paging.total;
    out.push(...d.data);
    await sleep(THROTTLE_MS);
  } while (page++ < total);
  fs.mkdirSync(path.dirname(CACHE), { recursive: true });
  fs.writeFileSync(CACHE, JSON.stringify(out));
  return out;
}

// Produkter (idProduct → namn) som CM lade till katalogen de senaste `days` dagarna,
// plus idProduct → idExpansion för HELA gratis-katalogen. Läses ur CM:s GRATIS publika
// katalog (S3) — RapidAPI-produkten saknar dateAdded, gratis-katalogen har den. Så
// automationen fångar NYA/kommande set och hoppar över hela bakåtkatalogen. Namn +
// expansioner behövs för gratis-katalog-fallbacken (se main).
async function loadRecentProducts(days: number): Promise<{
  recent: Map<number, string>;
  expansionOf: Map<number, number>;
}> {
  const r = await fetch(NONSINGLES_URL);
  if (!r.ok) throw new Error(`Gratis CM-katalog (dateAdded) HTTP ${r.status}`);
  const j = (await r.json()) as {
    products: { idProduct: number; name: string; idExpansion: number; dateAdded: string }[];
  };
  const cutoff = Date.now() - days * 86_400_000;
  const recent = new Map<number, string>();
  const expansionOf = new Map<number, number>();
  for (const p of j.products) {
    expansionOf.set(p.idProduct, p.idExpansion);
    const t = Date.parse(p.dateAdded.replace(" ", "T") + "Z");
    if (!Number.isNaN(t) && t >= cutoff) recent.set(p.idProduct, p.name);
  }
  return { recent, expansionOf };
}

// CM:s officiella prisguide (idProduct → low/trend/avg) — samma publika export som
// dagliga cardmarket-refresh använder. Prissätter gratis-katalog-fallbacken.
const PRICE_GUIDE_URL =
  "https://downloads.s3.cardmarket.com/productCatalog/priceGuide/price_guide_6.json";
// En sealed-produkt kostar aldrig under ~0,5 € — golv mot korrupta guide-värden
// (samma MIN_SEALED_EUR-resonemang som i cardmarket-refresh.ts).
const MIN_SEALED_EUR = 0.5;
const usable = (v: number | null | undefined): number | null =>
  v != null && v >= MIN_SEALED_EUR ? v : null;
interface GuideEntry { idProduct: number; avg: number | null; low: number | null; trend: number | null }
async function loadGuide(): Promise<Map<number, GuideEntry>> {
  const r = await fetch(PRICE_GUIDE_URL);
  if (!r.ok) throw new Error(`CM-prisguide HTTP ${r.status}`);
  const j = (await r.json()) as { priceGuides: GuideEntry[] };
  return new Map(j.priceGuides.map((e) => [e.idProduct, e]));
}

async function main() {
  const rates = await getRatesOre();
  const cm = await prisma.retailer.findFirst({ where: { name: "Cardmarket" } });
  if (!cm) throw new Error("Cardmarket-retailer saknas");

  // Dedup: cardmarket_id ur befintliga CM-offer-URL:er + (normTitle|kategori).
  // Produktspråket följer med för syskon-expansionsregeln (bara EN-produkter får
  // vittna om att en expansion är engelsk — annars skulle våra taggade JP-produkter
  // vitlista sina japanska expansioner).
  const cmOffers = await prisma.offer.findMany({
    where: { retailerId: cm.id, url: { contains: "idProduct=" } },
    select: { url: true, product: { select: { language: true } } },
  });
  const existingCmIds = new Set<number>();
  const existingEnCmIds = new Set<number>();
  for (const o of cmOffers) {
    const m = o.url.match(/idProduct=(\d+)/);
    if (!m) continue;
    const id = parseInt(m[1], 10);
    existingCmIds.add(id);
    if (o.product?.language === "EN") existingEnCmIds.add(id);
  }
  const existingTitles = new Set(
    (await prisma.product.findMany({ select: { normalizedTitle: true, category: true } }))
      .map((p) => `${p.category}|${p.normalizedTitle}`)
  );
  const usedSlugs = new Set((await prisma.product.findMany({ select: { slug: true } })).map((p) => p.slug));

  const sets = await prisma.cardSet.findMany({ select: { id: true, name: true } });
  const setMap = new Map(sets.map((s) => [norm(s.name), s.id]));

  const freeCatalog = RECENT_DAYS != null ? await loadRecentProducts(RECENT_DAYS) : null;
  const recent = freeCatalog?.recent ?? null;
  const recentIds = recent ? new Set(recent.keys()) : null;

  const catalog = await loadCatalog();
  console.log(
    `CM-katalog: ${catalog.length} · APPLY=${APPLY}` +
      (ONLY ? ` · endast ${ONLY.join(",")}` : "") +
      (recentIds ? ` · RECENT_DAYS=${RECENT_DAYS} (${recentIds.size} nyliga idProduct)` : "") +
      "\n",
  );

  const stat: Record<string, number> = {};
  let skippedHave = 0, skippedNoData = 0, skippedForm = 0, created = 0, skippedOld = 0, skippedReject = 0;

  for (const p of catalog) {
    const form = classifyForm(p.name ?? "");
    const cat = form ? FORM_TO_CAT[form] : undefined;
    if (!cat) { skippedForm++; continue; }
    if (ONLY && !ONLY.includes(cat)) continue;
    const cmid = p.cardmarket_id;
    const normTitle = norm(p.name);
    // Nyare-läge: bara det CM lagt till nyligen (nya/kommande set), inte bakåtkatalogen.
    if (recentIds && (cmid == null || !recentIds.has(cmid))) { skippedOld++; continue; }
    // Språk-/region-/skräpvakt (se REJECT_RE).
    if (REJECT_RE.test(p.name)) { skippedReject++; continue; }
    if ((cmid != null && existingCmIds.has(cmid)) || existingTitles.has(`${cat}|${normTitle}`)) { skippedHave++; continue; }

    const c = p.prices?.cardmarket ?? {};
    // I lager = aktuell billigaste annons (`lowest`/From) finns → visa From-priset.
    // Ur lager = ingen aktuell annons (lowest saknas) → OUT_OF_STOCK + 30d-snittet
    // som uppskattat värde. Dagliga refreshen flippar tillbaka till From när en
    // annons dyker upp igen.
    const low = c.lowest ?? null;
    const avg = c["30d_average"] ?? null;
    if (low == null && avg == null) { skippedNoData++; continue; }
    const eur = low ?? avg;
    const priceOre = eur != null ? Math.round(eur * rates.eurToOre) : null;
    const stockStatus = low != null ? "IN_STOCK" : "OUT_OF_STOCK";
    const setId = setMap.get(norm(p.episode?.name ?? "")) ?? null;

    let slug = slugify(p.name) || `cm-${cmid}`;
    if (usedSlugs.has(slug)) slug = `${slug}-${cmid}`;
    usedSlugs.add(slug);
    existingTitles.add(`${cat}|${normTitle}`);
    if (cmid != null) existingCmIds.add(cmid);

    stat[cat] = (stat[cat] ?? 0) + 1;
    created++;

    if (APPLY) {
      await prisma.product.create({
        data: {
          title: p.name, normalizedTitle: normTitle, slug, category: cat, setId,
          imageUrl: p.image ?? null, language: "EN",
          offers: cmid != null ? {
            create: {
              retailerId: cm.id, condition: "SEALED", language: "EN",
              price: priceOre, currency: "SEK", stockStatus,
              url: cardmarketProductUrl(cmid),
            },
          } : undefined,
        },
      });
    }
  }

  // ── Gratis-katalog-fallback (2026-07-16) ────────────────────────────────────
  // RapidAPI:s produktlista SLÄPAR/saknar vissa CM-produkter (mätt: First Partner
  // Illustration Collection Series 2+3 finns i CM:s gratis-katalog + prisguide men
  // inte i RapidAPI). I RECENT_DAYS-läget tar vi därför även med nyliga gratis-
  // katalogprodukter som RapidAPI saknar, prissatta ur CM:s officiella prisguide
  // (samma källa som dagliga refreshen: low > trend > avg).
  //
  // SYSKON-EXPANSIONSREGELN: gratis-katalogen är HELA CM inkl. JP/CN/SEA-produkter
  // vars namn inte säger språket ("Shiny Star V Collection Set" = japansk). CM lägger
  // dock varje språkutgåva i EGEN expansion (mätt 2026-07-16: 30th EN=6601, JP=6602,
  // CN=6603, ID/TH=6604). En kandidat godkänns därför BARA om dess idExpansion redan
  // innehåller en EN-produkt vi äger — deterministiskt, gratis, och "hellre missa än
  // fel-skapa": helt nya expansioner kommer in via RapidAPI-huvudloopen i stället.
  // Ingen CM-bild — gratis-katalogen saknar bildfält; refresh/butiksfoto fyller senare.
  let createdGuide = 0;
  if (recent && freeCatalog) {
    const { expansionOf } = freeCatalog;
    const enExpansions = new Set<number>();
    for (const id of existingEnCmIds) {
      const exp = expansionOf.get(id);
      if (exp != null) enExpansions.add(exp);
    }
    const rapidIds = new Set(catalog.map((p) => p.cardmarket_id).filter((id): id is number => id != null));
    const guide = await loadGuide();
    let skippedNoSibling = 0;
    for (const [cmid, name] of recent) {
      if (rapidIds.has(cmid)) continue; // täcks av huvudloopen ovan
      const form = classifyForm(name);
      const cat = form ? FORM_TO_CAT[form] : undefined;
      if (!cat) { skippedForm++; continue; }
      if (ONLY && !ONLY.includes(cat)) continue;
      if (REJECT_RE.test(name) || FALLBACK_REJECT_RE.test(name)) { skippedReject++; continue; }
      const normTitle = norm(name);
      if (existingCmIds.has(cmid) || existingTitles.has(`${cat}|${normTitle}`)) { skippedHave++; continue; }
      const exp = expansionOf.get(cmid);
      if (exp == null || !enExpansions.has(exp)) { skippedNoSibling++; continue; }

      const e = guide.get(cmid);
      const low = usable(e?.low);
      const eur = low ?? usable(e?.trend) ?? usable(e?.avg);
      if (eur == null) { skippedNoData++; continue; }
      const priceOre = Math.round(eur * rates.eurToOre);
      const stockStatus = low != null ? "IN_STOCK" : "OUT_OF_STOCK";

      let slug = slugify(name) || `cm-${cmid}`;
      if (usedSlugs.has(slug)) slug = `${slug}-${cmid}`;
      usedSlugs.add(slug);
      existingTitles.add(`${cat}|${normTitle}`);
      existingCmIds.add(cmid);

      stat[cat] = (stat[cat] ?? 0) + 1;
      created++;
      createdGuide++;
      console.log(`  [gratis-katalog] ${cat} · ${name} (idProduct=${cmid}, ${eur} €)`);

      if (APPLY) {
        await prisma.product.create({
          data: {
            title: name, normalizedTitle: normTitle, slug, category: cat, setId: null,
            imageUrl: null, language: "EN",
            offers: {
              create: {
                retailerId: cm.id, condition: "SEALED", language: "EN",
                price: priceOre, currency: "SEK", stockStatus,
                url: cardmarketProductUrl(cmid),
              },
            },
          },
        });
      }
    }
    if (skippedNoSibling) console.log(`  [gratis-katalog] utan EN-syskon-expansion (avvaktar RapidAPI): ${skippedNoSibling}`);
  }

  console.log("Skapas per kategori:");
  for (const [c, n] of Object.entries(stat).sort((a, b) => b[1] - a[1])) console.log(`  ${c}: ${n}`);
  console.log(`\nTotalt nya: ${created}` + (createdGuide ? ` (varav ${createdGuide} via gratis-katalogen)` : ""));
  console.log(
    `Skippade — har redan: ${skippedHave} · ingen data: ${skippedNoData} · ej målform: ${skippedForm}` +
      (recentIds ? ` · ej nyliga: ${skippedOld}` : "") +
      ` · språk/region/skräp: ${skippedReject}`,
  );
  if (!APPLY) console.log("\n(dry run — kör APPLY=1 för att skapa produkterna)");
}

main().finally(() => prisma.$disconnect());
