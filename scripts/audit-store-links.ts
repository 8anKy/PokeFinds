/**
 * Säljer butikslänken VERKLIGEN den produkt den sitter på?
 *
 *   node scripts/with-prod-db.mjs npx tsx scripts/audit-store-links.ts             # bara pris-avvikelse (ingen HTTP)
 *   node scripts/with-prod-db.mjs npx tsx scripts/audit-store-links.ts --verify    # hämtar sidorna och läser deras titel
 *   … --limit=200      # tak på antal sidor som hämtas
 *   … --min-ratio=0.15 # hur långt under CM-priset som räknas som misstänkt
 *   … --csv
 *
 * TVÅ OBEROENDE PRÖVNINGAR, i den ordningen med flit:
 *
 *  1. PRIS (gratis, ingen HTTP). En butikslänk vars pris är en bråkdel av Cardmarkets
 *     är nästan alltid fäst på fel produkt. Det var så de här hittades:
 *       "Base Set 2 Booster Pack" (CM 3 275 kr) hade en Hobbykort-länk på **79 kr**
 *       till `/pokemon-scarlet-violet-base-set-booster-pack` — ett HELT annat set —
 *       och en Beam Cardshop-länk på 197 kr till `/sun-moon-base-booster-pack`.
 *
 *  2. SIDANS EGEN TITEL (kostar en hämtning per länk). Butikens `og:title`/JSON-LD/
 *     Shopifys `.js` säger vad sidan faktiskt säljer. Det är det enda som BEVISAR att
 *     en länk är fel — priset ger bara misstanken.
 *
 * ⛔ RAPPORT, ALDRIG REPARATION. Att ta bort en offer ändrar en produkts rubrikpris.
 *    Åtgärd sker via fix-store-links.ts med granskade rader.
 * ⛔ En hög avvikelse är INTE bevis. Vår sealed-CM-mappning är ibland fel (för hög),
 *    och en butik får sälja billigare än Cardmarket. Därför krävs steg 2 innan något
 *    kallas fel.
 */
import "./load-env";
import { prisma } from "../src/lib/db";
import { SEALED_CATEGORY_EXCLUSIONS } from "../src/lib/product-category";
import { normalizeTitle } from "../src/lib/utils";
import { scoreSimilarity, productsConflict, cleanListingTitle } from "../src/scrapers/matching";
import { politeFetch } from "../src/scrapers/http";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

/**
 * SIDANS EGET SET ÄR DEN OBEROENDE SIGNALEN.
 *
 * ⛔ Att köra matcharen igen mot sidans titel BEVISAR INGENTING: de felaktiga länkarna
 *    finns just för att matcharen godkände dem. En revision måste använda något
 *    matcharen INTE hade. Priset är en sådan signal; setet är en starkare.
 *
 * Nämner sidan ett KÄNT setnamn, och är det ett ANNAT set än produktens, är länken fel
 * — oavsett hur lika titlarna ser ut. Det var precis felet i alla verifierade fall:
 *   "Pokémon SV1: Base Set Booster Pack"      på vår Base Set 2-produkt
 *   "Sun & Moon Base Set Booster Pack"        på samma produkt
 *   "MEGA EVOLUTION 5 … CHECKLANE LUXRAY"     på vår Evolving Skies-produkt
 *
 * ⛔ LÄNGSTA TRÄFFEN VINNER. "Base Set 2" innehåller "Base Set"; utan längdsortering
 *    hade varje Base Set 2-sida lästs som "Base Set" och flaggats felaktigt.
 * ⛔ Nämner sidan INGET känt set säger metoden ingenting — då faller vi tillbaka på
 *    priset. Tystnad är inte bevis.
 */
/**
 * Nämner sidan VÅRT set?
 *
 * ⛔ FRÅGAN MÅSTE STÄLLAS ÅT DET HÄR HÅLLET. Första försöket letade efter vilket set
 *    sidan nämner och jämförde med vårt — och blev nästan bara falska positiva, av två
 *    skäl som båda är egenskaper hos VÅR setlista, inte hos butikerna:
 *      · era-namnen ÄR set hos oss ("Scarlet & Violet", "Sword & Shield"), och de står
 *        som prefix i nästan varje modern butikstitel. Längsta träffen blev alltså eran,
 *        aldrig det verkliga setet.
 *      · setnamn kortare än fyra tecken filtrerades bort → "151" hittades ALDRIG, och
 *        varje 151-produkt flaggades som fel.
 *      · setnamn med kod i parentes ("Silver Lance (S6H)") matchar aldrig en butikstitel
 *        som skriver "Silver Lance Booster Pack".
 *
 * Att i stället fråga "står vårt set på sidan?" kräver bara att VI känner vårt eget set,
 * och det gör vi exakt. Setkoden räknas som omnämnande — butikerna skriver ofta bara den
 * ("- sv6", "(s6K)"), och det är tillverkarens egen identifierare.
 */
function mentionsOurSet(pageTitle: string, setName: string): boolean {
  const page = ` ${normalizeTitle(pageTitle)} `;
  const paren = setName.match(/\(([^)]+)\)/)?.[1] ?? null;
  const bare = normalizeTitle(setName.replace(/\s*\([^)]*\)\s*/g, " ")).trim();
  if (bare && page.includes(` ${bare} `)) return true;
  // Setkoden, t.ex. "S6H" i "Silver Lance (S6H)" — butikerna skriver den ofta ensam.
  if (paren) {
    const code = normalizeTitle(paren).trim();
    if (code && page.includes(` ${code} `)) return true;
    if (code && page.includes(`${code} `)) return true;
  }
  // Setnamn utan mellanslag ("151") kan sitta ihop med skiljetecken i titeln.
  if (bare && !bare.includes(" ") && new RegExp(`(^|[^a-z0-9])${bare}([^a-z0-9]|$)`).test(page)) return true;
  return false;
}

const VERIFY = process.argv.includes("--verify");
const ALL = process.argv.includes("--all"); // verifiera ALLA butikslänkar, inte bara pris-avvikare
const CSV = process.argv.includes("--csv");
const LIMIT = Number(process.argv.find((a) => a.startsWith("--limit="))?.split("=")[1] ?? 400);
const MIN_RATIO = Number(process.argv.find((a) => a.startsWith("--min-ratio="))?.split("=")[1] ?? 0.15);

/** Källor som ÄR prisfacit — de granskas inte mot sig själva. */
const REFERENCE_SOURCES = ["Cardmarket", "CardTrader", "Tradera sålt"];

/**
 * Vad säljer sidan? Läser i tur och ordning: Shopifys `.js` (exakt), JSON-LD `name`,
 * `og:title`, `<title>`. Generiskt med flit — vi har 34 butiker på sex plattformar och
 * en parser per butik vore sex gånger så mycket kod för samma svar.
 */
export function nameFromHtml(html: string): string | null {
  for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const walk = (v: unknown): string | null => {
        if (Array.isArray(v)) { for (const x of v) { const r = walk(x); if (r) return r; } return null; }
        if (v && typeof v === "object") {
          const o = v as Record<string, unknown>;
          if (String(o["@type"] ?? "").toLowerCase() === "product" && typeof o.name === "string") return o.name;
          for (const x of Object.values(o)) { const r = walk(x); if (r) return r; }
        }
        return null;
      };
      const n = walk(JSON.parse(m[1]));
      if (n) return n;
    } catch { /* trasig LD — fortsätt */ }
  }
  const og = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i);
  if (og) return og[1];
  const t = html.match(/<title[^>]*>([\s\S]{0,200}?)<\/title>/i);
  return t ? t[1].trim() : null;
}

const CACHE_FILE = process.env.LINK_AUDIT_CACHE ?? ".link-audit-cache.json";
const nameCache: Record<string, string | null> = existsSync(CACHE_FILE)
  ? JSON.parse(readFileSync(CACHE_FILE, "utf8"))
  : {};
let cacheDirty = 0;

async function pageName(url: string): Promise<string | null> {
  // Hämtningen är hela kostnaden (~1 s/sida × ~2 900). Cachen gör att en ÄNDRAD
  // bedömningsregel kan köras om gratis — och det behövdes: första regeln gav för
  // många falska positiva och måste räknas om på samma underlag.
  if (url in nameCache) return nameCache[url];
  const n = await fetchPageName(url);
  nameCache[url] = n;
  if (++cacheDirty % 25 === 0) writeFileSync(CACHE_FILE, JSON.stringify(nameCache));
  return n;
}

async function fetchPageName(url: string): Promise<string | null> {
  try {
    // Shopify: `.js` ger den exakta produkttiteln utan HTML-tolkning.
    const shop = url.match(/^(https?:\/\/[^/]+)\/products\/([^/?#]+)/);
    if (shop) {
      const r = await politeFetch(`${shop[1]}/products/${shop[2]}.js`, { delayMs: 900, retries: 1 });
      if (r.ok) {
        const j = (await r.json()) as { title?: string };
        if (j.title) return j.title;
      }
    }
    const r = await politeFetch(url, { delayMs: 900, retries: 1 });
    if (!r.ok) return null;
    return nameFromHtml((await r.text()).slice(0, 300000));
  } catch {
    return null;
  }
}

/**
 * Butikens `<title>` är sällan bara produktnamnet.
 *
 * MÄTT på sveparet: Swepoke skriver "Stellar Crown Booster Pack - Köp Online - Swepoke AB
 * | Allt inom Pokémon TCG och samlarkort |", Webhallen "… - Samlarkortspel | Webhallen".
 * Boilerplaten drar ner likheten mot vår korta katalogtitel och gjorde HELT KORREKTA
 * länkar till "FEL". Vi klipper därför vid den första avgränsaren och behåller den del
 * som liknar ett produktnamn.
 */
export function stripStoreBoilerplate(name: string): string {
  let t = name;
  for (const sep of [" | ", " – Köp", " - Köp", " – Buy", " - Buy", " — "]) {
    const i = t.indexOf(sep);
    if (i > 8) t = t.slice(0, i);
  }
  // "… - Samlarkortspel", "… - Köp online!" i svansen.
  t = t.replace(/\s*[-–—]\s*(köp\s*online!?|samlarkortspel|pokémon tcg|tcg)\s*$/i, "");
  return t.trim();
}

async function main() {
  const products = await prisma.product.findMany({
    where: { cardId: null, category: { notIn: [...SEALED_CATEGORY_EXCLUSIONS] } },
    select: {
      id: true, title: true, slug: true, category: true, setId: true,
      set: { select: { id: true, name: true } },
      offers: { select: { id: true, url: true, price: true, retailer: { select: { name: true } } } },
    },
  });

  type Suspect = {
    productTitle: string; slug: string; retailer: string; url: string;
    price: number; cmPrice: number; ratio: number; offerId: string;
    setId: string | null; setName: string | null;
  };
  const suspects: Suspect[] = [];
  let checked = 0;

  for (const p of products) {
    const cm = p.offers.find((o) => o.retailer.name === "Cardmarket" && o.price && o.price > 0);
    for (const o of p.offers) {
      if (REFERENCE_SOURCES.includes(o.retailer.name)) continue;
      // Tradera är en MARKNADSPLATS: annonstiteln är säljarens egen prosa, inte butikens
      // produktnamn, och sidorna är dessutom kortlivade. Titelprövningen hör inte hemma
      // där — den vägen har sin egen vaktkedja i tradera-sweep.
      if (o.retailer.name === "Tradera") continue;
      if (!ALL && (!cm?.price || !o.price || o.price <= 0)) continue;
      checked++;
      const ratio = cm?.price && o.price ? o.price / cm.price : NaN;
      if (!ALL && ratio >= MIN_RATIO) continue;
      suspects.push({
        productTitle: p.title, slug: p.slug, retailer: o.retailer.name, url: o.url,
        price: o.price ?? 0, cmPrice: cm?.price ?? 0, ratio, offerId: o.id,
        setId: p.setId, setName: p.set?.name ?? null,
      });
    }
  }
  suspects.sort((a, b) => (Number.isFinite(a.ratio) ? a.ratio : 9) - (Number.isFinite(b.ratio) ? b.ratio : 9));

  console.log(`Butikslänkar med Cardmarket-facit: ${checked}`);
  console.log(`Misstänkta (under ${(MIN_RATIO * 100).toFixed(0)} % av CM-priset): ${suspects.length}\n`);

  const kr = (o: number) => (o / 100).toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, " ") + " kr";



  if (!VERIFY) {
    for (const s of suspects.slice(0, 80)) {
      console.log(`${(s.ratio * 100).toFixed(1).padStart(5)} %  ${s.retailer.padEnd(16)} ${kr(s.price).padStart(10)} mot CM ${kr(s.cmPrice)}`);
      console.log(`         produkt: ${s.productTitle}`);
      console.log(`         länk:    ${s.url}`);
    }
    console.log(`\nKör med --verify för att hämta sidorna och avgöra vad de FAKTISKT säljer.`);
    return;
  }

  console.log(`Verifierar upp till ${LIMIT} sidor …\n`);
  // ⛔ ETT NAMN SOM ÅTERKOMMER PÅ MÅNGA URL:er ÄR INGET PRODUKTNAMN. Goblinen svarade
  //    med butikens STARTSIDA ("Röda Goblinens Spelbutik | Kortspel – Rollspel …") för
  //    varje sida vi bad om, och en misslyckad hämtning som ser ut som en titel blev
  //    "FEL LÄNK" på fullt korrekta länkar. Cachen gör upptäckten självvaliderande:
  //    räkna hur många olika URL:er som gav exakt samma namn per värd.
  const nameCount = new Map<string, number>();
  for (const [u, n] of Object.entries(nameCache)) {
    if (!n) continue;
    try { nameCount.set(`${new URL(u).host}|${n}`, (nameCount.get(`${new URL(u).host}|${n}`) ?? 0) + 1); } catch { /* ignorera */ }
  }
  const isBoilerplate = (url: string, n: string) => {
    try { return (nameCount.get(`${new URL(url).host}|${n}`) ?? 0) >= 3; } catch { return false; }
  };

  const rows: string[] = [];
  let wrong = 0, ok = 0, unknown = 0, boiler = 0;
  for (const s of suspects.slice(0, LIMIT)) {
    const name = await pageName(s.url);
    if (!name) {
      unknown++;
      console.log(`?  OKÄND SIDA   ${s.retailer.padEnd(16)} ${s.url}`);
      continue;
    }
    if (isBoilerplate(s.url, name)) {
      boiler++;
      continue; // butikens standardtitel = misslyckad hämtning, inte ett omdöme
    }
    const clean = cleanListingTitle(stripStoreBoilerplate(name));
    const sim = scoreSimilarity(normalizeTitle(clean), normalizeTitle(s.productTitle));
    const conflict = productsConflict(clean, normalizeTitle(s.productTitle));
    // OBEROENDE PRÖVNING: nämner sidan VÅRT set? Gör den inte det, och priset dessutom
    // är en bråkdel av facit, pekar två oberoende signaler åt samma håll.
    const setMissing = s.setName != null && !mentionsOurSet(clean, s.setName);
    const priceOff = Number.isFinite(s.ratio) && s.ratio < 0.5;
    const verdict =
      (setMissing && priceOff) || conflict || sim < 0.45 ? "FEL"
      : setMissing || sim < 0.72 ? "TVEKSAM"
      : "OK";
    if (verdict === "FEL") wrong++; else if (verdict === "OK") ok++; else unknown++;
    if (verdict !== "OK") {
      console.log(`${verdict === "FEL" ? "✗ FEL LÄNK  " : "~ TVEKSAM   "} ${s.retailer.padEnd(16)} ${Number.isFinite(s.ratio) ? (s.ratio * 100).toFixed(1) + ' % av CM' : 'inget CM-facit'}  (likhet ${sim.toFixed(2)}${conflict ? ", konflikt" : ""}${setMissing ? `, sidan nämner INTE vårt set "${s.setName}"` : ""}${priceOff ? `, ${(s.ratio*100).toFixed(0)} % av CM` : ""})`);
      console.log(`     vår produkt: ${s.productTitle}`);
      console.log(`     sidan säljer: ${name}`);
      console.log(`     ${s.url}`);
      rows.push([s.offerId, verdict, s.retailer, s.slug, s.productTitle, name, s.url].join(";"));
    }
  }
  console.log(`\nVerifierade ${Math.min(suspects.length, LIMIT)}: ${wrong} FEL, ${unknown} okända/tveksamma, ${ok} bekräftat rätt, ${boiler} hoppade (butikens standardtitel).`);
  if (CSV && rows.length) {
    console.log(`\nofferId;verdikt;butik;slug;varProdukt;sidanSaljer;url`);
    for (const r of rows) console.log(r);
  }
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(async () => { await prisma.$disconnect(); process.exit(process.exitCode ?? 0); });
