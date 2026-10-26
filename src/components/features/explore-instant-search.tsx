"use client";

/**
 * DIREKTSÖKET PÅ MOBIL (designpasset 2026-10-25, ägarbeslut): ett tryck i sökfältet
 * visar senaste sökningar + senast visade, och varje bokstav uppdaterar ett rutnät
 * med träffar — utan Enter och utan dropdown.
 *
 * ⛔ Träffarna kommer ur `/api/search/suggest` (serverns 24 h-index i MINNET), aldrig
 * ur katalogfeeden: en Neon-fråga per tangenttryck är precis den kostnad indexet
 * byggdes för att slippa. Priset i rutorna är indexets ögonblicksbild (≤ 24 h);
 * produktsidan visar det levande. Hela sökningen ("Visa alla …") går via katalogen.
 */

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { formatPrice } from "@/lib/format";
import { ProductCard } from "@/components/features/product-card";
import { SafeImage } from "@/components/ui/safe-image";
import { IconCards, IconClock, IconSearch, IconX } from "@/components/ui/icons";
import {
  clearRecentSearches,
  forgetSearch,
  loadRecentSearches,
  loadRecentlyViewed,
  type ViewedProduct,
} from "@/lib/search-history";

export type InstantKind = "cards" | "sealed" | null;

interface InstantItem {
  id: string;
  title: string;
  slug: string;
  imageUrl: string | null;
  setName: string | null;
  category: string;
  setId: string | null;
  setTotalCards: number | null;
  cardName: string | null;
  cardNumber: string | null;
  cardRarity: string | null;
  variantLabel: string | null;
  lowestPrice: number | null;
  stockStatus?: string | null;
  priceChange7d?: number | null;
}

const MIN_QUERY = 2;
/** Kort: indexet svarar på ~1 ms, väntan är bara för att inte skicka varje halvskrivet ord. */
const DEBOUNCE_MS = 60;
const LIMIT = 24;
const CACHE_MAX = 60;

/** Senaste sökningar + senast visade — det man ser innan man skrivit något. */
export function SearchRecents({ onPick }: { onPick: (query: string) => void }) {
  const t = useTranslations("Products");
  const [searches, setSearches] = useState<string[]>([]);
  const [viewed, setViewed] = useState<ViewedProduct[]>([]);

  useEffect(() => {
    setSearches(loadRecentSearches());
    setViewed(loadRecentlyViewed());
  }, []);

  if (searches.length === 0 && viewed.length === 0) {
    return <p className="px-1 pt-6 text-center text-sm text-ink-faint">{t("searchHint")}</p>;
  }

  return (
    <div className="space-y-6 pb-8 pt-2">
      {searches.length > 0 && (
        <section>
          <div className="mb-1 flex items-center justify-between px-1">
            <h2 className="text-[13px] font-semibold text-ink">{t("recentSearches")}</h2>
            <button
              type="button"
              onClick={() => {
                clearRecentSearches();
                setSearches([]);
              }}
              className="px-1 py-1.5 text-[13px] font-medium text-holo-cyan"
            >
              {t("clear")}
            </button>
          </div>
          <ul className="divide-y divide-surface-border/60">
            {searches.map((q) => (
              <li key={q} className="flex items-center">
                <button
                  type="button"
                  onClick={() => onPick(q)}
                  className="flex min-w-0 flex-1 items-center gap-3 px-1 py-3 text-left"
                >
                  <IconClock size={17} className="shrink-0 text-ink-faint" />
                  <span className="truncate text-[15px] text-ink">{q}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setSearches(forgetSearch(q))}
                  aria-label={t("removeRecentAria", { query: q })}
                  className="grid h-11 w-11 shrink-0 place-items-center text-ink-faint"
                >
                  <IconX size={15} />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {viewed.length > 0 && (
        <section>
          <h2 className="mb-2.5 px-1 text-[13px] font-semibold text-ink">{t("recentlyViewed")}</h2>
          <div
            className="-mx-2.5 flex gap-2.5 overflow-x-auto px-2.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            style={{ touchAction: "pan-x pan-y" }}
          >
            {viewed.map((p) => (
              <Link
                key={p.slug}
                href={`/produkter/${p.slug}`}
                prefetch={false}
                className="w-[88px] shrink-0"
              >
                <span className="block aspect-[5/7] overflow-hidden rounded-lg ring-1 ring-surface-border">
                  <SafeImage
                    src={p.imageUrl}
                    alt=""
                    className="h-full w-full object-contain"
                    fallback={
                      <span className="grid h-full w-full place-items-center text-ink-faint">
                        <IconCards size={18} />
                      </span>
                    }
                  />
                </span>
                <span className="mt-1.5 block truncate text-[12px] text-ink-muted">{p.title}</span>
                <span className="block text-[12px] font-semibold tabular-nums text-ink">
                  {formatPrice(p.price)}
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

/** Rutnätet som uppdateras för varje bokstav. */
export function InstantResults({
  query,
  kind,
  setIds,
  lang = null,
  onTotal,
  onShowAll,
}: {
  query: string;
  kind: InstantKind;
  setIds: string[];
  /** "EN"/"JP" eller null = alla språk. */
  lang?: string | null;
  /** Antal träffar totalt (inte bara de som visas). */
  onTotal?: (total: number | null) => void;
  onShowAll: () => void;
}) {
  const t = useTranslations("Products");
  const cacheRef = useRef(new Map<string, { items: InstantItem[]; total: number }>());
  const [items, setItems] = useState<InstantItem[] | null>(null);
  const onTotalRef = useRef(onTotal);
  onTotalRef.current = onTotal;
  const q = query.trim();
  const key = [q.toLowerCase(), kind ?? "", setIds.join(","), lang ?? ""].join("|");

  useEffect(() => {
    if (q.length < MIN_QUERY) {
      setItems(null);
      onTotalRef.current?.(null);
      return;
    }
    const cached = cacheRef.current.get(key);
    if (cached) {
      setItems(cached.items);
      onTotalRef.current?.(cached.total);
      return;
    }
    // Direkt i klienten medan nätet svarar: en längre fråga är en DELMÄNGD av den
    // kortare, så de rutor som redan visas och fortfarande matchar ligger kvar —
    // rutnätet krymper för varje bokstav i stället för att vänta.
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    setItems((prev) => (prev ? prev.filter((p) => words.every((w) => p.title.toLowerCase().includes(w))) : prev));
    const ctrl = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const usp = new URLSearchParams({ q, limit: String(LIMIT) });
        if (kind) usp.set("kind", kind);
        if (setIds.length > 0) usp.set("sets", setIds.join(","));
        if (lang) usp.set("lang", lang);
        const res = await fetch(`/api/search/suggest?${usp}`, { signal: ctrl.signal });
        if (!res.ok) return;
        const data = (await res.json()) as { items: InstantItem[]; total?: number };
        const total = data.total ?? data.items.length;
        if (cacheRef.current.size >= CACHE_MAX) cacheRef.current.clear();
        cacheRef.current.set(key, { items: data.items, total });
        setItems(data.items);
        onTotalRef.current?.(total);
      } catch {
        // avbruten/nätverksfel — behåll det som visas
      }
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  if (q.length < MIN_QUERY) return null;

  return (
    <div className="pb-10 pt-1">
      {items && items.length === 0 ? (
        <p className="px-1 pt-6 text-center text-sm text-ink-muted">{t("instantEmpty")}</p>
      ) : (
        <div className={cn("grid grid-cols-2 gap-2.5 transition-opacity", items === null && "opacity-50")}>
          {(items ?? []).map((p, i) => (
            <ProductCard
              key={p.id}
              priority={i < 4}
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
                priceChange7d: p.priceChange7d ?? null,
                stockStatus: p.stockStatus ?? null,
              }}
            />
          ))}
        </div>
      )}
      <button
        type="button"
        onClick={onShowAll}
        className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl border border-surface-border px-4 py-3.5 text-sm font-semibold text-holo-cyan"
      >
        <IconSearch size={16} />
        {t("suggestShowAll", { query: q })}
      </button>
    </div>
  );
}
