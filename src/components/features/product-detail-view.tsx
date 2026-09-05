"use client";

/* eslint-disable @next/next/no-img-element */
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { track } from "@/lib/track";
import { formatPrice } from "@/lib/format";
import { cn } from "@/lib/utils";
import { isCrawlerClient } from "@/lib/crawler-ua";
import type { ProductDetailData, ProductShellData } from "@/services/products";
import { SafeImage } from "@/components/ui/safe-image";
import { Skeleton } from "@/components/ui/skeleton";
import { PriceChange } from "@/components/ui/price-change";
import { BackCircle } from "@/components/ui/back-circle";
import { ProductPriceCard } from "@/components/features/product-price-card";
import { ProductCard, CATEGORY_LABELS } from "@/components/features/product-card";
import { ProductActions } from "@/components/features/product-actions";
import { ProductRestockHistory } from "@/components/features/restock-history";
import { CopyOnHoldTitle } from "@/components/features/copy-on-hold-title";
import { traderaSearchUrlSpecific } from "@/lib/marketplace-urls";
import { isDirectOfferUrl } from "@/lib/marketplace-urls";
import {
  LivePricingProvider,
  LivePricePanel,
  LiveOffersTable,
  LiveStatsFootnote,
} from "@/components/features/live-product-pricing";
import { IconCards, IconChevronRight, IconStore } from "@/components/ui/icons";
import { GradedSales } from "./graded-sales";

/** Sealed-kategorier (ej singel/gradat) — får alltid en Tradera-länk. */
const SEALED_CATEGORIES: string[] = [
  "BOOSTER_BOX",
  "BOOSTER_PACK",
  "ETB",
  "COLLECTION_BOX",
  "TIN",
  "BLISTER",
  "BUNDLE",
];

const LANGUAGE_KEYS = ["SV", "EN", "JP", "DE", "FR", "OTHER"];

/**
 * Skalet som HELT paket: samma form som `ProductDetailData`, med tomma pris-fält.
 * Gör att resten av vyn är EN kodväg — den vet inte om datat är skal eller live,
 * bara `pending` säger att prisdelarna ska visa skelett i stället för "–"/"inga".
 */
function shellToDetail(shell: ProductShellData): ProductDetailData {
  return {
    id: shell.id,
    slug: shell.slug,
    title: shell.title,
    category: shell.category,
    language: shell.language,
    description: shell.description,
    imageUrl: shell.imageUrl,
    watchCount: 0,
    updatedAt: "",
    set: shell.set,
    chartData: [],
    historyBySource: { cardmarket: [], cardtrader: [], tradera: [], traderaSold: [] },
    trendSource: "cardmarket",
    change7: null,
    change30: null,
    offerCount: 0,
    stats: {
      lowestPrice: null,
      lowestPriceStockStatus: null,
      highestPrice: null,
      avgPrice: null,
      offerCount: 0,
    },
    serializedOffers: [],
    affiliateRetailerIds: [],
    similar: [],
    variants: shell.variants.map((v) => ({ slug: v.slug, label: v.label, lowestPrice: null })),
    traderaListings: [],
    // Skal-läget vet inget om graderade affärer — tom, aldrig påhittad.
    gradedSales: { windowDays: 365, totalSales: 0, rows: [] },
  };
}

/**
 * Hela produktsidans innehåll, delat av SSR-sidan (`/produkter/[slug]`) och
 * produkt-overlayn. Ren presentation. JSON-LD ligger kvar på SSR-sidan (SEO),
 * inte här.
 *
 * TVÅ INGÅNGAR (2026-08-29):
 *   · `data`  — hela paketet, redan hämtat (overlayn, via `/api/products/[slug]/detail`).
 *   · `shell` — SSR-sidans DB-fria skal (namn/bild/set). Vyn hämtar då SJÄLV
 *     samma detail-payload vid montering — utom för crawlers som kör JS
 *     (`isCrawlerClient`): de får skalet och "–" som pris, och Neon får sova.
 *     Skälet till hela uppdelningen står i produkter/[slug]/page.tsx.
 *
 * LAYOUTEN "HJÄLTE" (ägarbeslut 2026-09-05, design-canvasen "Foilio Produktvy"):
 * på mobil är produktbilden en SCEN över hela bredden med en flytande bakåtcirkel,
 * och ett rundat ARK glider upp över den med titel → pris → knappar → graf →
 * en rad som leder till butikerna. Inget logotyphuvud, inga brödsmulor, ingen
 * "Tillbaka"-rad — de gav "webbsida", inte app. När scenen scrollat bort tar en
 * smal rad över (cirkel + namn + pris) så bakåt aldrig försvinner. Svep höger
 * stänger overlayn som förut. Desktop behåller brödsmulor + bild/graf i två
 * spalter (ingen cirkel — där finns webbens huvud).
 *
 * `context`: "overlay" = scroll-behållaren är overlay-panelen (som redan ligger
 * under safe-arean → den fasta raden fästs vid 0); "page" = fönstret scrollar
 * → raden fästs under statusfältet. Overlayn har inget logotyphuvud sedan
 * 2026-09-05; SSR-sidan får sitt dolt på mobil via `SiteHeaderGate`.
 */
export function ProductDetailView({
  data: dataProp,
  shell,
  context = "page",
}: {
  data?: ProductDetailData;
  shell?: ProductShellData;
  context?: "overlay" | "page";
}) {
  const t = useTranslations("Detail");
  const tCat = useTranslations("Category");
  const tLang = useTranslations("Language");

  const slug = dataProp?.slug ?? shell?.slug ?? "";
  const [live, setLive] = useState<ProductDetailData | null>(dataProp ?? null);

  // Skal-läget: hämta prisdelen klient-sida. Ingen polling, EN hämtning per
  // montering — och ingen alls för crawlers (se lib/crawler-ua.ts).
  useEffect(() => {
    if (dataProp) {
      setLive(dataProp);
      return;
    }
    if (!shell) return;
    if (isCrawlerClient(typeof navigator === "undefined" ? undefined : navigator)) return;
    let alive = true;
    fetch(`/api/products/${shell.slug}/detail`)
      .then((r) => (r.ok ? (r.json() as Promise<ProductDetailData>) : null))
      .then((d) => {
        if (alive && d) setLive(d);
      })
      .catch(() => {
        /* skalet står kvar — "–" är sant tills vi vet bättre */
      });
    return () => {
      alive = false;
    };
  }, [dataProp, shell]);

  // Engagemang: en produktvy per klientmontering (både SSR-sidan och overlayn
  // renderar den här komponenten → immunt mot ISR-cachen). Fire-and-forget.
  useEffect(() => {
    if (slug) track("product_view", slug);
  }, [slug]);

  // Den smala raden tar över när SCENEN (bilden) lämnat bild. IntersectionObserver
  // mot viewporten fungerar i båda kontexterna: overlay-panelen är fixed inset-0,
  // så "syns i viewporten" är samma sak som "syns i panelen".
  const stageRef = useRef<HTMLDivElement>(null);
  const storesRef = useRef<HTMLDivElement>(null);
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    const el = stageRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([entry]) => setCollapsed(!entry.isIntersecting), {
      // Raden är 48 px hög — byt när scenens underkant gått in under den, inte
      // först när sista pixeln lämnat skärmen.
      rootMargin: "-48px 0px 0px 0px",
      threshold: 0,
    });
    io.observe(el);
    return () => io.disconnect();
  }, [slug]);

  if (!dataProp && !shell) return null;
  const data: ProductDetailData = live ?? shellToDetail(shell!);
  const pending = live === null;

  const isSingle = data.category === "SINGLE_CARD";
  const categoryLabel = data.category in CATEGORY_LABELS ? tCat(data.category) : tCat("OTHER");
  const languageLabel = LANGUAGE_KEYS.includes(data.language) ? tLang(data.language) : data.language;
  // Samma gallring som butikslistan gör (direktlänkar) — raden under grafen ska
  // säga samma tal som rubriken "Priser hos butiker".
  const directOffers = data.serializedOffers.filter((o) => isDirectOfferUrl(o.url));
  const inStockCount = directOffers.filter((o) => o.stockStatus === "IN_STOCK").length;
  const traderaSearch = SEALED_CATEGORIES.includes(data.category)
    ? traderaSearchUrlSpecific(data.title, data.category)
    : null;

  // Språket står bara när det inte är engelska (japanska singlar) — "Engelska"
  // på varje engelsk produkt var ett ord som aldrig ändrade något.
  const metaLine = (
    <p className="text-xs text-ink-muted lg:text-sm">
      {data.set && (
        <>
          <Link href={`/produkter?set=${data.set.id}`} className="text-holo-cyan hover:underline">
            {data.set.name}
          </Link>
          <span className="mx-2 text-ink-faint" aria-hidden="true">·</span>
        </>
      )}
      {categoryLabel}
      {data.language !== "EN" && (
        <>
          <span className="mx-2 text-ink-faint" aria-hidden="true">·</span>
          {languageLabel}
        </>
      )}
    </p>
  );

  return (
    <LivePricingProvider
      slug={data.slug}
      initialOffers={data.serializedOffers}
      initialStats={data.stats}
      affiliateRetailerIds={data.affiliateRetailerIds}
      initialUpdatedAt={data.updatedAt}
    >
      {/* SMALA RADEN (mobil). Sticky med höjd 0 → tar ingen plats i flödet men
          fäster vid scroll-behållarens topp; själva raden ligger absolut under.
          Overlayn: panelen börjar redan under safe-arean → top-0. Sidan: fönstret
          scrollar → fäst under statusfältet, och måla remsan ovanför. */}
      <div
        className={cn(
          "sticky z-30 h-0 lg:hidden",
          context === "overlay" ? "top-0" : "top-[env(safe-area-inset-top)]"
        )}
        aria-hidden={!collapsed}
      >
        <div
          className={cn(
            "hairline-b flex h-12 items-center gap-3 bg-surface/90 px-2.5 backdrop-blur-md transition-[opacity,transform] duration-200 ease-out-soft motion-reduce:transition-none",
            context === "page" &&
              "before:absolute before:inset-x-0 before:bottom-full before:h-[env(safe-area-inset-top)] before:bg-surface before:content-['']",
            collapsed ? "opacity-100" : "pointer-events-none -translate-y-2 opacity-0"
          )}
        >
          <BackCircle fallback="/produkter" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[15px] font-semibold leading-tight text-ink">{data.title}</div>
            {data.set && <div className="truncate text-xs text-ink-muted">{data.set.name} · {categoryLabel}</div>}
          </div>
          {!pending && (
            <div className="shrink-0 text-right">
              <div data-price className="text-[15px] font-bold leading-tight text-ink">
                {formatPrice(data.stats.lowestPrice)}
              </div>
              {data.change7 != null && <PriceChange percent={data.change7} hideIcon className="text-xs" />}
            </div>
          )}
        </div>
      </div>

      <div className="mx-auto max-w-7xl lg:px-6 lg:py-10">
        {/* Brödsmulor — BARA desktop. På mobil är scenen + cirkeln hela chrome:n. */}
        <nav aria-label={t("breadcrumbAria")} className="mb-4 hidden text-sm text-ink-muted lg:block">
          <Link href="/produkter" className="hover:text-ink">{t("products")}</Link>
          {data.set && (
            <>
              <span className="mx-2 text-ink-faint" aria-hidden="true">›</span>
              {/* Katalogen med set-filtret, inte set-sidan — ägarbeslut 2026-08-09:
                  från en produkt vill man tillbaka till listan man bläddrade i. */}
              <Link href={`/produkter?set=${data.set.id}`} className="hover:text-ink">
                {data.set.name}
              </Link>
            </>
          )}
          <span className="mx-2 text-ink-faint" aria-hidden="true">›</span>
          <span className="text-ink">{data.title}</span>
        </nav>

        <div className="lg:grid lg:grid-cols-[360px_minmax(0,1fr)] lg:items-start lg:gap-8">
          {/* SCENEN. Mobil: hela bredden, 300 px, svag glöd bakom lådan (enda
              stället ytan inte är rent svart — arkets kant måste läsas mot något).
              Desktop: bildbrunnen som förut. */}
          <div
            ref={stageRef}
            className="relative flex h-[300px] items-center justify-center pt-6 [background:radial-gradient(120%_90%_at_50%_45%,#15151a_0%,#000_72%)] lg:card-surface lg:aspect-[4/5] lg:h-auto lg:pt-0 lg:[background:#000]"
          >
            <SafeImage
              src={data.imageUrl}
              alt={data.title}
              /* Sidans STÖRSTA bild ovanför vecket = den webbläsaren mäter som
                 LCP. ⚠️ Flaggan är BARA en hämtningsordning — rutan är redan
                 reserverad av scenens fasta höjd, så inget flyttar sig en pixel.
                 ⛔ Sätt den inte på fler bilder här (varken Tradera-skenan eller
                 liknande produkter): det är just för att de väntar som den här
                 kommer först. */
              priority
              className="h-[232px] w-[232px] object-contain [filter:drop-shadow(0_20px_32px_rgba(0,0,0,.65))] lg:h-full lg:w-full lg:p-6 lg:[filter:none]"
              fallback={
                <div className="flex h-full w-full items-center justify-center">
                  <IconCards size={72} className="text-ink-faint" />
                </div>
              }
            />
            {/* Flytande bakåt — samma cirkel som resten av appen (ui/back-circle). */}
            <div className="absolute left-4 top-1.5 lg:hidden">
              <BackCircle fallback="/produkter" />
            </div>
          </div>

          {/* ARKET. Mobil: rundade övre hörn, hårlinje, glider 20 px upp över scenen. */}
          <div className="relative -mt-5 rounded-t-[24px] border-t border-surface-border bg-surface px-2.5 pt-5 shadow-[0_1px_0_0_rgba(255,255,255,.04)_inset] lg:mt-0 lg:rounded-none lg:border-0 lg:px-0 lg:pt-0 lg:shadow-none">
            <header>
              <CopyOnHoldTitle
                text={data.title}
                className="font-display text-[22px] font-bold leading-7 tracking-[-0.02em] text-ink lg:text-3xl lg:leading-tight xl:text-4xl"
              />
              <div className="mt-1 lg:mt-2">{metaLine}</div>
            </header>

            {/* Andra Cardmarket-versioner av samma kort (common ↔ special-variant) */}
            {data.variants.length > 0 && (
              <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
                <span className="text-ink-muted">{t("otherVersions")}</span>
                {data.variants.map((v) => (
                  <Link
                    key={v.slug}
                    href={`/produkter/${v.slug}`}
                    className="card-surface rounded-full px-3 py-1 text-ink transition hover:text-holo-cyan"
                  >
                    {v.label ?? t("baseVersion")}
                    {!pending && v.lowestPrice != null && (
                      <span className="text-ink-muted"> · {formatPrice(v.lowestPrice)}</span>
                    )}
                  </Link>
                ))}
              </div>
            )}

            {/* Prisraden — ur detail-payloaden (overlay: redan hämtad; SSR-sida:
                hämtad vid montering, skelett tills dess). INGEN polling. */}
            <LivePricePanel
              priceChange7dPercent={data.change7}
              change30={data.change30}
              isSingle={isSingle}
              isJapanese={data.language === "JP"}
              pending={pending}
            />

            {/* Bevakarantalet ("4 samlare bevakar") är BORTTAGET ur arket (2026-09-05):
                en rad till mellan pris och knappar, och fyra är inget socialt bevis. */}
            <div className="mt-5">
              <ProductActions productId={data.id} title={data.title} />
            </div>

            {/* Prishistorik — utan kortram och utan rubrik inne i arket (kurvan
                förklarar sig själv; perioden ligger under den). Desktop får kortet. */}
            <div className="mt-7 lg:card-surface lg:p-5">
              {pending ? (
                <Skeleton className="h-52 w-full" />
              ) : (
                <>
                  <ProductPriceCard
                    plain
                    bySource={data.historyBySource}
                    title={isSingle ? t("historyRawTitle") : t("historyTitle")}
                    /* ⛔ UNDERRUBRIKEN FÅR INTE NAMNGE EN KÄLLA. Källorna namnger sig
                       själva i chipsen (som ÄR diagrammets legend); det som återstår är
                       kvaliteten på datat, och den måste gälla ALLA serier. */
                    subtitle={data.chartData.length === 0 ? t("historyNone") : t("historyQuality")}
                    series={data.chartData}
                  />
                  <LiveStatsFootnote className="mt-2" />
                </>
              )}
            </div>

            {/* Raden till butikerna (mobil): svaret på "var köper jag" utan att
                scrolla i blindo. Knapp med scrollIntoView, INTE en #-länk — ett
                hash-hopp lägger en historikpost, och overlayn stängs på popstate. */}
            {!pending && directOffers.length > 0 && (
              <button
                type="button"
                onClick={() => storesRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
                className="mt-4 flex w-full items-center justify-between border-t border-surface-border py-3 text-left lg:hidden"
              >
                <span className="inline-flex items-center gap-2.5 text-[15px] font-semibold text-ink">
                  <IconStore size={18} className="text-ink-muted" />
                  {t("storePrices")}
                </span>
                <span className="inline-flex items-center gap-1.5 text-[13px] text-ink-muted">
                  {t("storesTeaser", { count: directOffers.length, inStock: inStockCount })}
                  <IconChevronRight size={16} className="text-ink-faint" />
                </span>
              </button>
            )}
          </div>
        </div>

        <div className="px-2.5 lg:px-0">
          {/* Erbjudanden — detail-payloaden är cachad ≤1h (cachedRead), ingen polling.
              Lagerstatusen här kan därför släpa efter restock-historiken nedanför,
              som är admin-only och hämtas färsk on-demand. */}
          <div ref={storesRef} className="scroll-mt-14">
            <LiveOffersTable pending={pending} slug={data.slug} traderaSearch={traderaSearch} />
          </div>

          {/* Restock-historik — admin-only, hämtas on-demand (se restock-history.tsx) */}
          <ProductRestockHistory productId={data.id} />

          {/* GRADERADE FÖRSÄLJNINGAR — egen serie, aldrig blandad med den ograderade
              kurvan. Visas bara när det finns affärer att visa. */}
          <GradedSales graded={data.gradedSales} productTitle={data.title} />

          {/* Fler annonser på Tradera (#19) — samma produkt, andra säljare.
              Horisontell svep-skena; billigast först (svepet lagrar max 20).
              Klick räknas som list_click i engagemangs-spårningen. */}
          {data.traderaListings.length > 0 && (
            <section className="mt-10">
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <h2 className="font-display text-xl font-semibold text-ink">
                  {t("traderaListings")}
                </h2>
                <a
                  href={traderaSearchUrlSpecific(data.title, data.category)}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  onClick={() => track("list_click", data.slug)}
                  className="text-sm text-holo-cyan hover:underline"
                >
                  {t("traderaSeeAll")}
                </a>
              </div>
              {/* data-swipe-ignore: skenan äger sitt horisontella drag — utan den
                  tolkar overlayn ett höger-svep i skenan som "stäng" och man
                  kastas tillbaka till Utforska mitt i bläddrandet. */}
              <div
                data-swipe-ignore
                className="-mx-2.5 mt-4 flex snap-x gap-3 overflow-x-auto px-2.5 pb-2 lg:mx-0 lg:px-0"
              >
                {data.traderaListings.map((l) => (
                  <a
                    key={l.itemId}
                    href={l.url}
                    target="_blank"
                    rel="noopener noreferrer nofollow"
                    onClick={() => track("list_click", data.slug)}
                    className="card-surface w-44 shrink-0 snap-start overflow-hidden hover:border-holo-cyan/40"
                  >
                    <div className="flex h-36 items-center justify-center overflow-hidden bg-surface">
                      {l.imageUrl ? (
                        <img
                          src={l.imageUrl}
                          alt={l.title}
                          loading="lazy"
                          className="h-full w-full object-cover"
                        />
                      ) : data.imageUrl ? (
                        <img
                          src={data.imageUrl}
                          alt={l.title}
                          loading="lazy"
                          className="h-full w-full object-contain p-2"
                        />
                      ) : (
                        <IconCards size={40} className="text-ink-faint" />
                      )}
                    </div>
                    <div className="p-3">
                      <p className="line-clamp-2 text-xs text-ink-muted">{l.title}</p>
                      <p className="mt-1 text-sm font-semibold text-ink">
                        {formatPrice(l.price)}
                      </p>
                    </div>
                  </a>
                ))}
              </div>
            </section>
          )}

          {/* Similar products */}
          {data.similar.length > 0 && (
            <section className="mt-10">
              <h2 className="font-display text-xl font-semibold text-ink">
                {t("similar")}
              </h2>
              <div className="mt-4 grid grid-cols-2 gap-2.5 md:grid-cols-4 md:gap-3.5">
                {data.similar.map((p) => (
                  <ProductCard
                    key={p.slug}
                    product={{
                      id: p.id,
                      slug: p.slug,
                      title: p.title,
                      imageUrl: p.imageUrl,
                      category: p.category,
                      setId: p.setId,
                      setName: p.setName,
                      setTotalCards: p.setTotalCards,
                      cardName: p.cardName,
                      cardNumber: p.cardNumber,
                      cardRarity: p.cardRarity,
                      variantLabel: p.variantLabel,
                      lowestPrice: p.lowestPrice,
                      stockStatus: p.lowestPriceStockStatus,
                    }}
                  />
                ))}
              </div>
            </section>
          )}
        </div>
      </div>
    </LivePricingProvider>
  );
}
