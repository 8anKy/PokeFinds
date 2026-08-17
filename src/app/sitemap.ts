import type { MetadataRoute } from "next";
import { cachedRead, STATIC_CACHE_TAG } from "@/lib/cache";
import { prisma } from "@/lib/db";
import { NOT_HIDDEN } from "@/lib/product-visibility";

// `||`, inte `??`: en saknad variabel expanderas till TOM STRÄNG (GitHub Actions,
// och en tom Railway-variabel beter sig likadant), och `"" ?? x` ger `""` — reserven
// hade aldrig använts och varje URL i sitemapen blivit relativ (`/produkter/…`),
// vilket är ogiltigt i en sitemap. Reserven är prod-apex, inte localhost: en sitemap
// full av localhost-URL:er är värdelös, och apex är kanonisk sedan 2026-08-14.
const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || "https://foilio.se";

// Generera vid förfrågan, INTE vid build — annars kör en DB-fråga mot Neon under
// `next build` och en långsam/hängande anslutning fryser hela bygget.
//
// ⚠️ `force-dynamic` gäller RENDERINGEN, inte datat: själva uppslaget går genom
// `cachedRead` nedan, så en crawler-träff kostar noll Neon-frågor inom TTL-fönstret.
export const dynamic = "force-dynamic";

/** Avbryter ett löfte efter `ms` så att en hängande DB-anslutning aldrig låser. */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error("timeout")), ms)),
  ]);
}

/**
 * Katalogens URL:er. VARFÖR CACHAD (2026-08-05): rutten är `force-dynamic`, så VARJE
 * crawler-träff körde `product.findMany({ take: 40000, orderBy: viewCount })` +
 * `cardSet.findMany({ take: 1000 })` mot Neon — två fullskanningar som väckte computen
 * och drog ~2-3 MB egress per hämtning. Googlebot/Bingbot/AI-crawlers hämtar sitemapen
 * flera gånger om dygnet.
 *
 * 24h TTL matchar `changeFrequency: "weekly"` nedan — en sitemap som är ett dygn gammal
 * är per definition färsk nog för det löftet. (Samma dygn ligger numera även i
 * `Cache-Control` på svaret, se `headers()` i next.config.mjs.)
 *
 * ⛔ EGEN TAGG, inte PRICE_CACHE_TAG: sitemapen innehåller inga priser, och prisjobbens
 * `/api/revalidate` hade annars slängt den 3-4 ggr/dygn — dvs cachen hade aldrig levt
 * ut sitt dygn.
 *
 * Returnerar RENA STRÄNGAR (slug resp. set-id). Tidsstämplarna som låg här förr är
 * borttagna med flit — se `lastmod`-noten i `sitemap()` nedan.
 */
const getSitemapRows = cachedRead(
  async (): Promise<{ products: string[]; sets: string[] }> => {
    const [products, sets] = await Promise.all([
      prisma.product.findMany({
        // ⛔ Ägarens bortgömda produkter annonseras inte för crawlers. Sidorna SVARAR
        //    fortfarande på en direkt träff — Discord-embeddens produktlänk måste
        //    fungera — de ligger bara inte längre i sitemapen.
        where: { ...NOT_HIDDEN },
        select: { slug: true },
        orderBy: { viewCount: "desc" },
        // Hela katalogen (long-tail-SEO är sajtens poäng); sitemap-taket är 50k URL:er.
        take: 40000,
      }),
      prisma.cardSet.findMany({
        // ⛔ BARA set som faktiskt har något att visa. Ett set utan synliga produkter
        //    renderar en `EmptyState` (se sets/[id]/page.tsx) och länkas inte från
        //    någonstans i sajten — den var alltså en ren sitemap-URL, en sida vi
        //    själva bjöd in Google att crawla och som Google sedan klassar som
        //    "Crawled – currently not indexed". Varje sådan hämtning är dessutom en
        //    dynamisk render som väcker Neon för att visa ingenting.
        //    Filtret speglar produktfrågan ovan: gömda produkter räknas inte som
        //    innehåll (annars hade ett set vars enda produkter ägaren gömt levt kvar).
        //
        // ⛔ INTE `language: "EN"`. Katalogen säljer japanska singlar på riktigt och de
        //    set-sidorna har äkta innehåll — språket är ingen kvalitetssignal här.
        where: { products: { some: { ...NOT_HIDDEN } } },
        select: { id: true },
        take: 1000,
      }),
    ]);
    return {
      products: products.map((p) => p.slug),
      sets: sets.map((s) => s.id),
    };
  },
  "sitemapRows",
  86400,
  [STATIC_CACHE_TAG]
);

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  // ⛔ `/` står INTE med: den omdirigerar till /produkter sedan startsidan togs bort
  // (2026-08-06), och en omdirigerande URL i en sitemap rapporteras av Search Console
  // som ett fel ("Page with redirect") i stället för att indexeras. Målet listas i
  // stället som sajtens viktigaste sida.
  //
  // ⛔ `/community` står INTE med, och det är ett aktivt val: sidan är i dag en
  // "Snart här"-platshållare på ~140 tecken. En sitemap är en INBJUDAN — att självmant
  // peka ut en tunn stubbe ger den klassningen "Crawled – currently not indexed", och
  // den stämpeln sitter kvar på URL:en långt efter att sidan fått innehåll. Lägg in
  // den samma dag community-flödet går live, inte tidigare.
  const staticRoutes: MetadataRoute.Sitemap = [
    { url: `${BASE_URL}/produkter`, changeFrequency: "hourly", priority: 1 },
    { url: `${BASE_URL}/marknad`, changeFrequency: "hourly", priority: 0.8 },
    { url: `${BASE_URL}/sets`, changeFrequency: "weekly", priority: 0.7 },
    { url: `${BASE_URL}/priser`, changeFrequency: "monthly", priority: 0.6 },
    // Discord-landningssidan: egen ingång för "foilio discord"-sökningar och den enda
    // publika beskrivningen av restock-kanalerna. Ändras när kanalutbudet ändras.
    { url: `${BASE_URL}/discord`, changeFrequency: "monthly", priority: 0.5 },
    // Varumärkessidan. Den var indexerbar och länkad ur sidfoten men saknades här —
    // och just "vem är Foilio" är den sida ett varumärkessök vill landa på.
    { url: `${BASE_URL}/om`, changeFrequency: "monthly", priority: 0.4 },
    { url: `${BASE_URL}/kontakt`, changeFrequency: "yearly", priority: 0.3 },
    // Samma klass som villkor/integritetspolicy: finns för att den MÅSTE gå att hitta.
    { url: `${BASE_URL}/cookies`, changeFrequency: "yearly", priority: 0.2 },
    { url: `${BASE_URL}/villkor`, changeFrequency: "yearly", priority: 0.2 },
    { url: `${BASE_URL}/integritetspolicy`, changeFrequency: "yearly", priority: 0.2 },
  ];

  let products: string[] = [];
  let sets: string[] = [];
  try {
    ({ products, sets } = await withTimeout(getSitemapRows(), 8000));
  } catch {
    // DB ej tillgänglig eller långsam — returnera bara de statiska rutterna.
    return staticRoutes;
  }

  // "weekly", inte "daily": daily fick Google att omcrawla tiotusentals produkt-
  // sidor per dygn → varje träff efter ISR-TTL = en DB-render på Neon. Priserna i
  // sök-snippets tål en veckas lagg; själva sidan är alltid ≤1h gammal vid besök.
  //
  // ⛔ INGEN `lastModified` (mätt 2026-08-17). `Product.updatedAt` är `@updatedAt`, dvs
  // den stämplas av VARJE Prisma-skrivning — och nästan ingen av våra skrivningar är en
  // innehållsändring:
  //   · `refreshPopularityScores()` (services/market.ts) nollställer `viewCount` på hela
  //     katalogen en gång per dygn och skriver sedan tillbaka nya poäng. Tiotusentals
  //     produkter får ny `updatedAt` varje natt utan att en enda synlig rad ändrats.
  //   · `tradera-sweep.ts` stämplar `traderaCheckedAt` på varje svept batch — bokföring
  //     om att vi TITTAT, inte om att något hänt.
  // Och den skrivning som FAKTISKT ändrar sidan går FÖRBI kolumnen:
  // `recomputeProductPriceCache()` (services/products.ts) sätter `lowestPriceOre` med
  // `$executeRawUnsafe`, och rå SQL passerar aldrig klienten som fyrar `@updatedAt`.
  // Priset är det enda som rör sig på en produktsida på veckor. Nettot: `updatedAt` är
  // ANTI-korrelerad med verklig förändring — den lyser upp när inget hänt och står
  // still när något hänt. `CardSet.updatedAt` har samma problem (etikett-/CM-jobben
  // stämplar den; innehållet är produkterna).
  //
  // ⛔ INGEN ANNAN KOLUMN DUGER SOM ERSÄTTNING. `lowestPriceOre` har ingen tidsstämpel,
  // `Offer.lastSeenAt` betyder "sedd", inte "ändrad", och `PriceSnapshot` finns bara för
  // CM-mappade produkter. Att härleda en per rad vore dessutom en NY aggregerande fråga
  // över 40 000 produkter — precis den kostnad cachen ovan byggdes för att slippa.
  //
  // ⛔ DÄRFÖR TAS FÄLTET BORT HELT i stället för att "förbättras": `lastmod` är den
  // post-nivå-signal Google faktiskt väger, och den väger den bara så länge den är
  // trovärdig. Ett `lastmod` som säger "ändrad i natt" om 20 000 oförändrade sidor lär
  // Google att strunta i fältet för HELA sajten — och lockar under tiden fram omcrawl
  // av sidor som inte ändrats, dvs Neon-väckningar vi betalar för utan att få något.
  // Utan fältet crawlar Google efter sina egna signaler, vilket är vad vi vill. En falsk
  // färskhetsuppgift är strikt sämre än ingen uppgift alls.
  const productRoutes: MetadataRoute.Sitemap = products.map((slug) => ({
    url: `${BASE_URL}/produkter/${slug}`,
    changeFrequency: "weekly",
    priority: 0.7,
  }));

  const setRoutes: MetadataRoute.Sitemap = sets.map((id) => ({
    url: `${BASE_URL}/sets/${id}`,
    changeFrequency: "weekly",
    priority: 0.5,
  }));

  return [...staticRoutes, ...productRoutes, ...setRoutes];
}
