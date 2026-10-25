"use client";

import { useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Link, useRouter } from "@/i18n/navigation";
import { formatPrice } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ApiError, apiFetch } from "@/lib/client-api";
import { openPaywallOrNavigate } from "@/lib/paywall";
import { FREE_RESTOCK_ALERT_DELAY_MINUTES, FREE_RESTOCK_ALERT_LIMIT_CODE } from "@/lib/free-restock-alert";
import { priceAlertsPausedClient } from "@/lib/price-alerts-pause";
import { setSetWatched } from "@/lib/watched-sets";
import { parseKronorToOre } from "@/lib/purchase-price";
import { useToast } from "@/components/ui/toast";
import { SafeImage } from "@/components/ui/safe-image";
import { IconCards, IconChevronRight, IconLock, IconPackage, IconTrash } from "@/components/ui/icons";

export interface WatchlistRow {
  id: string;
  targetPrice: number | null; // öre
  restockAlert: boolean;
  priceAlert: boolean;
  isPaused: boolean;
  /** ISO. Gratiskontots ena larm = det äldsta med restock på (free-restock-alert.ts). */
  createdAt: string;
  product: {
    id: string;
    title: string;
    slug: string;
    imageUrl: string | null;
    category: string;
    lowestPrice: number | null; // öre
    setName: string | null;
    /** Butiker med en köpbar offer (i lager, direktlänk, > 0 kr). */
    inStockCount: number;
  };
  /** Lägsta KÖPBARA offer (samma urval som produktsidans rubrik) — "Köp hos …". */
  buy: { offerId: string; retailerName: string; price: number; url: string } | null;
  /** Lägsta dagsnotering senaste 30 dygnen (öre), för prislarmets ledtext. */
  low30: number | null;
}

export interface WatchedSetRow {
  setId: string;
  name: string;
  series: string;
  logoUrl: string | null;
  sealedCount: number;
  inStockCount: number;
  isPaused: boolean;
}

/**
 * BEVAKNINGAR SOM STORA KORT (designpasset 2026-10-25, ägarbeslut): varje bevakning
 * bär sina egna knappar — Restock, Prislarm, Pausa — så inget göms i ett ark. EN
 * accentfärg för allt som är påslaget, pausat är vitt, och bara priset (ingen procent).
 * I lager först, slut sen, pausat sist — ordningen sätts när sidan laddas och står
 * sedan still, annars hoppar kortet man just tryckt på iväg.
 *
 * Gratiskontot: ETT restock-larm (det äldsta med restock på) levereras 4 min efter Pro;
 * övriga visar ett lås och leder till paywall-arket — samma dom som `restockWatchersFor`.
 */
export function WatchlistTable({
  initialItems,
  initialSets,
  isPro,
  restockPaused,
}: {
  initialItems: WatchlistRow[];
  initialSets: WatchedSetRow[];
  isPro: boolean;
  /** Restock-larmen avstängda → reglaget låses och visas som pausat. */
  restockPaused: boolean;
}) {
  const t = useTranslations("Watchlist");
  const [tab, setTab] = useState<"products" | "sets">(
    initialItems.length === 0 && initialSets.length > 0 ? "sets" : "products"
  );

  return (
    <div>
      <div
        role="tablist"
        aria-label={t("tabsAria")}
        className="mb-3 grid grid-cols-2 gap-0.5 rounded-[10px] bg-surface-overlay p-0.5 lg:max-w-sm"
      >
        {(["products", "sets"] as const).map((k) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={tab === k}
            onClick={() => setTab(k)}
            className={cn(
              "h-[34px] rounded-lg text-[15px] font-semibold text-ink transition-colors",
              tab === k ? "bg-surface-border" : "bg-transparent"
            )}
          >
            {k === "products" ? t("tabProducts") : t("tabSets")}
          </button>
        ))}
      </div>
      {tab === "products" ? (
        <ProductCards initialItems={initialItems} isPro={isPro} restockPaused={restockPaused} />
      ) : (
        <SetCards initialSets={initialSets} restockPaused={restockPaused} />
      )}
    </div>
  );
}

/* ─────────────────────────── produkter ─────────────────────────── */

function rank(item: WatchlistRow): number {
  if (item.isPaused) return 2;
  return item.product.inStockCount > 0 ? 0 : 1;
}

function ProductCards({
  initialItems,
  isPro,
  restockPaused,
}: {
  initialItems: WatchlistRow[];
  isPro: boolean;
  restockPaused: boolean;
}) {
  const t = useTranslations("Watchlist");
  const tPause = useTranslations("RestockPause");
  // ⛔ LÄSES HÄR, INTE SOM PROP — flaggan finns redan i bundlen via speglingen i next.config.mjs.
  const pricePaused = priceAlertsPausedClient();
  const { toast } = useToast();
  const router = useRouter();
  // Ordningen sätts EN gång (se filhuvudet); listan ändrar sedan bara innehåll.
  const [items, setItems] = useState(() =>
    [...initialItems].sort((a, b) => rank(a) - rank(b) || b.createdAt.localeCompare(a.createdAt))
  );
  const [removed, setRemoved] = useState<Record<string, WatchlistRow>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  async function patchItem(id: string, body: Record<string, unknown>, successTitle?: string) {
    setBusyId(id);
    try {
      const updated = await apiFetch<WatchlistRow & { restockAlertDenied?: boolean }>(`/api/watchlist/${id}`, {
        method: "PATCH",
        body,
      });
      setItems((prev) =>
        prev.map((it) =>
          it.id === id
            ? {
                ...it,
                targetPrice: updated.targetPrice ?? null,
                restockAlert: updated.restockAlert,
                priceAlert: updated.priceAlert,
                isPaused: updated.isPaused,
              }
            : it
        )
      );
      // Sparat, men gratiskontots enda larm sitter på en annan bevakning — larmet
      // startar med Pro. Paywall-arket, inte ett fel.
      if (updated.restockAlertDenied) {
        openPaywallOrNavigate(router, { source: "free-restock-limit" });
        return;
      }
      if (successTitle) toast({ title: successTitle, variant: "success" });
    } catch (e) {
      if (e instanceof ApiError && e.code === FREE_RESTOCK_ALERT_LIMIT_CODE) {
        openPaywallOrNavigate(router, { source: "free-restock-limit" });
        return;
      }
      toast({ title: t("updateFail"), description: e instanceof Error ? e.message : undefined, variant: "error" });
    } finally {
      setBusyId(null);
    }
  }

  /**
   * ETT TRYCK TAR BORT (ägarbeslut 2026-09-07). Kortet blir en streckad rad med Ångra
   * på SAMMA plats — inte bara i en toast som försvinner.
   */
  async function removeWatch(item: WatchlistRow) {
    setRemoved((r) => ({ ...r, [item.id]: item }));
    try {
      await apiFetch(`/api/watchlist/${item.id}`, { method: "DELETE" });
      router.refresh();
    } catch (e) {
      setRemoved((r) => {
        const { [item.id]: _gone, ...rest } = r;
        return rest;
      });
      toast({ title: t("removeFail"), description: e instanceof Error ? e.message : undefined, variant: "error" });
    }
  }

  async function undoRemove(item: WatchlistRow) {
    try {
      const restored = await apiFetch<{ id: string }>("/api/watchlist", {
        method: "POST",
        body: {
          productId: item.product.id,
          ...(item.targetPrice != null ? { targetPrice: item.targetPrice } : {}),
          restockAlert: item.restockAlert,
          priceAlert: item.priceAlert,
        },
      });
      // Pausläget finns inte i POST-schemat — utan den här raden vaknar en pausad
      // bevakning till liv av ett ångra.
      if (item.isPaused) {
        await apiFetch(`/api/watchlist/${restored.id}`, { method: "PATCH", body: { isPaused: true } });
      }
      setItems((prev) => prev.map((it) => (it.id === item.id ? { ...item, id: restored.id } : it)));
      setRemoved((r) => {
        const { [item.id]: _gone, ...rest } = r;
        return rest;
      });
      router.refresh();
    } catch (e) {
      toast({ title: t("restoreFail"), description: e instanceof Error ? e.message : undefined, variant: "error" });
    }
  }

  // Gratiskontot: bara den ÄLDSTA med restock på larmar (samma dom som restockWatchersFor).
  const freeActiveId = isPro
    ? null
    : (items
        .filter((it) => it.restockAlert && !it.isPaused && !removed[it.id])
        .reduce<WatchlistRow | null>((a, b) => (!a || b.createdAt < a.createdAt ? b : a), null)?.id ?? null);

  if (items.length === 0) return <p className="py-10 text-center text-sm text-ink-muted">{t("emptyProducts")}</p>;

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      {items.map((item) => {
        const gone = removed[item.id];
        if (gone) {
          return (
            <div
              key={item.id}
              className="flex h-16 items-center justify-between rounded-[22px] border border-dashed border-surface-border px-[18px]"
            >
              <span className="min-w-0 truncate text-[15px] text-ink-faint">{t("removedInline", { name: item.product.title })}</span>
              <button type="button" onClick={() => void undoRemove(gone)} className="h-11 shrink-0 pl-3 text-base font-bold text-holo-cyan">
                {t("undo")}
              </button>
            </div>
          );
        }
        const paused = item.isPaused;
        const busy = busyId === item.id;
        const restockLocked = !isPro && freeActiveId !== null && item.id !== freeActiveId;
        const isFreeActive = !isPro && item.id === freeActiveId;
        const restockOn = item.restockAlert && !restockLocked && !restockPaused;
        const priceOn = isPro && item.priceAlert && !pricePaused;
        const canBuy = !!item.buy && !paused;
        const status = paused
          ? { text: t("statusPaused"), on: false }
          : item.product.inStockCount > 0
            ? { text: t("statusInStock", { count: item.product.inStockCount }), on: true }
            : { text: t("statusSoldOut"), on: false };

        return (
          <article key={item.id} className="flex flex-col gap-3.5 rounded-[22px] border border-surface-overlay bg-[#0e0e11] p-4">
            <Link
              href={`/produkter/${item.product.slug}`}
              prefetch={false}
              className={cn("flex items-center gap-4 text-ink transition-opacity", paused && "opacity-45")}
            >
              <span className="flex h-[92px] w-[68px] shrink-0 items-center justify-center">
                <SafeImage
                  src={item.product.imageUrl}
                  alt=""
                  className="max-h-[92px] max-w-[68px] rounded-md object-contain shadow-[0_8px_20px_rgba(0,0,0,0.5)]"
                  fallback={
                    <span className="grid h-[92px] w-[68px] place-items-center rounded-md bg-surface-overlay text-ink-faint">
                      {item.product.category === "SINGLE_CARD" ? <IconCards size={20} /> : <IconPackage size={20} />}
                    </span>
                  }
                />
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="line-clamp-2 text-lg font-bold leading-[22px]">{item.product.title}</span>
                <span data-price className="text-2xl font-extrabold tracking-[-0.02em] tabular-nums">
                  {formatPrice(item.product.lowestPrice)}
                </span>
                <span className={cn("flex items-center gap-1.5 text-sm", status.on ? "text-holo-cyan" : "text-ink-faint")}>
                  <span className={cn("h-[7px] w-[7px] shrink-0 rounded-full", status.on ? "bg-holo-cyan" : "bg-ink-faint")} />
                  <span className="truncate">{status.text}</span>
                </span>
              </span>
            </Link>

            {canBuy && item.buy && (
              <BuyButton slug={item.product.slug} offer={item.buy} label={t("buyAt", { store: item.buy.retailerName })} />
            )}

            <div className="grid grid-cols-3 gap-2">
              <ToggleButton
                on={restockOn}
                dim={paused}
                disabled={busy || paused || restockPaused}
                onClick={() => {
                  if (restockLocked) {
                    openPaywallOrNavigate(router, { source: "free-restock-limit" });
                    return;
                  }
                  void patchItem(item.id, { restockAlert: !item.restockAlert }, !item.restockAlert ? t("restockOn") : t("restockOff"));
                }}
                icon={restockLocked ? <LockGlyph /> : <BellGlyph />}
                label={restockLocked ? t("restockLocked") : item.restockAlert ? t("restockOnShort") : t("restockOffShort")}
                sub={
                  restockPaused
                    ? tPause("tag")
                    : restockLocked
                      ? t("proSub")
                      : isFreeActive && item.restockAlert
                        ? t("freeDelaySub", { minutes: FREE_RESTOCK_ALERT_DELAY_MINUTES })
                        : undefined
                }
                locked={restockLocked}
              />
              <ToggleButton
                on={priceOn}
                dim={paused}
                disabled={busy || paused || pricePaused}
                onClick={() => {
                  if (!isPro) {
                    openPaywallOrNavigate(router, { source: "watchlist-price" });
                    return;
                  }
                  void patchItem(item.id, { priceAlert: !item.priceAlert }, !item.priceAlert ? t("priceOn") : t("priceOff"));
                }}
                icon={!isPro ? <LockGlyph /> : <TagGlyph />}
                label={!isPro ? t("priceLocked") : item.priceAlert ? t("priceOnShort") : t("priceOffShort")}
                sub={pricePaused ? tPause("tag") : !isPro ? t("proSub") : undefined}
                locked={!isPro}
              />
              <ToggleButton
                on={paused}
                tone="white"
                disabled={busy}
                onClick={() => void patchItem(item.id, { isPaused: !paused }, paused ? t("resumed") : t("pausedToast"))}
                icon={paused ? <PlayGlyph /> : <PauseGlyph />}
                label={paused ? t("resume") : t("pause")}
              />
            </div>

            {priceOn && !paused && (
              <TargetField
                item={item}
                onSave={(ore) => void patchItem(item.id, { targetPrice: ore }, t("targetSaved"))}
              />
            )}

            {restockLocked && !paused && (
              <button
                type="button"
                onClick={() => openPaywallOrNavigate(router, { source: "free-restock-limit" })}
                className="flex items-center gap-2.5 rounded-2xl bg-white/[0.05] px-3.5 py-3 text-left"
              >
                <span className="rounded bg-holo-cyan px-[5px] py-0.5 text-[10px] font-extrabold tracking-[0.04em] text-surface">PRO</span>
                <span className="flex-1 text-[13px] leading-[18px] text-ink-muted">{t("lockNote")}</span>
                <IconChevronRight size={14} className="shrink-0 text-holo-cyan" />
              </button>
            )}

            <button
              type="button"
              onClick={() => void removeWatch(item)}
              className="flex h-9 items-center gap-1.5 self-center text-sm font-semibold text-ink-faint transition-colors hover:text-ink"
            >
              <IconTrash size={14} />
              {t("stopWatching")}
            </button>
          </article>
        );
      })}
    </div>
  );
}

function BuyButton({
  slug,
  offer,
  label,
}: {
  slug: string;
  offer: NonNullable<WatchlistRow["buy"]>;
  label: string;
}) {
  // Samma väg som produktsidans butikslista: klicket registreras och vi får butikens
  // (eventuellt affiliate-) URL tillbaka. Fliken öppnas SYNKRONT i klicket — mobila
  // webbläsare blockerar window.open efter en await.
  async function open() {
    const win = window.open("about:blank", "_blank");
    if (win) win.opener = null;
    let url = offer.url;
    try {
      const res = await fetch(`/api/products/${slug}/click`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ offerId: offer.offerId }),
      });
      const data: { url?: string } = await res.json().catch(() => ({}));
      url = data.url ?? offer.url;
    } catch {
      /* butikens egen länk duger */
    }
    if (win) win.location.href = url;
    else window.location.href = url;
  }
  return (
    <button
      type="button"
      onClick={() => void open()}
      className="flex h-[52px] items-center justify-between rounded-2xl bg-holo-cyan px-4 text-base font-extrabold text-surface active:opacity-90"
    >
      <span className="truncate">{label}</span>
      <span className="flex shrink-0 items-center gap-2 tabular-nums">
        {formatPrice(offer.price)}
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M7 17L17 7M9 7h8v8" />
        </svg>
      </span>
    </button>
  );
}

function TargetField({ item, onSave }: { item: WatchlistRow; onSave: (ore: number | null) => void }) {
  const t = useTranslations("Watchlist");
  const initial = item.targetPrice != null ? String(Math.round(item.targetPrice / 100)) : "";
  const [text, setText] = useState(initial);
  const commit = () => {
    const trimmed = text.trim();
    if (trimmed === initial) return;
    if (!trimmed) return onSave(null);
    const parsed = parseKronorToOre(trimmed);
    if (parsed.kind === "ok") onSave(parsed.ore);
    else setText(initial);
  };
  return (
    <label className="flex h-[58px] items-center justify-between gap-3 rounded-2xl bg-white/[0.05] px-4">
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="text-[15px] font-semibold text-ink">{t("alertBelow")}</span>
        <span className="truncate text-xs text-ink-faint">
          {item.low30 != null ? t("low30", { price: formatPrice(item.low30) }) : t("targetEmptyHint")}
        </span>
      </span>
      <span className="flex items-baseline gap-1.5">
        <input
          type="text"
          inputMode="numeric"
          enterKeyHint="done"
          aria-label={t("targetAria")}
          value={text}
          placeholder="–"
          onChange={(e) => setText(e.target.value.replace(/[^\d\s,.]/g, ""))}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
          className="w-[110px] bg-transparent text-right text-[22px] font-extrabold tabular-nums text-ink outline-none placeholder:text-ink-faint"
        />
        <span className="text-base font-semibold text-ink-muted">kr</span>
      </span>
    </label>
  );
}

/* ───────────────────────────── set ───────────────────────────── */

function SetCards({ initialSets, restockPaused }: { initialSets: WatchedSetRow[]; restockPaused: boolean }) {
  const t = useTranslations("Watchlist");
  const tw = useTranslations("Watch");
  const { toast } = useToast();
  const [sets, setSets] = useState(initialSets);
  const [removed, setRemoved] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<string | null>(null);

  async function togglePause(s: WatchedSetRow) {
    setBusy(s.setId);
    try {
      const res = await fetch(`/api/set-watch/${encodeURIComponent(s.setId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isPaused: !s.isPaused }),
      });
      if (!res.ok) throw new Error("pause");
      setSets((prev) => prev.map((x) => (x.setId === s.setId ? { ...x, isPaused: !s.isPaused } : x)));
      toast({ title: s.isPaused ? t("resumed") : t("pausedToast"), variant: "success" });
    } catch {
      toast({ title: tw("failed"), variant: "error" });
    } finally {
      setBusy(null);
    }
  }

  async function remove(s: WatchedSetRow) {
    setRemoved((r) => ({ ...r, [s.setId]: true }));
    try {
      const res = await fetch(`/api/set-watch/${encodeURIComponent(s.setId)}`, { method: "DELETE" });
      if (!res.ok) throw new Error("remove");
      setSetWatched(s.setId, false);
    } catch {
      setRemoved((r) => ({ ...r, [s.setId]: false }));
      toast({ title: tw("failed"), variant: "error" });
    }
  }

  async function undo(s: WatchedSetRow) {
    try {
      const res = await fetch(`/api/set-watch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ setId: s.setId }),
      });
      if (!res.ok) throw new Error("undo");
      if (s.isPaused) {
        await fetch(`/api/set-watch/${encodeURIComponent(s.setId)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ isPaused: true }),
        });
      }
      setSetWatched(s.setId, true);
      setRemoved((r) => ({ ...r, [s.setId]: false }));
    } catch {
      toast({ title: t("restoreFail"), variant: "error" });
    }
  }

  if (sets.length === 0) return <p className="py-10 text-center text-sm text-ink-muted">{t("setsEmpty")}</p>;

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      {sets.map((s) => {
        if (removed[s.setId]) {
          return (
            <div
              key={s.setId}
              className="flex h-16 items-center justify-between rounded-[22px] border border-dashed border-surface-border px-[18px]"
            >
              <span className="min-w-0 truncate text-[15px] text-ink-faint">{t("removedInline", { name: s.name })}</span>
              <button type="button" onClick={() => void undo(s)} className="h-11 shrink-0 pl-3 text-base font-bold text-holo-cyan">
                {t("undo")}
              </button>
            </div>
          );
        }
        const inStock = !s.isPaused && s.inStockCount > 0;
        const status = s.isPaused
          ? t("statusPaused")
          : restockPaused
            ? t("setStatus", { count: s.sealedCount })
            : `${t("setStatus", { count: s.sealedCount })}${s.inStockCount > 0 ? t("setInStock", { count: s.inStockCount }) : ""}`;
        return (
          <article key={s.setId} className="flex flex-col gap-3.5 rounded-[22px] border border-surface-overlay bg-[#0e0e11] p-4">
            <Link
              href={`/sets/${s.setId}`}
              className={cn("flex items-center gap-4 text-ink transition-opacity", s.isPaused && "opacity-45")}
            >
              <span className="flex h-[68px] w-[92px] shrink-0 items-center justify-center">
                <SafeImage
                  src={s.logoUrl}
                  alt=""
                  className="max-h-[68px] max-w-[92px] object-contain"
                  fallback={<IconCards size={22} className="text-ink-faint" />}
                />
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="line-clamp-2 text-lg font-bold leading-[22px]">{s.name}</span>
                <span className="truncate text-xs text-ink-faint">{s.series}</span>
                <span className={cn("flex items-center gap-1.5 text-sm", inStock ? "text-holo-cyan" : "text-ink-faint")}>
                  <span className={cn("h-[7px] w-[7px] shrink-0 rounded-full", inStock ? "bg-holo-cyan" : "bg-ink-faint")} />
                  <span className="truncate">{status}</span>
                </span>
              </span>
            </Link>
            <div className="grid grid-cols-2 gap-2">
              <Link
                href={`/sets/${s.setId}`}
                className={cn(
                  "flex h-16 flex-col items-center justify-center gap-1 rounded-2xl bg-white/[0.05] text-[13px] font-bold text-ink-muted",
                  s.isPaused && "opacity-45"
                )}
              >
                <IconCards size={19} />
                {t("viewSet")}
              </Link>
              <ToggleButton
                on={s.isPaused}
                tone="white"
                disabled={busy === s.setId}
                onClick={() => void togglePause(s)}
                icon={s.isPaused ? <PlayGlyph /> : <PauseGlyph />}
                label={s.isPaused ? t("resume") : t("pause")}
              />
            </div>
            <button
              type="button"
              onClick={() => void remove(s)}
              className="flex h-9 items-center gap-1.5 self-center text-sm font-semibold text-ink-faint transition-colors hover:text-ink"
            >
              <IconTrash size={14} />
              {t("stopWatchingSet")}
            </button>
          </article>
        );
      })}
    </div>
  );
}

/* ──────────────────────────── knappar ──────────────────────────── */

/** 64 px knapp: turkos när PÅ, vit när pausad (`tone="white"`), annars grå. */
function ToggleButton({
  on,
  onClick,
  icon,
  label,
  sub,
  disabled,
  dim = false,
  locked = false,
  tone = "accent",
}: {
  on: boolean;
  onClick: () => void;
  icon: ReactNode;
  label: string;
  sub?: string;
  disabled?: boolean;
  dim?: boolean;
  locked?: boolean;
  tone?: "accent" | "white";
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      // Ett låst reglage ska gå att trycka på — det leder till paywall-arket.
      disabled={disabled && !locked}
      onClick={onClick}
      className={cn(
        "flex h-16 flex-col items-center justify-center gap-1 rounded-2xl border text-[13px] font-bold transition-colors disabled:cursor-default",
        on
          ? tone === "white"
            ? "border-white/30 bg-white/[0.14] text-ink"
            : "border-holo-cyan/45 bg-holo-cyan/[0.14] text-holo-cyan"
          : locked
            ? "border-transparent bg-white/[0.05] text-ink-faint"
            : "border-transparent bg-white/[0.05] text-ink-muted",
        dim && "opacity-45"
      )}
    >
      {icon}
      <span className="leading-[1.1]">{label}</span>
      {sub && <span className="text-[10px] font-semibold leading-none opacity-80">{sub}</span>}
    </button>
  );
}

function BellGlyph() {
  return (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
      <path d="M6 16V11a6 6 0 0112 0v5l1.5 2h-15z" />
      <path d="M10 20.5a2 2 0 004 0" />
    </svg>
  );
}
function TagGlyph() {
  return (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
      <path d="M3 12V4h8l10 10-8 8z" />
      <circle cx="7.5" cy="8.5" r="1.4" />
    </svg>
  );
}
function PauseGlyph() {
  return (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true">
      <path d="M9 6v12M15 6v12" />
    </svg>
  );
}
function PlayGlyph() {
  return (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M8 5.5v13l11-6.5z" />
    </svg>
  );
}
function LockGlyph() {
  return <IconLock size={19} />;
}
