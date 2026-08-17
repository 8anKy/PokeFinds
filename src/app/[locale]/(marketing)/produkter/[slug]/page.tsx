import type { Metadata } from "next";
import { alternatesFor, baseOpenGraph, localeUrl } from "@/lib/canonical";
import { routing } from "@/i18n/routing";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { formatPrice } from "@/lib/format";
import { getProductBySlug, loadProductDetail } from "@/services/products";
import { CATEGORY_LABELS } from "@/components/features/product-card";
import { ProductDetailView } from "@/components/features/product-detail-view";

// Produktsidan läser inte längre URL-param (perioden filtreras i klienten) eller
// session → den kan ISR-cachas. Live-priser/offers uppdateras ändå klient-sida via
// polling. Sparar Vercel CPU + Neon på den största crawl-ytan (~20k produktsidor).
export const revalidate = 3600;

// Tom lista → inget prerenderas vid build (undvik ~20k renders); varje slug
// genereras on-demand vid första besök och cachas sedan (ISR). KRÄVS för cache:
// utan generateStaticParams renderas dynamiska segment dynamiskt per request
// (no-store) trots `revalidate`.
export async function generateStaticParams() {
  return [];
}

interface PageProps {
  params: { locale: string; slug: string };
}

async function loadProduct(slug: string) {
  try {
    return await getProductBySlug(slug);
  } catch {
    return null;
  }
}

/** Google klipper meta-beskrivningen runt 155 tecken i SERP:en. */
const META_DESCRIPTION_MAX = 155;

/**
 * Klipper vid ORDGRÄNS, aldrig mitt i ett ord. Produktbeskrivningarna i katalogen
 * är butiks-/leverantörstext på flera hundra tecken; oklippt blev SERP-raden en
 * mening som slutar tvärt mitt i ett ord ("… Elite Trainer Box innehåll"), vilket
 * läser som trasig data snarare än som en avsiktlig sammanfattning.
 */
function truncateMeta(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= META_DESCRIPTION_MAX) return clean;
  const cut = clean.slice(0, META_DESCRIPTION_MAX);
  const lastSpace = cut.lastIndexOf(" ");
  // Hård klippning bara om FÖRSTA ordet självt är längre än taket — annars hade
  // en beskrivning utan mellanslag gett en tom sträng.
  const kept = lastSpace > 0 ? cut.slice(0, lastSpace) : cut;
  return `${kept.replace(/[\s.,;:–—-]+$/, "")}…`;
}

/**
 * ⛔ 0 ÖRE ÄR INGET PRIS (samma invariant som `priceOreFromEur`). Produktsidans
 * `stats.lowestPrice` filtrerar bara bort `null`, INTE nollor — till skillnad från
 * `computeLowestPrice`, som katalogen och `generateMetadata` går via. Utan den här
 * grinden hade de två vägarna kunnat säga olika saker om samma produkt, och en nolla
 * hade nått maskinläsbar utdata där "0 kr" läses som "gratis".
 */
function hasRealPrice(ore: number | null | undefined): ore is number {
  return ore != null && ore > 0;
}

/**
 * Sidans beskrivning — EN definition, TVÅ konsumenter: `<meta name="description">`
 * och Product-nodens `description` i JSON-LD. Skrivs de var för sig glider de isär,
 * och Google jämför dem (strukturerad data som motsäger sidan tappar rich result).
 *
 * ⛔ GRENEN UTAN PRIS FINNS FÖR ATT "–" LÄCKTE UT I SERP:EN: `formatPrice(null)`
 * returnerar "–" med flit i gränssnittet, men mallen bakar in den i en mening
 * ("Lägsta pris just nu: –.") och ~868 singlar + ~24 sealed saknar genuint
 * CM-marknadsdata. Beskrivningen i sökresultatet blev alltså en halv mening om ett
 * pris som inte finns. Utan pris utelämnas påståendet helt i stället.
 *
 * Ingen DB-kostnad: `getTranslations` läser meddelandena som redan lästs för
 * requesten, och locale skickas EXPLICIT — utan den läser next-intl request-scopet
 * (headers) och sidan blir dynamisk, vilket river ISR-cachen på ~20k URL:er.
 */
async function describeProduct(
  locale: string,
  p: { description: string | null; title: string; category: string; lowestPrice: number | null }
): Promise<string> {
  const t = await getTranslations({ locale, namespace: "Detail" });
  const tCat = await getTranslations({ locale, namespace: "Category" });
  if (p.description) return truncateMeta(p.description);
  const categoryLabel = p.category in CATEGORY_LABELS ? tCat(p.category) : t("fallbackCategory");
  return hasRealPrice(p.lowestPrice)
    ? t("metaDescription", {
        title: p.title,
        category: categoryLabel,
        price: formatPrice(p.lowestPrice),
      })
    : t("metaDescriptionNoPrice", { title: p.title, category: categoryLabel });
}

/**
 * Absolut URL för en katalogbild. JSON-LD kräver en giltig URI — en relativ sträng
 * är ogiltig där, och `metadataBase` absolutiserar BARA Next egna metadata-fält
 * (OpenGraph-kopian), aldrig den handbyggda JSON-LD-strängen.
 *
 * ⛔ SPRÅKPREFIX FÅR INTE PÅ: Cardmarket-bilder lagras som `/api/cm-image/{id}`
 * (`cmImageProxyUrl`) och `/api/*` ligger UTANFÖR `[locale]`-segmentet — en
 * `/en`-prefixad bild-URL hade 404:at för hela den engelska katalogen. Därför
 * `routing.defaultLocale` (= sv, tomt prefix) → ren origin + väg.
 * ⚠️ pokemontcg.io-bilder är redan absoluta (`https://images.pokemontcg.io/…`) och
 * måste lämnas orörda; protokoll-relativa `//host/…` räknas också som absoluta.
 */
function absoluteImageUrl(url: string | null): string | undefined {
  if (!url) return undefined;
  if (/^(https?:)?\/\//i.test(url)) return url;
  return localeUrl(routing.defaultLocale, url);
}

// <-escapen: JSON.stringify escapar inte "<", så en produkttitel med "</script>"
// skulle annars bryta sig ut ur script-taggen.
const ldJson = (node: unknown) => JSON.stringify(node).replace(/</g, "\\u003c");

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const t = await getTranslations({ locale: params.locale, namespace: "Detail" });
  const product = await loadProduct(params.slug);
  if (!product) return { title: t("metaNotFound") };
  const description = await describeProduct(params.locale, {
    description: product.description,
    title: product.title,
    category: product.category,
    lowestPrice: product.lowestPrice,
  });
  return {
    title: product.title,
    description,
    alternates: alternatesFor(params.locale, `/produkter/${params.slug}`),
    openGraph: {
      // ⛔ NEXTS METADATA-MERGE ÄR GRUND PER TOPPFÄLT: hela `openGraph` från
      // rot-layouten ERSÄTTS av det här objektet, det slås inte ihop fält för fält.
      // Utan spreaden tappade sajtens ~20k mest delade URL:er `og:type`,
      // `og:site_name` och `og:locale` — tyst, för taggarna som blev kvar såg
      // korrekta ut. Basen bor i canonical.ts så nästa sida ärver den utan att
      // någon behöver minnas varför.
      ...baseOpenGraph(params.locale),
      title: product.title,
      description,
      // ⛔ NYCKELN UTELÄMNAS HELT när produkten saknar bild: ett utskrivet
      // `images: undefined` VINNER över spreaden och hade tagit bort basbilden
      // också, dvs delning utan förhandsvisning i stället för med logotypen.
      ...(product.imageUrl ? { images: [product.imageUrl] } : {}),
    },
  };
}

export default async function ProductPage({ params }: PageProps) {
  const data = await loadProductDetail(params.slug);
  if (!data) notFound();

  const t = await getTranslations({ locale: params.locale, namespace: "Detail" });
  const productUrl = localeUrl(params.locale, `/produkter/${params.slug}`);
  const description = await describeProduct(params.locale, {
    description: data.description,
    title: data.title,
    category: data.category,
    lowestPrice: data.stats.lowestPrice,
  });

  const low = data.stats.lowestPrice;
  const high = data.stats.highestPrice;
  // ⛔ RÄKNA BARA DE OFFERS SPANNET FAKTISKT REPRESENTERAR. `data.offerCount` (och
  // `data.stats.offerCount`) räknar ALLA direkta offers, även de prislösa — en
  // direktlänk utan pris visas med flit som "–" i tabellen, men i en AggregateOffer
  // blir den ett påstående om ett erbjudande som saknar belopp. `serializedOffers`
  // är samma redan hämtade rader; ingen extra DB-fråga.
  // ⛔ `data.stats.offerCount` lämnas ORÖRD: den är ett delat API-kontrakt med
  // /api/products/[slug]/offers och styr tabellens rubrik.
  const pricedOfferCount = data.serializedOffers.filter((o) => hasRealPrice(o.price)).length;

  // ⛔ VARUMÄRKET PÅSTÅS BARA DÄR KATEGORIN BEVISAR DET. Kortformerna (singlar,
  // boosters, ETB, tins, graderat …) ÄR Pokémon TCG per definition — men `ACCESSORY`
  // är tredjepartsTILLVERKARE (Ultra Pro, Dragon Shield, Gamegenic, Ultimate Guard —
  // se `ACCESSORY_BRANDS` i `src/scrapers/matching.ts`, som fäller dem vid import just
  // för att de inte tillverkar Pokémon-kort), och `OTHER` är den okategoriserade
  // resten. Båda är gömda ur BLÄDDRINGEN (`HIDDEN_CATEGORIES`), men produktsidan
  // grindas aldrig på gömflaggan (Discord-embeddar måste svara) och sitemapen
  // filtrerar på just den flaggan, inte på kategori — de sidorna når alltså Google.
  // Ett generellt `brand: "Pokémon"` hade därför blivit ett FABRICERAT påstående i
  // maskinläsbar data om just de raderna; samma regel som förbjuder påhittat
  // `aggregateRating` nedan.
  // ⚠️ Kolumnnamnet står med FLIT inte utskrivet här: `product-hidden-sync.test.ts`
  // vaktar att den här filen inte nämner det alls, eftersom en grind på gömflaggan
  // hade tystat Discord-embeddarna. Vakten läser källTEXTEN och kan inte skilja en
  // kommentar från en kodrad — skriv inte tillbaka namnet.
  const brandIsPokemon = data.category !== "ACCESSORY" && data.category !== "OTHER";

  // ⛔ INGEN Product-nod UTAN `offers`. Google avvisar noden helt ("Either offers,
  // review, or aggregateRating should be specified") och katalogen har ~868 singlar
  // + ~24 sealed som genuint saknar marknadsdata — de skickade alltså en ogiltig nod
  // på varje rendering. ⛔ Tysta ALDRIG varningen med ett påhittat `aggregateRating`
  // eller `review`: vi har inga omdömen, och fabricerad strukturerad data är
  // manuell åtgärd i Search Console.
  //
  // `highPrice` är max över ALLA prissatta direkta offers, medan `lowPrice` är min över
  // en DELMÄNGD av dem (bara de i lager, när sådana finns — se `lowestPool` i
  // `loadProductDetailRaw`). Max över en övermängd kan aldrig understiga min över en
  // delmängd, så `high >= low > 0` följer av grinden — nollgrinden behöver därför bara
  // ställas på lägstapriset.
  const productLd =
    hasRealPrice(low) && high != null
      ? {
          "@context": "https://schema.org",
          "@type": "Product",
          // Sidan är sin egen identitet — och den är SPRÅKBUNDEN: /en-varianten måste
          // annonsera /en-URL:en, annars pekar båda språkversionerna på samma nod och
          // Google kan inte hålla isär dem (samma skäl som hreflang i `alternatesFor`).
          "@id": productUrl,
          url: productUrl,
          name: data.title,
          description,
          image: absoluteImageUrl(data.imageUrl),
          // Varumärket är produktdata, inte en gissning — se `brandIsPokemon` ovan för
          // de två kategorier där påståendet INTE är sant.
          ...(brandIsPokemon ? { brand: { "@type": "Brand", name: "Pokémon" } } : {}),
          offers: {
            "@type": "AggregateOffer",
            priceCurrency: "SEK",
            lowPrice: (low / 100).toFixed(2),
            highPrice: (high / 100).toFixed(2),
            offerCount: pricedOfferCount,
            availability:
              data.stats.lowestPriceStockStatus === "IN_STOCK"
                ? "https://schema.org/InStock"
                : "https://schema.org/OutOfStock",
          },
        }
      : null;

  // Brödsmulorna som STRUKTURERAD DATA. Google ritar dem i SERP:en i stället för
  // den nakna URL:en, vilket är det enda rich result den här sidtypen kan få när
  // produkten saknar pris.
  //
  // ⛔ MITTENSMULAN PEKAR PÅ `/sets/<id>`, INTE PÅ `/produkter?set=<id>`, OCH SKÄLET
  //    ÄR KOSTNAD. Samma ägarbeslut som redan står nerskrivet i
  //    `src/lib/restock-feed-events.ts` (reservlänken i Discord-embedden): `/produkter`
  //    är `force-dynamic` med flit (searchParams), så varje klick blir en
  //    serverrendering med DB-frågor — en Neon-väckning som debiteras minst 300 s.
  //    Den URL-rymden är dessutom blockerad i robots.txt, dvs medvetet inte en
  //    delbar/indexerbar väg. `/sets/[id]` är ISR-cachad (`revalidate = 3600`) och
  //    serveras ur cachen.
  // ⚠️ ÄRLIGT NOTERAT: den SYNLIGA brödsmulan länkar fortfarande till katalogen med
  //    setfiltret (ägarbeslut 2026-08-09 — från en produkt vill man tillbaka till
  //    listan man bläddrade i). Uppmärkningen namnger alltså en ANNAN URL än länken
  //    på sidan, med samma etikett: setets kanoniska, indexerbara sida. Inget syns
  //    för användaren, och Googles krav är att smulan motsvarar sidans placering i
  //    hierarkin — inte att den är byte-identisk med `href`.
  const crumbs = [
    { name: t("products"), url: localeUrl(params.locale, "/produkter") },
    ...(data.set
      ? [
          {
            name: data.set.name,
            url: localeUrl(params.locale, `/sets/${encodeURIComponent(data.set.id)}`),
          },
        ]
      : []),
    { name: data.title, url: productUrl },
  ];
  const breadcrumbLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: crumbs.map((c, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: c.name,
      item: c.url,
    })),
  };

  return (
    <>
      {productLd && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: ldJson(productLd) }}
        />
      )}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: ldJson(breadcrumbLd) }}
      />
      <ProductDetailView data={data} showBack />
    </>
  );
}
