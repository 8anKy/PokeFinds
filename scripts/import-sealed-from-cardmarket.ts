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
import {
  classifyForm, identicalIdentity, loadMatchIndex, nearestCatalogCandidate, productsConflict,
} from "../src/scrapers/matching";
import { normalizeTitle } from "../src/lib/utils";
import { backfillCardmarketIds, buildCmIdByName } from "../src/lib/cm-catalog-names";
import { adoptCmName } from "../src/jobs/adopt-cm-name";

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
// "Booster (6 Cards)" m.fl. = USA-exklusiva N-korts-minipacks. Ägarbeslut 2026-07-19:
// hela klassen ut ur katalogen (24 raderade — inga butiksoffers, ingen bevakning,
// säljs inte i Sverige) och importen grindad så de aldrig återskapas.
const REJECT_RE =
  /^cs[a-z0-9.]*c:|\b(simplified|traditional)\s+chinese\b|\bchinese\b|\bkorean\b|\bindonesian\b|\bthai\b|\bjapanese\b|\bjpn?\b|\bcostco\b|sam'?s\s+club|\bempty\b|booster\s*\(\s*\d+\s*cards?\s*\)/i;
// Extra vakt för gratis-katalog-fallbacken: den katalogen är HELA CM (inkl. JP/CN-produkter
// vars namn inte säger språket) — RapidAPI-listan är redan kuraterat engelsk. Uppenbara
// region-/butikspromos och turneringspriser avvisas billigt här; resten grindas av
// syskon-expansionsregeln (se main).
const FULL_FALLBACK_LINES = /\b(?:league |deluxe |rival |mega |v )?battle deck\b|\btrainer'?s toolkit\b|\bbuild & battle (?:box|kit)\b|\bcollector'?s? chest\b|\btheme deck\b/i;
const JP_ONLY_LINES = /\bdeck kit\b|\bexpert deck\b|\bspecial (?:box|deck)\b|pok[eé]mon center|\bjapan\b|\bdisplay\b/i;
const FALLBACK_REJECT_RE =
  /\btaiwan\b|family\s*mart|\bgym\s+promo\b|dragon\s+boat|prize\s+pack/i;

/**
 * GROSSISTFÖRPACKNINGAR — ägarbeslut 2026-09-08: importeras INTE.
 *
 * "Delta Reign 6 Booster Box Case" (1 500 €), "10 Elite Trainer Box Case" (1 000 €),
 * "24 Sleeved Booster Case" och "Build & Battle Box Display" är distributionsenheter,
 * inte konsumentvaror: ingen svensk butik listar dem, så produkten hade legat kvar utan
 * en enda butikslänk och bara visat en Cardmarket-siffra ingen kan handla på.
 * "Fun Pack (3 Cards)" (0,60 €) är kassalinjeskräp.
 * MÄTT i TCGGO-gapet: 93 case + 23 display + 27 fun pack = 143 av 486 nya.
 *
 * ⛔ `\bcase\b` KRÄVER ordgräns — "Showcase" och "Suitcase" är riktiga produktnamn.
 * ⛔ "Display" ensamt är FÖRBJUDET som avvisningsord: `FORM_TO_CAT` mappar display →
 *    BOOSTER_BOX eftersom CM kallar en vanlig boosterbox "Display". Bara det
 *    SAMMANSATTA "X Box Display" (en låda med flera lådor) fälls.
 */
const WHOLESALE_RE =
  /\bcase\b|\bfun pack\b|(?:box|blister|bundle|collection|deck)\s+display\b|\bdisplay\s+case\b/i;

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
  // ⛔ DE HÄR SAKNADES FRAM TILL 2026-09-30. Battle/League/Theme Decks, Build & Battle,
  //    Chests och Surprise Box importerades ALDRIG ur Cardmarket — de fanns i katalogen
  //    bara för att BUTIKER skapade dem (vidgningen 2026-08-15, +320 produkter). När
  //    butikerna slutade skapa produkter hade deras annonser inget att kopplas till:
  //    MÄTT 578 oägda CM-produkter utanför de sju formerna, ~250 av dem riktiga
  //    konsumentvaror (179 theme decks, 36 Build & Battle …). Samma kategori som
  //    butiksklassificeraren ger dem (COLLECTION_BOX), så båda sidor är överens.
  buildbattle: "COLLECTION_BOX", deck: "COLLECTION_BOX", chest: "COLLECTION_BOX", surprisebox: "COLLECTION_BOX",
};
/** Formlösa CM-namn som ändå är konsumentvaror (klassificeraren känner inga formord i dem). */
const EXTRA_COLLECTION_RE = /\btrainer'?s toolkit\b|\bstarter (?:set|deck)\b|\bbattle academy\b|\bworld championships? deck\b|\bpremium deck set\b|\bspecial deck set\b/i;
/** Tillbehör som klassificeraren kallar "deck"/"collection" — ägarbeslut: inga tillbehör i katalogen. */
const ACCESSORY_NAME_RE = /\bdeck holder\b|\bplaymat\b|\bdice\b|\bcoins?\b|\bsleeves?\b|\bportfolio\b|\bbinder\b(?! collection)/i;
function cmCategory(name: string): { form: string | null; cat: ProductCategory | undefined } {
  const form = classifyForm(name);
  if (ACCESSORY_NAME_RE.test(name)) return { form, cat: undefined };
  const cat = form ? FORM_TO_CAT[form] : undefined;
  if (cat) return { form, cat };
  return { form: form ?? "collection", cat: EXTRA_COLLECTION_RE.test(name) ? "COLLECTION_BOX" : undefined };
}

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
async function loadRecentProducts(days: number | null): Promise<{
  recent: Map<number, string>;
  /** Hela gratis-katalogen (bara i fullt läge, RECENT_DAYS osatt). */
  all: Map<number, string>;
  expansionOf: Map<number, number>;
  idByName: Map<string, number>;
}> {
  const r = await fetch(NONSINGLES_URL);
  if (!r.ok) throw new Error(`Gratis CM-katalog (dateAdded) HTTP ${r.status}`);
  const j = (await r.json()) as {
    products: { idProduct: number; name: string; idExpansion: number; dateAdded: string }[];
  };
  const cutoff = days != null ? Date.now() - days * 86_400_000 : null;
  const recent = new Map<number, string>();
  const all = new Map<number, string>();
  const expansionOf = new Map<number, number>();
  for (const p of j.products) {
    expansionOf.set(p.idProduct, p.idExpansion);
    if (cutoff == null) { all.set(p.idProduct, p.name); continue; }
    const t = Date.parse(p.dateAdded.replace(" ", "T") + "Z");
    if (!Number.isNaN(t) && t >= cutoff) recent.set(p.idProduct, p.name);
  }
  return { recent, all, expansionOf, idByName: buildCmIdByName(j.products) };
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
    select: { url: true, product: { select: { id: true, setId: true, language: true } } },
  });
  const existingCmIds = new Set<number>();
  const existingEnCmIds = new Set<number>();
  // cmid → befintlig produkt: används av set-etikett-backfillen (setId=null → episodens set).
  const productByCmId = new Map<number, { id: string; setId: string | null; language: string }>();
  for (const o of cmOffers) {
    const m = o.url.match(/idProduct=(\d+)/);
    if (!m) continue;
    const id = parseInt(m[1], 10);
    existingCmIds.add(id);
    if (o.product?.language === "EN") existingEnCmIds.add(id);
    if (o.product) productByCmId.set(id, o.product);
  }
  const existingTitles = new Set(
    // Gömda rader blockerar inte: en gömd butiksstubb med samma namn ska ERSÄTTAS av
    // CM-produkten (merge-store-stubs-into-cm.ts slår sedan ihop den), inte stoppa den.
    (await prisma.product.findMany({ where: { hiddenAt: null }, select: { normalizedTitle: true, category: true } }))
      .map((p) => `${p.category}|${p.normalizedTitle}`)
  );
  const usedSlugs = new Set((await prisma.product.findMany({ select: { slug: true } })).map((p) => p.slug));

  // ⛔ Bara ENGELSKA set: importen är EN-only (se kommentaren om JP ovan) och
  // japanska set delar latinska namn med sina engelska motsvarigheter.
  const sets = await prisma.cardSet.findMany({ where: { language: "EN" }, select: { id: true, name: true } });
  const setMap = new Map(sets.map((s) => [norm(s.name), s.id]));

  // Gratis-katalogen laddas ALLTID (S3, ingen RapidAPI-kvot): den bär både
  // dateAdded (RECENT_DAYS-läget) och namn→idProduct-nyckeln nedan.
  const freeCatalog = await loadRecentProducts(RECENT_DAYS);
  const recent = RECENT_DAYS != null ? freeCatalog.recent : null;
  const recentIds = recent ? new Set(recent.keys()) : null;
  // FULLT LÄGE (2026-09-30): gratis-katalog-fallbacken körs över HELA katalogen. Leverantörens
  // lista saknar t.ex. 14 av CM:s 15 League Battle Decks och hälften av Trainer's Toolkits — utan
  // dem hade butikernas annonser inget att kopplas till när butiker slutade skapa produkter.
  // Syskon-expansionsregeln (bara expansioner där vi redan äger en EN-produkt) gäller oförändrad.
  const fallbackPool = recent ?? freeCatalog.all;

  const catalog = await loadCatalog();
  // ── NYTT SET: RapidAPI SAKNAR ÄNNU cardmarket_id (2026-09-05) ────────────────
  // Utan det här är en helt ny expansion omöjlig att importera: huvudloopen skapar
  // en produkt UTAN CM-offer (ingen länk, inget pris), RECENT_DAYS-läget hoppar
  // över den helt (`cmid == null`), och gratis-katalog-fallbacken kräver ett
  // EN-syskon i expansionen som per definition inte finns än. Mätt på Delta Reign
  // 2026-09-05: 0 av 18 kunde nå katalogen. Vakterna bor i cm-catalog-names.ts.
  const backfilled = backfillCardmarketIds(catalog, freeCatalog.idByName);
  if (backfilled.filled || backfilled.skippedTaken)
    console.log(
      `cardmarket_id återfunnet ur CM-katalogen på exakt namn: ${backfilled.filled}` +
        (backfilled.skippedTaken ? ` (${backfilled.skippedTaken} hoppade — id:t ägs redan av en annan rad)` : "")
    );
  console.log(
    `CM-katalog: ${catalog.length} · APPLY=${APPLY}` +
      (ONLY ? ` · endast ${ONLY.join(",")}` : "") +
      (recentIds ? ` · RECENT_DAYS=${RECENT_DAYS} (${recentIds.size} nyliga idProduct)` : "") +
      "\n",
  );

  const stat: Record<string, number> = {};
  let skippedHave = 0, skippedNoData = 0, skippedForm = 0, created = 0, skippedOld = 0, skippedReject = 0;
  let skippedWholesale = 0, skippedFuzzy = 0;
  /** Skapade men LIKNAR en befintlig — rapporteras för granskning, tigs aldrig ihjäl. */
  const nearDupes: string[] = [];
  // Katalogindexet EN gång: dubblettvakten nedan körs per kandidat.
  const hiddenIds = new Set((await prisma.product.findMany({ where: { hiddenAt: { not: null } }, select: { id: true } })).map((p) => p.id));
  const matchIndex = (await loadMatchIndex()).filter((c) => !hiddenIds.has(c.id));
  // Produkter som redan bär en Cardmarket-länk — bara de UTAN får adopteras.
  const twinHasCm = new Set(cmOffers.map((o) => o.product?.id).filter((id): id is string => !!id));
  let adopted = 0;

  for (const p of catalog) {
    const { form, cat } = cmCategory(p.name ?? "");
    if (!cat) { skippedForm++; continue; }
    if (ONLY && !ONLY.includes(cat)) continue;
    const cmid = p.cardmarket_id;
    const normTitle = norm(p.name);
    // Nyare-läge: bara det CM lagt till nyligen (nya/kommande set), inte bakåtkatalogen.
    if (recentIds && (cmid == null || !recentIds.has(cmid))) { skippedOld++; continue; }
    // Språk-/region-/skräpvakt (se REJECT_RE).
    if (REJECT_RE.test(p.name)) { skippedReject++; continue; }
    // Grossistförpackningar (se WHOLESALE_RE).
    if (WHOLESALE_RE.test(p.name)) { skippedWholesale++; continue; }
    if ((cmid != null && existingCmIds.has(cmid)) || existingTitles.has(`${cat}|${normTitle}`)) { skippedHave++; continue; }

    // ── DUBBLETTVAKT: IDENTITET, INTE LIKHET (2026-09-08) ──────────────────────
    // Exakt titel räcker inte: CM och vi namnger samma vara olika ("151
    // Ultra-Premium Collection" mot vår "151 Ultra Premium Collection"), och då ser
    // importen en NY produkt. MÄTT på TCGGO-gapet: 394 av 913 kandidater utan exakt
    // titelträff pekade ändå på en produkt vi redan har.
    //
    // ⛔ MEN `matchProduct` FÅR INTE VARA TESTET. Den är byggd för att LÄNKA en
    //    butiksannons, där en nära träff nästan alltid är rätt. Här är frågan den
    //    omvända — "finns varan redan?" — och ett falskt JA betyder att en RIKTIG
    //    produkt aldrig importeras, tyst och osynligt. MÄTT: matchProduct band
    //    "First Partner Illustration BOOSTER Series 1" till vår "First Partner
    //    Illustration COLLECTION: Series 1 Promo Booster Pack" på 0,912 — olika varor,
    //    och just den produkt ägaren pekade ut som saknad.
    //
    // Testet är därför `identicalIdentity`: samma identitets-ORDMÄNGD (era-namn,
    // set-koder och formord borträknade) plus hela vaktkedjan. Det är ett BEVIS, inte
    // ett Dice-tal. Allt som bara LIKNAR skapas som förut och rapporteras i stället,
    // så en verklig dubblett syns i granskningen i stället för att tigas ihjäl.
    // ⛔ `identicalIdentity` RÄKNAR BORT FORMORDEN med flit (den finns för att hitta
    //    samma vara i en annan ordföljd) — så "First Partner Illustration BOOSTER
    //    Series 1" och "…Illustration COLLECTION Series 1" har IDENTISK identitet.
    //    De är olika varor: en påse och en samlarbox. Utan formkravet nedan svalde
    //    vakten precis den produkt ägaren pekade ut som saknad. Formen jämförs, inte
    //    kategorin, eftersom kandidatindexet inte bär kategori.
    const normForMatch = normalizeTitle(p.name);
    const twin = matchIndex.find(
      (c) =>
        !c.card &&
        classifyForm(c.normalizedTitle) === form &&
        identicalIdentity(normForMatch, c.normalizedTitle) &&
        !productsConflict(p.name, c.normalizedTitle, c.language)
    );
    if (twin) {
      // ADOPTERA en butiksskapad tvilling (2026-09-30): samma identitet, men utan
      // Cardmarket-länk ⇒ ge den CM-identiteten i stället för att hoppa över. Så blir
      // gamla butiksstubbar riktiga CM-produkter och ingen andra rad skapas.
      if (cmid != null && !twinHasCm.has(twin.id)) {
        adopted++;
        twinHasCm.add(twin.id);
        existingCmIds.add(cmid);
        console.log(`  [adopterar] "${p.name}" (idProduct=${cmid}) → befintlig "${twin.normalizedTitle}"`);
        if (APPLY) {
          await prisma.offer.create({
            data: {
              productId: twin.id, retailerId: cm.id, condition: "SEALED", language: "EN",
              price: null, currency: "SEK", stockStatus: "OUT_OF_STOCK", url: cardmarketProductUrl(cmid),
            },
          }).catch((e: unknown) => console.log(`    ⚠️ kunde inte adoptera: ${e instanceof Error ? e.message : e}`));
          await adoptCmName(twin.id, p.name);
        }
        continue;
      }
      skippedFuzzy++;
      continue;
    }
    const near = nearestCatalogCandidate(normForMatch, p.name, matchIndex, 0.85);
    if (near) nearDupes.push(`${near.score.toFixed(2)}  "${p.name}"  ≈  "${near.normalizedTitle}"`);

    const c = p.prices?.cardmarket ?? {};
    // I lager = aktuell billigaste annons (`lowest`/From) finns → visa From-priset.
    // Ur lager = ingen aktuell annons (lowest saknas) → OUT_OF_STOCK + 30d-snittet
    // som uppskattat värde. Dagliga refreshen flippar tillbaka till From när en
    // annons dyker upp igen.
    const low = c.lowest ?? null;
    const avg = c["30d_average"] ?? null;
    // ⛔ EN PRODUKT UTAN PRIS MEN MED LÄNK SKA ÄNDÅ IN (ägarbeslut 2026-09-08).
    //    Kriteriet är Cardmarket-LÄNKEN, inte priset: bär produkten ett `cardmarket_id`
    //    går länken till rätt sida, och att den saknar annons just nu är ett TILLFÄLLIGT
    //    tillstånd som dagliga refreshen fyller i av sig själv. MÄTT i TCGGO-gapet: 243
    //    kandidater saknade all prisdata, varav 54 hade ett fungerande id (30th
    //    Celebration: Knock Out Collection, Pitch Black: Aurorus Premium Checklane …).
    //    ⚠️ De syns INTE i katalog/sök förrän de får ett pris (`lowestPriceOre` är
    //    filtret överallt) — produktsidan fungerar, och de är redo den dag en butik
    //    listar dem. Utan id finns ingen länk alls och produkten hör inte hemma här.
    // ⛔ UTAN `cardmarket_id` SKAPAS INGENTING — OAVSETT PRIS. Offern skrivs bara när
    //    id:t finns (se `offers:` nedan), så en produkt utan id blir ett TOMT SKAL: ingen
    //    länk, inget pris, ingen offer, osynlig i katalogen och värdelös för användaren.
    //    Första versionen av villkoret släppte igenom "pris ELLER id" och skapade 13
    //    sådana skal (Mega Tyranitar EX Premium Collection m.fl.), som fått raderas.
    //    Ägarens regel är LÄNKEN: har vi ingen länk hör produkten inte hemma här.
    if (cmid == null) { skippedNoData++; continue; }
    const eur = low ?? avg;
    // ⛔ Priset blir `null`, ALDRIG 0 — "–" läses som "vi vet inte", "0 kr" som "gratis".
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
    // Torrkörningen sa bara HUR MÅNGA — utan raderna går den inte att granska före
    // --apply (och gratis-katalog-grenen loggade redan sina).
    console.log(
      `  [rapidapi] ${cat} · ${p.name} (idProduct=${cmid ?? "SAKNAS"}, ${eur} €` +
        `${setId ? `, set "${p.episode?.name}"` : ", SET-LÖS"})`
    );

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

  // ── Set-etikett-backfill (2026-07-16) ───────────────────────────────────────
  // Sealed skapade INNAN setet fanns i DB (stubbar, gratis-katalog-fallbacken,
  // förhandsimporter) har setId=null → syns inte på set-sidan. RapidAPI-katalogens
  // episode-namn + setMap ger etiketten deterministiskt via exakt cmid — ingen
  // titelmatchning (slugen ljuger, mätt 2026-07-14). Bara EN + bara null→värde:
  // en redan satt etikett röres aldrig.
  let relabeled = 0;
  for (const p of catalog) {
    const cmid = p.cardmarket_id;
    if (cmid == null) continue;
    const owned = productByCmId.get(cmid);
    if (!owned || owned.setId != null || owned.language !== "EN") continue;
    const setId = setMap.get(norm(p.episode?.name ?? ""));
    if (!setId) continue;
    relabeled++;
    console.log(`  [set-etikett] "${p.name}" → ${p.episode?.name}`);
    if (APPLY) {
      await prisma.product.update({ where: { id: owned.id }, data: { setId } });
    }
  }
  if (relabeled) console.log(`Set-etiketter satta: ${relabeled}\n`);

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
  if (fallbackPool.size > 0) {
    const { expansionOf } = freeCatalog;
    const enExpansions = new Set<number>();
    for (const id of existingEnCmIds) {
      const exp = expansionOf.get(id);
      if (exp != null) enExpansions.add(exp);
    }
    const rapidIds = new Set(catalog.map((p) => p.cardmarket_id).filter((id): id is number => id != null));
    const guide = await loadGuide();
    let skippedNoSibling = 0;
    for (const [cmid, name] of fallbackPool) {
      if (rapidIds.has(cmid)) continue; // täcks av huvudloopen ovan
      const { cat } = cmCategory(name);
      if (!cat) { skippedForm++; continue; }
      if (ONLY && !ONLY.includes(cat)) continue;
      if (REJECT_RE.test(name) || FALLBACK_REJECT_RE.test(name)) { skippedReject++; continue; }
      if (WHOLESALE_RE.test(name)) { skippedWholesale++; continue; }
      // ⛔ I FULLT LÄGE BARA DE PRODUKTLINJER BUTIKERNA SKAPADE (2026-09-30). CM:s
      //    "diverse"-expansioner blandar engelska och japanska varor, så syskonregeln
      //    släppte igenom Pokémon Center Tokyo DX Box, Poncho-Pikachu Special Box, Deck
      //    Kits och bulklotter ("Maxi Collection (Up to 1000 cards)"). Resten väntar på
      //    leverantörens lista, som är kuraterat engelsk.
      if (!recent && (!FULL_FALLBACK_LINES.test(name) || JP_ONLY_LINES.test(name))) { skippedNoSibling++; continue; }
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
    `Adopterade butikstvillingar: ${adopted} · Skippade — har redan: ${skippedHave} · ingen data: ${skippedNoData} · ej målform: ${skippedForm}` +
      (recentIds ? ` · ej nyliga: ${skippedOld}` : "") +
      ` · språk/region/skräp: ${skippedReject}` +
      ` · grossist (case/display/fun pack): ${skippedWholesale}` +
      ` · dubblett (identisk identitet): ${skippedFuzzy}`,
  );
  if (nearDupes.length) {
    console.log(`
⚠ ${nearDupes.length} SKAPAS men liknar en befintlig produkt (≥0.85) — granska:`);
    for (const r of nearDupes.slice(0, 40)) console.log(`   ${r}`);
    if (nearDupes.length > 40) console.log(`   … och ${nearDupes.length - 40} till`);
  }
  if (!APPLY) console.log("\n(dry run — kör APPLY=1 för att skapa produkterna)");
}

main().finally(() => prisma.$disconnect());
