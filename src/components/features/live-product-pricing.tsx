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
import { formatPrice, formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Badge, StockBadge } from "@/components/ui/badge";
import { PriceChange } from "@/components/ui/price-change";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty-state";
import { OfferClickButton } from "@/components/features/offer-click-button";
import { IconStore } from "@/components/ui/icons";
import { isDirectOfferUrl } from "@/lib/marketplace-urls";

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

  useEffect(() => {
    // En färsk hämtning vid sidvisning räcker — priserna uppdateras av
    // skrapjobben var 8:e timme, inte i realtid.
    void fetchOffers();
  }, [fetchOffers]);

  return (
    <LivePricingContext.Provider
      value={{ offers, stats, updatedAt, flash, affiliateIds }}
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
   * Rubrik för huvudpriset. Singlar visar Cardmarket-trend →
   * "Marknadstrend (Cardmarket)"; sealed har riktiga butikspriser → "Lägsta pris".
   */
  priceLabel?: string;
}

export function LivePricePanel({
  priceChange7dPercent,
  change30,
  priceLabel = "Lägsta pris just nu",
}: LivePricePanelProps) {
  const { stats, flash } = useLivePricing();

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
            <PriceChange percent={priceChange7dPercent} />
          )}
        </div>
      </div>
      <dl className="flex flex-wrap gap-x-8 gap-y-2 border-t border-surface-border px-5 py-3 text-sm">
        <div className="flex items-baseline gap-2">
          <dt className="text-ink-faint">Högsta nu</dt>
          <dd data-price className="font-semibold text-ink">
            {formatPrice(stats.highestPrice)}
          </dd>
        </div>
        <div className="flex items-baseline gap-2">
          <dt className="text-ink-faint">Snittpris</dt>
          <dd data-price className="font-semibold text-ink">
            {formatPrice(stats.avgPrice)}
          </dd>
        </div>
        <div className="flex items-baseline gap-2">
          <dt className="text-ink-faint">30 dagar</dt>
          <dd>
            {change30 != null ? (
              <PriceChange percent={change30} />
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

export interface LiveOffersTableProps {
  slug: string;
}

export function LiveOffersTable({ slug }: LiveOffersTableProps) {
  const { offers, updatedAt, affiliateIds } = useLivePricing();

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

  return (
    <>
      <section className="mt-10">
        <h2 className="font-display text-xl font-semibold text-ink">
          Priser hos butiker
        </h2>
        {directOffers.length === 0 ? (
          <EmptyState
            className="mt-4"
            icon={<IconStore size={32} />}
            title="Inga erbjudanden just nu"
            description="Vi har inte hittat den här produkten med en direktlänk hos någon bevakad butik ännu."
          />
        ) : (
          <div className="mt-4">
            {directOffers.length > 0 && (
              <Table>
                <THead>
                  <TR>
                    <TH>Butik</TH>
                    <TH>Pris</TH>
                    <TH>Frakt</TH>
                    <TH>Lagerstatus</TH>
                    <TH className="text-right">Länk</TH>
                  </TR>
                </THead>
                <TBody>
                  {directOffers.map((offer) => (
                    <TR key={offer.id}>
                      <TD>
                        <span className="font-medium">{offer.retailer.name}</span>
                        {affiliateIds.has(offer.retailerId) && (
                          <Badge className="ml-2">Annonslänk</Badge>
                        )}
                      </TD>
                      <TD className="font-semibold tabular-nums">
                        {offer.price != null ? formatPrice(offer.price) : "–"}
                      </TD>
                      <TD className="tabular-nums text-ink-muted">
                        {offer.shippingPrice != null
                          ? offer.shippingPrice === 0
                            ? "Fri frakt"
                            : formatPrice(offer.shippingPrice)
                          : "–"}
                      </TD>
                      <TD>
                        <StockBadge stockStatus={offer.stockStatus} />
                      </TD>
                      <TD className="text-right">
                        <OfferClickButton
                          slug={slug}
                          offerId={offer.id}
                          fallbackUrl={offer.url}
                        />
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
            <p className="mt-3 text-xs text-ink-faint">
              Alla länkar går direkt till produkten hos butiken. Vissa är
              annonslänkar — det påverkar aldrig priserna vi visar.
            </p>
          </div>
        )}
      </section>

      <p className="mt-10 text-xs text-ink-faint">
        Priser uppdateras var 8:e timme · Senast uppdaterad{" "}
        {formatRelative(updatedAt)}
      </p>
    </>
  );
}
