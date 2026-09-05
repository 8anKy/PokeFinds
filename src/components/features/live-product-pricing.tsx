"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { getSharedSession } from "@/lib/client-session";
import { useTranslations } from "next-intl";
import { hasAuthHint } from "@/lib/auth-hint";
import { formatPrice } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Badge, StockBadge } from "@/components/ui/badge";
import { PriceChange } from "@/components/ui/price-change";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { OfferClickButton } from "@/components/features/offer-click-button";
import { RetailerLogo } from "@/components/features/retailer-logo";
import { IconStore, IconChevronDown } from "@/components/ui/icons";
import { hapticTick } from "@/lib/haptics";
import { isCardmarketJpSearchUrl, isDirectOfferUrl } from "@/lib/marketplace-urls";
import { lowestOfferSource } from "@/lib/offer-source";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface LiveRetailer {
  id: string;
  name: string;
  logoUrl: string | null;
  websiteUrl: string;
  affiliateEnabled: boolean;
}

export interface LiveOffer {
  id: string;
  /** öre — null = länk-offer utan känt pris (t.ex. auktioner/marknadsplats) */
  price: number | null;
  shippingPrice: number | null;
  stockStatus: string;
  url: string;
  retailerId: string;
  retailer: LiveRetailer;
}

export interface PriceStats {
  lowestPrice: number | null;
  lowestPriceStockStatus: string | null;
  highestPrice: number | null;
  avgPrice: number | null;
  offerCount: number;
}

interface OffersResponse {
  offers: LiveOffer[];
  stats: PriceStats;
  updatedAt: string;
}

// ─── Context ─────────────────────────────────────────────────────────────────

interface LivePricingState {
  offers: LiveOffer[];
  stats: PriceStats;
  updatedAt: string;
  flash: boolean;
  affiliateIds: Set<string>;
  refresh: () => void;
}

const LivePricingContext = createContext<LivePricingState | null>(null);

function useLivePricing() {
  const ctx = useContext(LivePricingContext);
  if (!ctx) throw new Error("useLivePricing must be used within LivePricingProvider");
  return ctx;
}

// ─── Provider ────────────────────────────────────────────────────────────────

export interface LivePricingProviderProps {
  slug: string;
  initialOffers: LiveOffer[];
  initialStats: PriceStats;
  affiliateRetailerIds: string[];
  initialUpdatedAt: string;
  children: ReactNode;
}

export function LivePricingProvider({
  slug,
  initialOffers,
  initialStats,
  affiliateRetailerIds,
  initialUpdatedAt,
  children,
}: LivePricingProviderProps) {
  const [offers, setOffers] = useState<LiveOffer[]>(initialOffers);
  const [stats, setStats] = useState<PriceStats>(initialStats);
  const [updatedAt, setUpdatedAt] = useState(initialUpdatedAt);
  const [flash, setFlash] = useState(false);
  const [affiliateIds, setAffiliateIds] = useState(
    () => new Set(affiliateRetailerIds)
  );
  const prevLowestRef = useRef(initialStats.lowestPrice);

  // SSR-sidan monterar med skalets tomma värden och får det riktiga paketet
  // strax efter (product-detail-view hämtar det) → följ propparna, annars
  // hade panelen stått kvar på "–" med live-datat i handen.
  useEffect(() => {
    setOffers(initialOffers);
    setStats(initialStats);
    setUpdatedAt(initialUpdatedAt);
    setAffiliateIds(new Set(affiliateRetailerIds));
    prevLowestRef.current = initialStats.lowestPrice;
  }, [initialOffers, initialStats, initialUpdatedAt, affiliateRetailerIds]);

  const fetchOffers = useCallback(async () => {
    try {
      const res = await fetch(`/api/products/${slug}/offers`, {
        cache: "no-store",
      });
      if (!res.ok) return;
      const data: OffersResponse = await res.json();
      setOffers(data.offers);
      setStats(data.stats);
      setUpdatedAt(data.updatedAt);

      // Flash when price changes
      if (
        data.stats.lowestPrice !== null &&
        prevLowestRef.current !== null &&
        data.stats.lowestPrice !== prevLowestRef.current
      ) {
        setFlash(true);
        setTimeout(() => setFlash(false), 1500);
      }
      prevLowestRef.current = data.stats.lowestPrice;

      // Update affiliate set
      setAffiliateIds(
        new Set(
          data.offers
            .filter((o) => o.retailer.affiliateEnabled)
            .map((o) => o.retailerId)
        )
      );
    } catch {
      // Tyst — nästa poll försöker igen
    }
  }, [slug]);

  // Ingen egen hämtning här: datat kommer via propparna (overlayn har det redan;
  // SSR-sidan hämtar detail-payloaden EN gång vid montering i product-detail-view).
  // `refresh` finns kvar för adminens manuella uppdatering efter att ha tagit bort
  // ett erbjudande.

  return (
    <LivePricingContext.Provider
      value={{ offers, stats, updatedAt, flash, affiliateIds, refresh: fetchOffers }}
    >
      {children}
    </LivePricingContext.Provider>
  );
}

// ─── Price Panel (goes inside header grid) ───────────────────────────────────

export interface LivePricePanelProps {
  priceChange7dPercent: number | null;
  change30: number | null;
  /**
   * Singel → rubriken NAMNGER källan till det visade priset. Den stod tidigare
   * hårdkodad som "Lägsta pris · NM engelska (Cardmarket)" på varje singel, även
   * de tusentals där siffran kom från en Tradera-annons och ingen CM-länk fanns.
   */
  isSingle?: boolean;
  /** Japansk singel → "NM japanska", inte "NM engelska" (priset är CM:s JP-From). */
  isJapanese?: boolean;
  /** Skal-läge: priset är inte hämtat ännu → skelett i stället för "–". */
  pending?: boolean;
}

export function LivePricePanel({
  priceChange7dPercent,
  change30,
  isSingle = false,
  isJapanese = false,
  pending = false,
}: LivePricePanelProps) {
  const t = useTranslations("Detail");
  const { stats, offers, flash } = useLivePricing();

  if (pending) {
    return (
      <div className="mt-5" aria-busy="true">
        <Skeleton className="h-3 w-32" />
        <div className="mt-1.5 flex items-center justify-between gap-3">
          <Skeleton className="h-9 w-36" />
          <Skeleton className="h-6 w-16 rounded-full" />
        </div>
        <Skeleton className="mt-2 h-3 w-28" />
      </div>
    );
  }

  // NM-engelska-kvalificeringen hör till Cardmarkets From-pris och får bara stå
  // där priset faktiskt kommer därifrån. Okänd källa → neutral rubrik.
  //
  // Och den vinnande offern måste vara I LAGER: en slutsåld CM-offer bär en
  // UPPSKATTNING (prisjobben märker den så när `lowest_near_mint` saknas), och över
  // den siffran vore "Lägsta pris · NM engelska" ett påstående om en annons som inte
  // finns — samma sorts fel som taket 2026-07-27 gjorde med själva talet.
  const source = lowestOfferSource(offers, stats.lowestPrice);
  const priceLabel = !isSingle
    ? t("priceLabelDefault")
    : source?.name === "Cardmarket" && source.live
      ? t(isJapanese ? "priceLabelSingleJp" : "priceLabelSingle")
      : source && !source.live
        ? t("priceLabelEstimate", { source: source.name })
        : source
          ? t("priceLabelSingleSource", { source: source.name })
          : t("priceLabelDefault");

  // PRISBLOCKET i arket (2026-09-05, andra passet — "för trångt, för mycket text"):
  // TRE rader och inte fler. Etikett, priset med lagerbrickan på samma rad, och EN
  // förändring (veckan; 30 dagar bara när veckan saknas). Högsta/snitt flyttade
  // till en fotnot under grafen (`LiveStatsFootnote`), 30-dagarstalet syns i grafen.
  const change = priceChange7dPercent != null ? { pct: priceChange7dPercent, suffix: t("weekChangeSuffix") }
    : change30 != null ? { pct: change30, suffix: t("monthChangeSuffix") } : null;
  return (
    <div className="mt-5">
      <p className="text-xs text-ink-muted">{priceLabel}</p>
      <div className="mt-0.5 flex items-center justify-between gap-3">
        <p
          data-price
          className={cn(
            "min-w-0 font-display text-[32px] font-bold leading-[38px] tracking-[-0.02em] text-ink transition-colors duration-700 lg:text-4xl",
            flash && "text-rise"
          )}
        >
          {formatPrice(stats.lowestPrice)}
        </p>
        {stats.lowestPriceStockStatus && <StockBadge stockStatus={stats.lowestPriceStockStatus} />}
      </div>
      {change && (
        <p className="mt-1 flex items-center gap-1.5 text-xs text-ink-muted">
          <PriceChange percent={change.pct} hideIcon className="text-xs" />
          {change.suffix}
        </p>
      )}
    </div>
  );
}

/**
 * Högsta/snitt som en dämpad fotnot under grafen — bara vid ≥ 2 prissatta offers
 * (med EN blir alla tre tal samma). Flyttad hit från prisblocket när arket
 * bantades: talen är ett komplement till kurvan, inte till priset.
 */
export function LiveStatsFootnote({ className }: { className?: string }) {
  const t = useTranslations("Detail");
  const { stats } = useLivePricing();
  if (stats.offerCount < 2) return null;
  return (
    <p className={cn("text-xs text-ink-faint", className)}>
      {t("highestNow")} <span data-price className="font-medium text-ink-muted">{formatPrice(stats.highestPrice)}</span>
      <span className="mx-1.5" aria-hidden="true">·</span>
      {t("avgPrice")} <span data-price className="font-medium text-ink-muted">{formatPrice(stats.avgPrice)}</span>
    </p>
  );
}

// ─── Offers Table (goes full-width below grid) ──────────────────────────────

/**
 * Hur många butiker som visas innan "Visa alla".
 *
 * Listan var oavkortad, och med Wave 4 säljer 30+ butiker samma låda — en produktsida
 * blev då en skärmhög tabell där prishistoriken hamnade långt under vikningen. Samma
 * avvägning som skannerns alternativlista redan gör: gallra för VISNING, aldrig för
 * urval. Alla erbjudanden finns kvar, de ligger bara ett tryck bort.
 *
 * Fem, inte tre: de billigaste är hela poängen med sidan, och tre rader räcker inte
 * för att se om det finns en prisspridning värd att bläddra i.
 */
const VISIBLE_OFFERS = 5;

/**
 * Radens uppenbarelse-animation. Extra rader monteras först vid utfällning, så varje
 * rad kan tona in för sig med en liten stegring — det läser som att listan VÄXER, i
 * stället för att hoppa.
 *
 * ⛔ Stegringen kapas vid MAX_STAGGER_STEPS. Med 30 butiker och 40 ms per rad hade
 *    sista raden dröjt över en sekund, och en "animation" som användaren hinner vänta
 *    på är en fördröjning.
 * ⛔ Grid-tricket (0fr→1fr) som resten av appen använder för höjdsvep går INTE här:
 *    desktop-listan är en riktig <table>, och ett <tr> tål ingen wrapper-div utan att
 *    kolumnjusteringen faller isär. Radvis intoning fungerar i BÅDA layouterna, alltså
 *    en implementation i stället för två som kan glida isär.
 */
const MAX_STAGGER_STEPS = 6;
function revealStyle(index: number): React.CSSProperties {
  return { animationDelay: `${Math.min(index, MAX_STAGGER_STEPS) * 40}ms` };
}
const REVEAL_CLASS = "animate-fade-in-up motion-reduce:animate-none";

export interface LiveOffersTableProps {
  slug: string;
  /** Reserv-länk "Sök på Tradera" (sealed utan direkt Tradera-annons). */
  traderaSearch?: string | null;
  /** Skal-läge: offers inte hämtade ännu → skelettrader, inte "inga erbjudanden". */
  pending?: boolean;
}

export function LiveOffersTable({ slug, traderaSearch, pending = false }: LiveOffersTableProps) {
  const t = useTranslations("Detail");
  const { offers, affiliateIds, refresh } = useLivePricing();
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  // Admin-status: produktsidan ISR-cachas → ingen server-`auth()`. Hämtar bara
  // sessionen on-demand om fo_auth-cookien finns (= inloggad), så utloggade
  // besökare aldrig anropar /api/auth/session. "Ta bort" visas bara för admins.
  const [isAdmin, setIsAdmin] = useState(false);
  useEffect(() => {
    if (!hasAuthHint()) return;
    void getSharedSession().then((s) => {
      const role = s?.user?.role;
      setIsAdmin(role === "ADMIN" || role === "SUPERADMIN");
    });
  }, []);

  async function deleteOffer(offerId: string) {
    if (!confirm(t("confirmRemoveOffer"))) return;
    setDeletingId(offerId);
    try {
      const res = await fetch(`/api/admin/offers/${offerId}`, { method: "DELETE" });
      if (res.ok) refresh();
      else alert(t("removeOfferFailed"));
    } finally {
      setDeletingId(null);
    }
  }

  // JP-singlarnas Cardmarket-rad är en SÖKlänk (det enda tillåtna undantaget, se
  // isDirectOfferUrl) — knappen får inte lova "Till butik".
  const offerLabel = (url: string) => (isCardmarketJpSearchUrl(url) ? t("searchOnCardmarket") : undefined);

  // Visa alla offers med direkt produktlänk (sök-/bläddringslänkar filtreras
  // redan bort på servern; detta är en defensiv extra gallring). Pris kan
  // saknas (t.ex. helt nya kort utan marknadsdata) — då visas länken ändå med
  // "–" som pris. Det som går att KÖPA överst (i lager, billigast först), sedan
  // slutsålda i prisordning — förut sorterades slutsålda in mellan lagerförda
  // på pris, så en 429 kr "Slut" låg över en 445 kr "I lager" (Android-QA 09-01).
  const stockRank = (o: LiveOffer) => (o.stockStatus === "IN_STOCK" ? 0 : 1);
  const directOffers = offers
    .filter((o) => isDirectOfferUrl(o.url))
    .sort((a, b) => {
      const byStock = stockRank(a) - stockRank(b);
      if (byStock !== 0) return byStock;
      if (a.price == null && b.price == null) return 0;
      if (a.price == null) return 1;
      if (b.price == null) return -1;
      return a.price - b.price;
    });

  // Tradera-reserv: visa "Sök på Tradera" när produkten saknar en direkt
  // Tradera-annons (gäller sealed) så att det alltid finns en väg till Tradera.
  const showTraderaSearch =
    !!traderaSearch && !directOffers.some((o) => o.retailer.name === "Tradera");

  // Utfällningen sitter på LISTAN, inte på varje layout — mobilkorten och
  // desktoptabellen visar samma butiker, annars hade knappen ljugit på en av dem.
  const canExpand = directOffers.length > VISIBLE_OFFERS;
  const shownOffers = canExpand && !expanded ? directOffers.slice(0, VISIBLE_OFFERS) : directOffers;
  const hiddenCount = directOffers.length - VISIBLE_OFFERS;

  // "Lägst"-taggen sitter på första raden BARA när den är köpbar med känt pris —
  // listan sorterar in slutsålda under de lagerförda, så en slutsåld etta hade
  // fått taggen på ett pris ingen kan betala.
  const bestOfferId =
    directOffers[0]?.stockStatus === "IN_STOCK" && directOffers[0].price != null ? directOffers[0].id : null;

  return (
    <>
      <section className="mt-8 lg:mt-10">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="font-display text-[17px] font-semibold text-ink lg:text-xl">
            {t("storePrices")}
          </h2>
          {!pending && directOffers.length > 0 && (
            <span className="text-xs text-ink-faint">
              {t("storesTeaser", { count: directOffers.length, inStock: directOffers.filter((o) => o.stockStatus === "IN_STOCK").length })} · {t("storesSorted")}
            </span>
          )}
        </div>
        {pending ? (
          <div className="mt-4 space-y-3" aria-busy="true">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-16 w-full rounded-xl" />
            ))}
          </div>
        ) : directOffers.length === 0 ? (
          <EmptyState
            className="mt-4"
            icon={<IconStore size={32} />}
            title={t("noOffers")}
            description={t("noOffersDesc")}
          />
        ) : (
          <div className="mt-4">
            {directOffers.length > 0 && (
              <>
                {/* Mobil: staplade kort (tabellen ryms inte utan sidoscroll).
                    Butiksraden = variant 4 i produktvy-designen (ägarbeslut
                    2026-09-05): kvadratisk 44 px-logga, namn + "Lägst"-tagg,
                    pris + lagerbricka, "Till butik" till höger. */}
                <div className="space-y-2 sm:hidden">
                  {shownOffers.map((offer, i) => (
                    <div
                      key={offer.id}
                      style={i >= VISIBLE_OFFERS ? revealStyle(i - VISIBLE_OFFERS) : undefined}
                      className={cn(
                        "card-surface flex items-center justify-between gap-3 p-3 pr-3.5",
                        offer.id === bestOfferId && "border-holo-cyan/45",
                        i >= VISIBLE_OFFERS && REVEAL_CLASS
                      )}
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <RetailerLogo name={offer.retailer.name} logoUrl={offer.retailer.logoUrl} />
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[15px] font-medium leading-5">
                            <span className="truncate">{offer.retailer.name}</span>
                            {offer.id === bestOfferId && (
                              <span className="rounded-md bg-holo-cyan/[0.12] px-1.5 py-px text-[10px] font-bold uppercase tracking-[0.06em] text-holo-cyan">
                                {t("lowestTag")}
                              </span>
                            )}
                            {affiliateIds.has(offer.retailerId) && <Badge>{t("adLink")}</Badge>}
                          </div>
                          <div className="mt-1 flex items-center gap-2">
                            <span className="font-semibold tabular-nums">
                              {offer.price != null ? formatPrice(offer.price) : "–"}
                            </span>
                            <StockBadge stockStatus={offer.stockStatus} />
                          </div>
                        </div>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-2">
                        <OfferClickButton slug={slug} offerId={offer.id} fallbackUrl={offer.url} label={offerLabel(offer.url)} />
                        {isAdmin && (
                          <button
                            type="button"
                            onClick={() => deleteOffer(offer.id)}
                            disabled={deletingId === offer.id}
                            className="rounded-md border border-fall/40 px-2 py-1 text-xs font-medium text-fall transition-colors hover:bg-fall/10 disabled:opacity-50"
                            title="Ta bort felmatchat erbjudande (admin)"
                          >
                            {deletingId === offer.id ? t("removingOffer") : t("removeOffer")}
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Desktop: tabell */}
                <div className="hidden sm:block">
                  <Table>
                    <THead>
                      <TR>
                        <TH>{t("thStore")}</TH>
                        <TH>{t("thPrice")}</TH>
                        <TH>{t("thStock")}</TH>
                        <TH className="text-right">{t("thLink")}</TH>
                      </TR>
                    </THead>
                    <TBody>
                      {shownOffers.map((offer, i) => (
                        <TR
                          key={offer.id}
                          style={i >= VISIBLE_OFFERS ? revealStyle(i - VISIBLE_OFFERS) : undefined}
                          className={i >= VISIBLE_OFFERS ? REVEAL_CLASS : undefined}
                        >
                          <TD>
                            <span className="inline-flex items-center gap-2.5">
                              <RetailerLogo name={offer.retailer.name} logoUrl={offer.retailer.logoUrl} size={32} className="rounded-lg" />
                              <span className="font-medium">{offer.retailer.name}</span>
                              {offer.id === bestOfferId && (
                                <span className="rounded-md bg-holo-cyan/[0.12] px-1.5 py-px text-[10px] font-bold uppercase tracking-[0.06em] text-holo-cyan">
                                  {t("lowestTag")}
                                </span>
                              )}
                              {affiliateIds.has(offer.retailerId) && <Badge>{t("adLink")}</Badge>}
                            </span>
                          </TD>
                          <TD className="font-semibold tabular-nums">
                            {offer.price != null ? formatPrice(offer.price) : "–"}
                          </TD>
                          <TD>
                            <StockBadge stockStatus={offer.stockStatus} />
                          </TD>
                          <TD className="text-right">
                            <div className="inline-flex items-center gap-2">
                              <OfferClickButton
                                slug={slug}
                                offerId={offer.id}
                                fallbackUrl={offer.url}
                                label={offerLabel(offer.url)}
                              />
                              {isAdmin && (
                                <button
                                  type="button"
                                  onClick={() => deleteOffer(offer.id)}
                                  disabled={deletingId === offer.id}
                                  className="rounded-md border border-fall/40 px-2 py-1 text-xs font-medium text-fall transition-colors hover:bg-fall/10 disabled:opacity-50"
                                  title="Ta bort felmatchat erbjudande (admin)"
                                >
                                  {deletingId === offer.id ? t("removingOffer") : t("removeOffer")}
                                </button>
                              )}
                            </div>
                          </TD>
                        </TR>
                      ))}
                    </TBody>
                  </Table>
                </div>

                {canExpand && (
                  <button
                    type="button"
                    onClick={() => {
                      // Haptik: gesten saknar egen kvittens på mobil — raderna tonar in
                      // först efter animationens första bildruta.
                      hapticTick();
                      setExpanded((v) => !v);
                    }}
                    aria-expanded={expanded}
                    className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-lg border border-surface-border px-4 py-2.5 text-sm font-medium text-ink-muted transition-colors hover:border-holo-cyan/60 hover:text-holo-cyan sm:w-auto"
                  >
                    {expanded ? t("showFewerStores") : t("showAllStores", { count: hiddenCount })}
                    <IconChevronDown
                      size={16}
                      className={cn(
                        "transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none",
                        expanded && "rotate-180"
                      )}
                    />
                  </button>
                )}
              </>
            )}

            {/* ERSÄTTNINGSUPPLYSNING. Visas BARA när minst en synlig länk faktiskt är
                affiliate-märkt (`affiliateIds`). ⛔ Får ALDRIG visas ovillkorligt: i dag
                är affiliate inte aktivt (ägarbeslut 2026-08-08), och en stående
                "vi kan få ersättning" motsäger då direkt villkoren §8 och /om, som lovar
                motsatsen. Grinden gör upplysningen sann i båda lägena. */}
            {affiliateIds.size > 0 && (
              <p className="mt-4 text-xs leading-relaxed text-ink-faint">
                {t("affiliateDisclosure")}
              </p>
            )}
          </div>
        )}
        {showTraderaSearch && (
          <a
            href={traderaSearch!}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="mt-4 inline-flex items-center gap-2 rounded-lg border border-surface-border px-4 py-2.5 text-sm font-medium text-ink-muted transition-colors hover:border-holo-cyan/60 hover:text-holo-cyan"
          >
            <IconStore size={16} /> {t("traderaSearchLink")}
          </a>
        )}
      </section>
    </>
  );
}
