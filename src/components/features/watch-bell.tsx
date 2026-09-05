"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { getSharedSession } from "@/lib/client-session";
import { useRouter } from "@/i18n/navigation";
import { useAuthHint } from "@/lib/auth-hint";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { hapticTick } from "@/lib/haptics";
import { IconBell, IconBellFilled } from "@/components/ui/icons";
import { WatchBellSheet, type WatchScope } from "@/components/features/watch-bell-sheet";
import { getWatchedSetIds, setSetWatched } from "@/lib/watched-sets";
import { getWatchedProductIds, setProductWatched } from "@/lib/watched-products";
import { openPaywallOrNavigate } from "@/lib/paywall";

interface WatchBellProps {
  productId: string;
  productTitle: string;
  setId?: string | null;
  setName?: string | null;
}

/** Samma 450 ms som "+" och copy-on-hold-title — två hållgester ska kännas lika. */
const HOLD_MS = 450;
/** Över detta är gesten en SCROLL. Se kommentaren i collection-quick-add.tsx. */
const MOVE_TOLERANCE = 10;

/**
 * Klockan i produktkortets övre högra hörn: bevaka varan (kort tryck) eller välja
 * mellan varan och HELA SETET (långtryck → bottenark).
 *
 * Gestmodellen är medvetet identisk med "+"-knappen (`collection-quick-add.tsx`):
 * kort tryck gör det uppenbara direkt, långtryck öppnar valen. Två knappar på
 * samma kort som beter sig olika hade gjort båda otydliga — kommentarerna om
 * pekarfångst, suppressClick och touchAction gäller ord för ord även här.
 *
 * ⛔ RENDERAS BARA FÖR SEALED. Anroparen (ProductCard) grindar på kategori:
 * singlar och tillbehör restockar inte i butiksfeeden, så en klocka där hade
 * lovat larm som aldrig kan komma.
 */
export function WatchBell({ productId, productTitle, setId, setName }: WatchBellProps) {
  const t = useTranslations("Watch");
  const loggedIn = useAuthHint();
  const router = useRouter();
  const { toast } = useToast();
  const [itemWatched, setItemWatched] = useState(false);
  const [setWatched, setSetWatchedState] = useState(false);
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState(false);
  const [isPro, setIsPro] = useState<boolean | null>(null);

  const holdTimer = useRef<number | null>(null);
  const holdStart = useRef<{ x: number; y: number } | null>(null);
  /** Ett långtryck slutar ändå med ett `click` — utan flaggan bevakas varan också. */
  const suppressClick = useRef(false);

  const clearHold = useCallback(() => {
    if (holdTimer.current != null) {
      window.clearTimeout(holdTimer.current);
      holdTimer.current = null;
    }
    holdStart.current = null;
  }, []);

  useEffect(() => clearHold, [clearHold]);

  // Planen läses klient-sida och BARA för inloggade: kortet ligger på ISR-cachade
  // sidor, och ett sessionsanrop per kortrad var precis det som brände Active CPU.
  useEffect(() => {
    if (loggedIn !== true) return;
    void getSharedSession().then((s) => setIsPro(!!s?.user?.isPro));
  }, [loggedIn]);

  /**
   * Nuvarande läge läses via DELADE, cachade hämtningar (`lib/watched-products.ts`
   * och `lib/watched-sets.ts`). ⛔ Inte en fetch per kort: ett rutnät renderar
   * 20-40 klockor samtidigt och det hade blivit lika många parallella anrop —
   * och lika många Neon-väckningar — för samma två små listor.
   *
   * ⛔ Och den här avläsningen är inte kosmetisk: utan den startar varje klocka
   * som "obevakad" efter en omladdning, och då går bevakningen bara att slå PÅ.
   */
  useEffect(() => {
    if (loggedIn !== true) return;
    let cancelled = false;
    void getWatchedProductIds().then((ids) => {
      if (!cancelled) setItemWatched(ids.has(productId));
    });
    if (setId) {
      void getWatchedSetIds().then((ids) => {
        if (!cancelled) setSetWatchedState(ids.has(setId));
      });
    }
    return () => {
      cancelled = true;
    };
  }, [loggedIn, productId, setId]);

  const requireLogin = useCallback(() => {
    if (loggedIn === false) {
      router.push("/logga-in");
      return true;
    }
    return false;
  }, [loggedIn, router]);

  const openSheet = useCallback(() => {
    if (saving) return;
    if (requireLogin()) return;
    suppressClick.current = true;
    setOpen(true);
  }, [requireLogin, saving]);

  async function watchItem() {
    setSaving(true);
    try {
      const res = await fetch("/api/watchlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Gratiskonto: larmen avfyras ändå aldrig (de är Pro-only), så spara utan
        // larmflaggor i stället för att låtsas skapa ett larm. Samma val som
        // product-actions.tsx gör på produktsidan.
        body: JSON.stringify({ productId, restockAlert: isPro !== false, priceAlert: false }),
      });
      if (res.status === 401) {
        router.push("/logga-in");
        return;
      }
      if (res.status === 409) {
        // Redan bevakad — knappen visade fel tillstånd, inte ett fel att larma om.
        setItemWatched(true);
        return;
      }
      if (!res.ok) {
        // 403 = gratiskontots tak. ⛔ Visa ALDRIG serverns `error` rått: den är
        // hårdkodad svenska och hade läckt in i EN-läget (samma fälla som
        // product-actions.tsx dokumenterar).
        toast({
          title: res.status === 403 ? t("limitReached") : t("failed"),
          description: res.status === 403 ? t("limitReachedDesc") : undefined,
          variant: "error",
        });
        return;
      }
      setItemWatched(true);
      setProductWatched(productId, true);
      toast({ title: t("itemWatched"), variant: "success" });
    } catch {
      toast({ title: t("failed"), variant: "error" });
    } finally {
      setSaving(false);
    }
  }

  /** Slå AV produktbevakningen. Nycklad på produkt — klockan har inget rad-id. */
  async function unwatchItem() {
    setSaving(true);
    try {
      const res = await fetch(
        `/api/watchlist?productId=${encodeURIComponent(productId)}`,
        { method: "DELETE" }
      );
      if (res.status === 401) {
        router.push("/logga-in");
        return;
      }
      // 404 = raden fanns inte (borttagen i en annan flik) → knappen visade fel
      // läge, inte ett fel att larma om. Rätta läget i stället.
      if (!res.ok && res.status !== 404) {
        toast({ title: t("failed"), variant: "error" });
        return;
      }
      setItemWatched(false);
      setProductWatched(productId, false);
      toast({ title: t("itemUnwatched"), variant: "success" });
    } catch {
      toast({ title: t("failed"), variant: "error" });
    } finally {
      setSaving(false);
    }
  }

  async function toggleSetWatch() {
    if (!setId) return;
    const next = !setWatched;
    setSaving(true);
    try {
      const res = next
        ? await fetch("/api/set-watch", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ setId }),
          })
        : await fetch(`/api/set-watch/${encodeURIComponent(setId)}`, { method: "DELETE" });
      if (res.status === 401) {
        router.push("/logga-in");
        return;
      }
      if (res.status === 403) {
        openPaywallOrNavigate(router, { source: "set-watch" });
        return;
      }
      if (!res.ok) {
        toast({ title: t("failed"), variant: "error" });
        return;
      }
      setSetWatchedState(next);
      // Den delade cachen måste följa med, annars visar grannkorten i samma
      // rutnät fortfarande det gamla tillståndet tills sidan laddas om.
      setSetWatched(setId, next);
      toast({
        title: next ? t("setWatched", { set: setName ?? "" }) : t("setUnwatched"),
        variant: "success",
      });
    } catch {
      toast({ title: t("failed"), variant: "error" });
    } finally {
      setSaving(false);
    }
  }

  function onClick(e: React.MouseEvent) {
    // Kortet är en "stretched link" — utan detta navigerar klicket till produkten.
    e.preventDefault();
    e.stopPropagation();
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    if (saving) return;
    if (requireLogin()) return;
    // Knappen är en VÄXEL: samma tryck som slog på bevakningen slår av den.
    if (itemWatched) {
      void unwatchItem();
      return;
    }
    // Klockan lyser på grund av SET-bevakningen, inte produkten. Ett tryck är
    // tvetydigt då ("stäng av vad?") → visa arket i stället för att gissa. Att
    // lägga till en produktbevakning här hade sett ut som att knappen slog PÅ
    // något som redan var på.
    if (setWatched) {
      openSheet();
      return;
    }
    void watchItem();
  }

  function onPointerDown(e: React.PointerEvent<HTMLButtonElement>) {
    if (saving) return;
    if (open) {
      suppressClick.current = true;
      setOpen(false);
      return;
    }
    if (e.button !== 0) return;
    suppressClick.current = false;
    holdStart.current = { x: e.clientX, y: e.clientY };
    // Pekarfångst: 30×30 px i en 44 px träffyta, och tummen glider.
    e.currentTarget.setPointerCapture?.(e.pointerId);
    holdTimer.current = window.setTimeout(() => {
      holdTimer.current = null;
      hapticTick();
      openSheet();
    }, HOLD_MS);
  }

  function onPointerMove(e: React.PointerEvent<HTMLButtonElement>) {
    const start = holdStart.current;
    if (!start || holdTimer.current == null) return;
    if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > MOVE_TOLERANCE) {
      clearHold();
    }
  }

  const active = itemWatched || setWatched;

  return (
    <>
      <button
        type="button"
        onClick={onClick}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={clearHold}
        onPointerCancel={clearHold}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          openSheet();
        }}
        onKeyDown={(e) => {
          if (e.shiftKey && (e.key === "Enter" || e.key === " ")) {
            e.preventDefault();
            e.stopPropagation();
            openSheet();
          }
        }}
        disabled={saving}
        aria-label={active ? t("watching") : t("watch")}
        title={t("holdForOptions")}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-keyshortcuts="Shift+Enter"
        style={{ touchAction: "manipulation", WebkitTouchCallout: "none" }}
        // Absolut i bildbrunnens övre HÖGRA hörn — fyndmärket sitter uppe till
        // vänster. z-10 lyfter knappen över kortets stretched link.
        className="absolute right-0 top-0 z-10 flex h-11 w-11 items-center justify-center p-1.5"
      >
        <span
          className={cn(
            "grid h-[30px] w-[30px] place-items-center rounded-[9px] border transition-colors",
            // Halvgenomskinlig MÖRK botten i BÅDA lägena (ägaren 2026-08-06):
            // klockan ligger PÅ motivet och behöver en botten för att synas i
            // ljusa produktbilder, men den turkosa plattan gjorde den till en
            // stor färgklick i rutnätet. ⛔ Fyll aldrig plattan igen — skillnaden
            // på/av bärs av GLYFEN (ifylld kontra kontur), inte av bakgrunden.
            "border-surface-border bg-surface/80 text-holo-cyan backdrop-blur-sm",
            active && "border-holo-cyan/60",
            saving && "opacity-60",
            open && "border-holo-cyan"
          )}
        >
          {/* Tillståndet bärs HÄR: ifylld turkos klocka när den bevakas, kontur
              annars. ⛔ Ingen bock — den hade lästs som "tillagd i samlingen",
              vilket är vad "+"-knappen i samma kort gör när DEN slår om. */}
          {active ? (
            <IconBellFilled size={16} />
          ) : (
            <IconBell size={16} strokeWidth={1.9} />
          )}
        </span>
      </button>

      <WatchBellSheet
        open={open}
        onClose={() => setOpen(false)}
        // Båda valen är VÄXLAR: är det redan på stänger bekräftelsen av det.
        onConfirm={(scope: WatchScope) => {
          setOpen(false);
          if (scope === "set") void toggleSetWatch();
          else if (itemWatched) void unwatchItem();
          else void watchItem();
        }}
        productTitle={productTitle}
        setName={setName ?? null}
        setWatched={setWatched}
        itemWatched={itemWatched}
        isPro={isPro !== false}
      />
    </>
  );
}
