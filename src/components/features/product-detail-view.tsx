"use client";

/* eslint-disable @next/next/no-img-element */
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Link, useRouter } from "@/i18n/navigation";
import { track } from "@/lib/track";
import { formatPrice, formatRelative } from "@/lib/format";
import { isCrawlerClient } from "@/lib/crawler-ua";
import type { ProductDetailData, ProductShellData } from "@/services/products";
import { StockBadge } from "@/components/ui/badge";
import { SafeImage } from "@/components/ui/safe-image";
import { Skeleton } from "@/components/ui/skeleton";
import { ProductPriceCard } from "@/components/features/product-price-card";
import { ProductCard, CATEGORY_LABELS } from "@/components/features/product-card";
import { ProductActions } from "@/components/features/product-actions";
import { ProductRestockHistory } from "@/components/features/restock-history";
import { CopyOnHoldTitle } from "@/components/features/copy-on-hold-title";
import { traderaSearchUrlSpecific } from "@/lib/marketplace-urls";
import {
  LivePricingProvider,
  LivePricePanel,
  LiveOffersTable,
} from "@/components/features/live-product-pricing";
import { IconCards, IconChevronLeft } from "@/components/ui/icons";

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
 * `showBack`: bakåtknapp överst. Sätts BARA av SSR-sidan — dit landar man via
 * djuplänk/push-notis, där overlayns svep-tillbaka inte finns (man fastnade).
 * Overlayn har redan svep + SiteHeader, så den skickar inte proppen.
 */
export function ProductDetailView({
  data: dataProp,
  shell,
  showBack = false,
}: {
  data?: ProductDetailData;
  shell?: ProductShellData;
  showBack?: boolean;
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

  if (!dataProp && !shell) return null;
  const data: ProductDetailData = live ?? shellToDetail(shell!);
  const pending = live === null;

  const isSingle = data.category === "SINGLE_CARD";

  return (
    <LivePricingProvider
      slug={data.slug}
      initialOffers={data.serializedOffers}
      initialStats={data.stats}
      affiliateRetailerIds={data.affiliateRetailerIds}
      initialUpdatedAt={data.updatedAt}
    >
      <div className="mx-auto max-w-7xl px-2.5 py-10 sm:px-6">
        {showBack && <BackButton label={t("back")} />}
        {/* Breadcrumb */}
        <nav aria-label={t("breadcrumbAria")} className="mb-4 text-sm text-ink-muted">
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

        {/* Title */}
        <header>
          <CopyOnHoldTitle
            text={data.title}
            className="font-display text-3xl font-bold text-ink sm:text-4xl"
          />
          <p className="mt-2 text-sm text-ink-muted">
            {data.set && (
              <>
                <Link
                  href={`/produkter?set=${data.set.id}`}
                  className="text-holo-cyan hover:underline"
                >
                  {data.set.name}
                </Link>
                <span className="mx-2 text-ink-faint" aria-hidden="true">·</span>
              </>
            )}
            {data.category in CATEGORY_LABELS ? tCat(data.category) : tCat("OTHER")}
            <span className="mx-2 text-ink-faint" aria-hidden="true">·</span>
            {LANGUAGE_KEYS.includes(data.language) ? tLang(data.language) : data.language}
          </p>
        </header>

        {/* Andra Cardmarket-versioner av samma kort (common ↔ special-variant) */}
        {data.variants.length > 0 && (
          <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
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

        {/* Bild | Prishistorik */}
        <div className="mt-8 grid gap-6 lg:grid-cols-[320px_1fr]">
          {/* Bildbrunnen är SVART som kortet — `surface-overlay` lyste som en grå
              ruta mitt på den svarta produktsidan. Samma fix som i produktkortet. */}
          <div className="card-surface flex aspect-[4/3] items-center justify-center overflow-hidden bg-surface lg:aspect-auto">
            <SafeImage
              src={data.imageUrl}
              alt={data.title}
              /* Sidans STÖRSTA bild ovanför vecket = den webbläsaren mäter som
                 LCP. Den låg som `lazy` tillsammans med rutnätens hundratals
                 miniatyrer, dvs hämtades efter att layouten räknats ut fast den
                 alltid syns direkt. ⚠️ Flaggan är BARA en hämtningsordning —
                 rutan är redan reserverad av brunnens `aspect-[4/3]`, så inget
                 flyttar sig en pixel. ⛔ Sätt den inte på fler bilder här (varken
                 Tradera-skenan eller liknande produkter): det är just för att de
                 väntar som den här kommer först. */
              priority
              className="h-full w-full object-contain p-4"
              fallback={
                <div className="flex h-full w-full items-center justify-center">
                  <IconCards size={72} className="text-ink-faint" />
                </div>
              }
            />
          </div>

          {pending ? (
            <Skeleton className="card-surface min-h-64 w-full" />
          ) : (
          <ProductPriceCard
            bySource={data.historyBySource}
            title={isSingle ? t("historyRawTitle") : t("historyTitle")}
            /* ⛔ UNDERRUBRIKEN FÅR INTE NAMNGE EN KÄLLA LÄNGRE. Den stod på
               `trendSource` och sa "· Cardmarket" — men sedan källfiltret finns
               kan besökaren rita CardTrader och Tradera i samma diagram, och då
               påstod raden att kurvorna var Cardmarkets. Källorna namnger sig
               själva i chipsen ovanför grafen (som ÄR diagrammets legend), så
               det som återstår här är kvaliteten på datat — och den måste gälla
               ALLA serier: Tradera-annonser har inget känt skick, så "Near Mint"
               kan inte stå kvar heller. */
            subtitle={data.chartData.length === 0 ? t("historyNone") : t("historyQuality")}
            series={data.chartData}
          />
          )}
        </div>

        {/* Prispanel — ur detail-payloaden (overlay: redan hämtad; SSR-sida: hämtad
            vid montering, skelett tills dess). INGEN polling. */}
        <LivePricePanel
          priceChange7dPercent={data.change7}
          change30={data.change30}
          isSingle={isSingle}
          pending={pending}
        />
        <div className="mt-6 flex flex-wrap items-center gap-4">
          <ProductActions productId={data.id} title={data.title} />
          {!pending && (
            <p className="text-xs text-ink-faint">
              {t("watchers", { count: data.watchCount })}
            </p>
          )}
        </div>
        {/* Beskrivning borttagen: dubblade rubriken (Set · Kategori · Språk) och
            fanns bara på ~54 sealed-produkter som svensk boilerplate. */}

        {/* Erbjudanden — detail-payloaden är cachad ≤1h (cachedRead), ingen polling.
            Lagerstatusen här kan därför släpa efter restock-historiken nedanför,
            som är admin-only och hämtas färsk on-demand. */}
        <LiveOffersTable
          pending={pending}
          slug={data.slug}
          traderaSearch={
            SEALED_CATEGORIES.includes(data.category)
              ? traderaSearchUrlSpecific(data.title, data.category)
              : null
          }
        />

        {/* Restock-historik — admin-only, hämtas on-demand (se restock-history.tsx) */}
        <ProductRestockHistory productId={data.id} />

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
              className="-mx-2.5 mt-4 flex snap-x gap-3 overflow-x-auto px-2.5 pb-2 sm:-mx-6 sm:px-6 lg:mx-0 lg:px-0"
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
    </LivePricingProvider>
  );
}

/**
 * Bakåtknapp för SSR-produktsidan. Landar man här via en push-notis/djuplänk
 * finns ingen app-historik att svepa tillbaka till → gå då till Utforska
 * (`/produkter`) istället. Har man däremot navigerat hit inifrån appen backar
 * vi ett steg som vanligt.
 */
function BackButton({ label }: { label: string }) {
  const router = useRouter();
  const onBack = () => {
    if (typeof window !== "undefined" && window.history.length > 1) {
      router.back();
    } else {
      router.push("/produkter");
    }
  };
  return (
    <button
      type="button"
      onClick={onBack}
      className="-ml-1 mb-3 inline-flex items-center gap-1 rounded-full py-1 pr-3 pl-1 text-sm text-ink-muted transition hover:text-ink focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-holo-cyan/60"
    >
      <IconChevronLeft size={18} />
      {label}
    </button>
  );
}
