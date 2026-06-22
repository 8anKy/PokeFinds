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
import { hasAuthHint } from "@/lib/auth-hint";
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
            <PriceChange percent={priceChange7dPercent} hideIcon />
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

export interface LiveOffersTableProps {
  slug: string;
  /** Reserv-länk "Sök på Tradera" (sealed utan direkt Tradera-annons). */
  traderaSearch?: string | null;
}

export function LiveOffersTable({ slug, traderaSearch }: LiveOffersTableProps) {
  const { offers, updatedAt, affiliateIds, refresh } = useLivePricing();
  const [deletingId, setDeletingId] = useState<string | null>(null);
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
    if (!confirm("Ta bort detta erbjudande permanent?")) return;
    setDeletingId(offerId);
    try {
      const res = await fetch(`/api/admin/offers/${offerId}`, { method: "DELETE" });
      if (res.ok) refresh();
      else alert("Kunde inte ta bort erbjudandet.");
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
              <>
                {/* Mobil: staplade kort (tabellen ryms inte utan sidoscroll) */}
                <div className="space-y-3 sm:hidden">
                  {directOffers.map((offer) => (
                    <div
                      key={offer.id}
                      className="flex items-center justify-between gap-3 rounded-xl border border-surface-border p-4"
                    >
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium">{offer.retailer.name}</span>
                          {affiliateIds.has(offer.retailerId) && <Badge>Annonslänk</Badge>}
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
                            {deletingId === offer.id ? "Tar bort…" : "Ta bort"}
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
                        <TH>Butik</TH>
                        <TH>Pris</TH>
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
                                  {deletingId === offer.id ? "Tar bort…" : "Ta bort"}
                                </button>
                              )}
                            </div>
                          </TD>
                        </TR>
                      ))}
                    </TBody>
                  </Table>
                </div>
              </>
            )}
            <p className="mt-3 text-xs text-ink-faint">
              Alla länkar går direkt till produkten hos butiken. Vissa är
              annonslänkar — det påverkar aldrig priserna vi visar.
            </p>
          </div>
        )}
        {showTraderaSearch && (
          <a
            href={traderaSearch!}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="mt-4 inline-flex items-center gap-2 rounded-lg border border-surface-border px-4 py-2.5 text-sm font-medium text-ink-muted transition-colors hover:border-holo-cyan/60 hover:text-holo-cyan"
          >
            <IconStore size={16} /> Sök efter den här produkten på Tradera →
          </a>
        )}
      </section>

      <p className="mt-10 text-xs text-ink-faint">
        Priser uppdateras var 8:e timme · Senast uppdaterad{" "}
        {formatRelative(updatedAt)}
      </p>
    </>
  );
}
