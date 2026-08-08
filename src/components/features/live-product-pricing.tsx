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
import { getSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import { hasAuthHint } from "@/lib/auth-hint";
import { formatPrice } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Badge, StockBadge } from "@/components/ui/badge";
import { PriceChange } from "@/components/ui/price-change";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty-state";
import { OfferClickButton } from "@/components/features/offer-click-button";
import { IconStore, IconChevronDown } from "@/components/ui/icons";
import { hapticTick } from "@/lib/haptics";
import { isDirectOfferUrl } from "@/lib/marketplace-urls";
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

  // Ingen hämtning vid sidvisning: servern lägger redan initialOffers/initialStats
  // i den ISR-cachade HTML:en (≤1h gammalt; priser ändras var 8:e h av skrapjobben).
  // En klient-fetch per produktsidvisning (~20k sidor) körde en serverless-funktion
  // + Neon-fråga i onödan och brände Vercel Active CPU. `refresh` finns kvar för
  // admins manuella uppdatering efter att ha tagit bort ett erbjudande.

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
}

export function LivePricePanel({
  priceChange7dPercent,
  change30,
  isSingle = false,
}: LivePricePanelProps) {
  const t = useTranslations("Detail");
  const { stats, offers, flash } = useLivePricing();

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
      ? t("priceLabelSingle")
      : source && !source.live
        ? t("priceLabelEstimate", { source: source.name })
        : source
          ? t("priceLabelSingleSource", { source: source.name })
          : t("priceLabelDefault");

  return (
    <div className="card-surface mt-6 max-w-2xl">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2 px-5 py-4">
        <div>
          <p className="text-sm text-ink-muted">{priceLabel}</p>
          <p
            data-price
            className={cn(
              "mt-0.5 font-display text-3xl font-bold text-ink transition-colors duration-700",
              flash && "text-rise"
            )}
          >
            {formatPrice(stats.lowestPrice)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 pb-1">
          {stats.lowestPriceStockStatus && (
            <StockBadge stockStatus={stats.lowestPriceStockStatus} />
          )}
          {priceChange7dPercent != null && (
            <PriceChange percent={priceChange7dPercent} hideIcon />
          )}
        </div>
      </div>
      {/* Deterministisk layout (samma oavsett värdenas bredd/språk): Högsta +
          Snittpris staplade till vänster, 30-dagars uppe till höger. */}
      <dl className="flex items-start justify-between gap-4 border-t border-surface-border px-5 py-3 text-sm">
        <div className="space-y-1.5">
          <div className="flex items-baseline gap-2">
            <dt className="text-ink-faint">{t("highestNow")}</dt>
            <dd data-price className="font-semibold text-ink">
              {formatPrice(stats.highestPrice)}
            </dd>
          </div>
          <div className="flex items-baseline gap-2">
            <dt className="text-ink-faint">{t("avgPrice")}</dt>
            <dd data-price className="font-semibold text-ink">
              {formatPrice(stats.avgPrice)}
            </dd>
          </div>
        </div>
        <div className="flex shrink-0 items-baseline gap-2">
          <dt className="text-ink-faint">{t("days30")}</dt>
          <dd>
            {change30 != null ? (
              <PriceChange percent={change30} hideIcon />
            ) : (
              <span className="text-ink-faint">–</span>
            )}
          </dd>
        </div>
      </dl>
    </div>
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
}

export function LiveOffersTable({ slug, traderaSearch }: LiveOffersTableProps) {
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
    void getSession().then((s) => {
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

  // Visa alla offers med direkt produktlänk (sök-/bläddringslänkar filtreras
  // redan bort på servern; detta är en defensiv extra gallring). Pris kan
  // saknas (t.ex. helt nya kort utan marknadsdata) — då visas länken ändå med
  // "–" som pris. Prissatta offers först, billigast överst.
  const directOffers = offers
    .filter((o) => isDirectOfferUrl(o.url))
    .sort((a, b) => {
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

  return (
    <>
      <section className="mt-10">
        <h2 className="font-display text-xl font-semibold text-ink">
          {t("storePrices")}
        </h2>
        {directOffers.length === 0 ? (
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
                {/* Mobil: staplade kort (tabellen ryms inte utan sidoscroll) */}
                <div className="space-y-3 sm:hidden">
                  {shownOffers.map((offer, i) => (
                    <div
                      key={offer.id}
                      style={i >= VISIBLE_OFFERS ? revealStyle(i - VISIBLE_OFFERS) : undefined}
                      className={cn(
                        "flex items-center justify-between gap-3 rounded-xl border border-surface-border p-4",
                        i >= VISIBLE_OFFERS && REVEAL_CLASS
                      )}
                    >
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium">{offer.retailer.name}</span>
                          {affiliateIds.has(offer.retailerId) && <Badge>{t("adLink")}</Badge>}
                        </div>
                        <div className="mt-1 flex items-center gap-2">
                          <span className="font-semibold tabular-nums">
                            {offer.price != null ? formatPrice(offer.price) : "–"}
                          </span>
                          <StockBadge stockStatus={offer.stockStatus} />
                        </div>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-2">
                        <OfferClickButton slug={slug} offerId={offer.id} fallbackUrl={offer.url} />
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
                            <span className="font-medium">{offer.retailer.name}</span>
                            {affiliateIds.has(offer.retailerId) && (
                              <Badge className="ml-2">{t("adLink")}</Badge>
                            )}
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
