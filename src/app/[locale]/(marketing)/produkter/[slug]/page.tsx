import type { Metadata } from "next";
import { alternatesFor, baseOpenGraph, localeUrl } from "@/lib/canonical";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { loadProductShell, PRODUCT_PAGE_REVALIDATE_SECONDS } from "@/services/products";
import { CATEGORY_LABELS } from "@/components/features/product-card";
import { ProductDetailView } from "@/components/features/product-detail-view";

// PRODUKTSIDAN ÄR ETT DB-FRITT SKAL SEDAN 2026-08-29. HTML:en bär namn, set, bild,
// kategori och brödsmulor — ALDRIG ett pris. Priser/offers/graf hämtar klienten
// själv vid montering (`/api/products/[slug]/detail`), och crawlers som kör JS
// hoppar över den hämtningen (`lib/crawler-ua.ts`). Därför kan sidan ISR-cachas i
// 30 dygn, på en volym som överlever deployer (`server/cache-handler.cjs`).
// VARFÖR: ~63 600 produktvägar × ett crawlersvep på 14–23 dygn mot 1 h TTL gav
// träffkvot ≈ 0 — nästan varje träff en kall rendering, och det höll Neon vaken
// ~19 h/dygn (mätt 2026-08-26). Nu: en rendering per sida per 30 dygn.
// ⛔ Ruttens revalidate är MIN av det här talet och alla cachade läsningar i
// renderingen. Importera ALDRIG `getProductBySlug`/`loadProductDetail` (1 h) hit —
// sidan blir tyst 1h-cachad igen. Vaktat av tests/unit/product-page-isr-ttl.test.ts.
export const revalidate = PRODUCT_PAGE_REVALIDATE_SECONDS;

// Tom lista → inget prerenderas vid build (undvik ~63k renders); varje slug
// genereras on-demand vid första besök och cachas sedan (ISR). KRÄVS för cache:
// utan generateStaticParams renderas dynamiska segment dynamiskt per request
// (no-store) trots `revalidate`.
export async function generateStaticParams() {
  return [];
}

interface PageProps {
  params: { locale: string; slug: string };
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
 * Sidans beskrivning — EN definition, TVÅ konsumenter: `<meta name="description">`
 * och Product-nodens `description` i JSON-LD.
 *
 * ⛔ INGET PRIS I BESKRIVNINGEN LÄNGRE: HTML:en cachas i 30 dygn och ett pris i
 * `<meta>` hade varit en lögn i SERP:en större delen av den tiden. Den prislösa
 * varianten var redan den ärliga grenen för ~890 produkter utan marknadsdata.
 *
 * Ingen DB-kostnad: `getTranslations` läser meddelandena som redan lästs för
 * requesten, och locale skickas EXPLICIT — utan den läser next-intl request-scopet
 * (headers) och sidan blir dynamisk, vilket river ISR-cachen på ~63k URL:er.
 */
async function describeProduct(
  locale: string,
  p: { description: string | null; title: string; category: string }
): Promise<string> {
  const t = await getTranslations({ locale, namespace: "Detail" });
  const tCat = await getTranslations({ locale, namespace: "Category" });
  if (p.description) return truncateMeta(p.description);
  const categoryLabel = p.category in CATEGORY_LABELS ? tCat(p.category) : t("fallbackCategory");
  return t("metaDescriptionNoPrice", { title: p.title, category: categoryLabel });
}

// <-escapen: JSON.stringify escapar inte "<", så en produkttitel med "</script>"
// skulle annars bryta sig ut ur script-taggen.
const ldJson = (node: unknown) => JSON.stringify(node).replace(/</g, "\\u003c");

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const t = await getTranslations({ locale: params.locale, namespace: "Detail" });
  const product = await loadProductShell(params.slug);
  // ⚠️ MJUK 404: en död slug svarar HTTP **200**, inte 404. Sidan renderar rätt
  // innehåll ("Produkten hittades inte" + `noindex`), men statuskoden är fel, och
  // svaret cachas (`s-maxage`). Katalogen döper om och slår ihop slugs som
  // rutinunderhåll, så varje pensionerad slug i en gammal sitemap-kopia hamnar
  // här — Search Console rapporterar "Soft 404" och crawl-budget går åt.
  //
  // ⛔ INGET AV DET UPPENBARA HJÄLPER — mätt 2026-08-17, sluta inte gissa vidare:
  //   · `notFound()` HÄR i `generateMetadata` i stället för i sidan → fortfarande 200.
  //   · `loading.tsx` bortflyttad (dvs ingen Suspense-gräns) → fortfarande 200, och
  //     den vanliga förklaringen "svaret har redan börjat strömma" är alltså INTE
  //     orsaken här.
  // Orsaken är ISR självt: rutten är statiskt genererad on demand (`revalidate` +
  // tom `generateStaticParams`), och den prerenderade posten bär ingen statuskod.
  // `/profil/[id]`, som är `force-dynamic`, svarar korrekt 404 — skillnaden är cachen.
  //
  // ⛔ DE ENDA KÄNDA FIXARNA KOSTAR MER ÄN FELET: `force-dynamic` river ISR:en (varje
  // träff = en Neon-väckning à minst 300 s — hela kostnadsdoktrinen), och
  // `dynamicParams: false` skulle 404:a ALLT eftersom `generateStaticParams` med flit
  // returnerar en tom lista. Skadan är dessutom begränsad: `noindex` ligger på sidan,
  // så det här är bortkastad crawl-budget och en varningsrad — aldrig indexerat skräp.
  // ⏭️ Testa om vid Next-uppgraderingen (se "Öppna ärenden" i CLAUDE.md).
  if (!product) return { title: t("metaNotFound") };
  const description = await describeProduct(params.locale, {
    description: product.description,
    title: product.title,
    category: product.category,
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
  const shell = await loadProductShell(params.slug);
  if (!shell) notFound();

  const t = await getTranslations({ locale: params.locale, namespace: "Detail" });
  const productUrl = localeUrl(params.locale, `/produkter/${params.slug}`);

  // ⛔ INGEN Product-NOD I JSON-LD LÄNGRE (2026-08-29). Google avvisar en Product
  // utan `offers`/`review`/`aggregateRating` ("Either offers, review, or
  // aggregateRating should be specified"), och priset finns inte i HTML:en längre —
  // ett `AggregateOffer` som cachas i 30 dygn hade varit ett påstående om ett pris
  // som inte gäller. ⛔ Tysta ALDRIG det med ett påhittat `aggregateRating` eller
  // `review`: vi har inga omdömen, och fabricerad strukturerad data är manuell
  // åtgärd i Search Console. Det rich result sidan kan få är brödsmulorna nedan;
  // pris-snippeten var ett delmål, inte skälet till sidan. Samma regel som förr
  // gäller om noden någon gång kommer tillbaka: `brand: "Pokémon"` bara utanför
  // ACCESSORY/OTHER (tredjepartstillverkare), och produktsidan grindas aldrig på
  // gömflaggan (Discord-embeddar måste svara — `product-hidden-sync.test.ts`
  // vaktar att kolumnnamnet inte ens nämns i den här filen).

  // Brödsmulorna som STRUKTURERAD DATA. Google ritar dem i SERP:en i stället för
  // den nakna URL:en, vilket är det enda rich result den här sidtypen kan få nu.
  //
  // ⛔ MITTENSMULAN PEKAR PÅ `/sets/<id>`, INTE PÅ `/produkter?set=<id>`, OCH SKÄLET
  //    ÄR KOSTNAD. Samma ägarbeslut som redan står nerskrivet i
  //    `src/lib/restock-feed-events.ts` (reservlänken i Discord-embedden): `/produkter`
  //    är `force-dynamic` med flit (searchParams), så varje klick blir en
  //    serverrendering med DB-frågor — en Neon-väckning som debiteras minst 300 s.
  //    Den URL-rymden är dessutom blockerad i robots.txt, dvs medvetet inte en
  //    delbar/indexerbar väg. `/sets/[id]` är ISR-cachad och serveras ur cachen.
  // ⚠️ ÄRLIGT NOTERAT: den SYNLIGA brödsmulan länkar fortfarande till katalogen med
  //    setfiltret (ägarbeslut 2026-08-09 — från en produkt vill man tillbaka till
  //    listan man bläddrade i). Uppmärkningen namnger alltså en ANNAN URL än länken
  //    på sidan, med samma etikett: setets kanoniska, indexerbara sida. Inget syns
  //    för användaren, och Googles krav är att smulan motsvarar sidans placering i
  //    hierarkin — inte att den är byte-identisk med `href`.
  const crumbs = [
    { name: t("products"), url: localeUrl(params.locale, "/produkter") },
    ...(shell.set
      ? [
          {
            name: shell.set.name,
            url: localeUrl(params.locale, `/sets/${encodeURIComponent(shell.set.id)}`),
          },
        ]
      : []),
    { name: shell.title, url: productUrl },
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
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: ldJson(breadcrumbLd) }}
      />
      {/* Mobil: logotyphuvudet döljs av SiteHeaderGate (rutten är en undersida) →
          vyns flytande bakåtcirkel är hela chrome:n, som i overlayn. */}
      <ProductDetailView shell={shell} context="page" />
    </>
  );
}
