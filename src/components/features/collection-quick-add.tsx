"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { useAuthHint } from "@/lib/auth-hint";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { hapticTick } from "@/lib/haptics";
import { IconCheck, IconPlus } from "@/components/ui/icons";
import {
  CollectionQuickAddPopover,
  type QuickAddDraft,
} from "@/components/features/collection-quick-add-popover";

interface CollectionQuickAddProps {
  productId: string;
  /** Produktens lägsta pris i öre — sparas som ögonblicksbild vid tillägg. */
  estimatedValue?: number | null;
}

/**
 * Hålltid. Samma 450 ms som `copy-on-hold-title.tsx` — två hållgester i samma app
 * ska lösa ut vid samma känsla, annars gissar fingret.
 */
const HOLD_MS = 450;
/**
 * Rörelsetolerans under hållet. Över detta är gesten en SCROLL, inte ett håll:
 * "+" sitter i ett rutnät man drar i, och en pixelperfekt tumme finns inte.
 * ⛔ Vi avbryter bara vår egen timer — INGEN preventDefault på touchmove
 * (det dödade varenda vågrätt gest i sidans topp 2026-07-29, se eca8ca8).
 */
const MOVE_TOLERANCE = 10;

/**
 * "+"-knappen i produktkortet: lägger produkten i samlingen utan att öppna den.
 *
 * KORT TRYCK = 1 ex direkt (optimistisk bock). LÅNGT TRYCK (~450 ms) = popover
 * med antal + valfritt inköpspris.
 *
 * Egen klientkomponent så att ProductCard kan förbli en serverkomponent (korten
 * renderas i hundratal — hela kortet som klientbunt vore dyrt). Inloggning läses
 * ur `fo_auth`-hinten, inte via /api/auth/session: kortet ligger på ISR-cachade
 * sidor och ett sessionsanrop per kortrad var precis det som brände Active CPU.
 * Hinten kan vara inaktuell — servern avgör ändå, och ett 401 skickar till login.
 */
export function CollectionQuickAdd({ productId, estimatedValue }: CollectionQuickAddProps) {
  const t = useTranslations("Product");
  const loggedIn = useAuthHint();
  const router = useRouter();
  const { toast } = useToast();
  const [state, setState] = useState<"idle" | "saving" | "added">("idle");
  const [open, setOpen] = useState(false);

  const buttonRef = useRef<HTMLButtonElement>(null);
  const holdTimer = useRef<number | null>(null);
  const holdStart = useRef<{ x: number; y: number } | null>(null);
  /**
   * Ett långtryck slutar ändå med ett `click` (pointerup på knappen). Utan denna
   * flagga hade hållet BÅDE öppnat popovern och lagt till 1 ex.
   */
  const suppressClick = useRef(false);

  const clearHold = useCallback(() => {
    if (holdTimer.current != null) {
      window.clearTimeout(holdTimer.current);
      holdTimer.current = null;
    }
    holdStart.current = null;
  }, []);

  // Timern överlever annars en avmontering (kortet lämnar rutnätet vid filtrering
  // eller sidbyte) och kallar setState på en död komponent.
  useEffect(() => clearHold, [clearHold]);

  const requireLogin = useCallback(() => {
    if (loggedIn === false) {
      router.push("/logga-in");
      return true;
    }
    return false;
  }, [loggedIn, router]);

  const openPopover = useCallback(() => {
    if (state === "saving") return;
    if (requireLogin()) return;
    suppressClick.current = true;
    setOpen(true);
  }, [requireLogin, state]);

  async function addToCollection(body: { quantity: number; purchasePrice?: number }) {
    setState("saving");
    try {
      const res = await fetch("/api/collection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productId,
          ...body,
          ...(estimatedValue != null ? { estimatedValue } : {}),
        }),
      });
      if (res.status === 401) {
        setState("idle");
        router.push("/logga-in");
        return;
      }
      if (!res.ok) throw new Error("add");
      setState("added");
      toast({
        title:
          body.quantity > 1
            ? t("addedToCollectionN", { count: body.quantity })
            : t("addedToCollection"),
        variant: "success",
      });
    } catch {
      setState("idle");
      toast({ title: t("addFailed"), variant: "error" });
    }
  }

  function onClick(e: React.MouseEvent) {
    // Kortet är en "stretched link" (a::after täcker hela ytan) — utan detta
    // navigerar klicket till produktsidan i stället för att spara.
    e.preventDefault();
    e.stopPropagation();
    // Klicket som avslutar ett långtryck är inte ett "lägg till 1".
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    if (state !== "idle") return;
    if (requireLogin()) return;
    void addToCollection({ quantity: 1 });
  }

  function onPointerDown(e: React.PointerEvent<HTMLButtonElement>) {
    if (state === "saving") return;
    // Andra trycket på knappen stänger en öppen popover (och klicket som följer
    // får inte lägga till 1 ex).
    if (open) {
      suppressClick.current = true;
      setOpen(false);
      return;
    }
    // Bara primärknappen: högerklick har sin egen väg via onContextMenu.
    if (e.button !== 0) return;
    // Nollställs HÄR (inte vid stängning): högerklicksvägen sätter flaggan utan
    // att något click följer, och den får inte äta nästa vänsterklick.
    suppressClick.current = false;
    holdStart.current = { x: e.clientX, y: e.clientY };
    // Pekarfångst: knappen är 30×30 px i en 44 px träffyta, och tummen glider.
    // Utan fångst tappar vi pointerup/pointermove så fort fingret lämnar den.
    e.currentTarget.setPointerCapture?.(e.pointerId);
    holdTimer.current = window.setTimeout(() => {
      holdTimer.current = null;
      // Taktil kvittens att långtrycket löste ut — arket hinner inte upp förrän
      // efter animationen, så utan den känns gesten som att inget hände.
      hapticTick();
      openPopover();
    }, HOLD_MS);
  }

  function onPointerMove(e: React.PointerEvent<HTMLButtonElement>) {
    const start = holdStart.current;
    if (!start || holdTimer.current == null) return;
    if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > MOVE_TOLERANCE) {
      // Fingret drar → låt sidan scrolla. Vi rör inte eventet, bara vår timer.
      clearHold();
    }
  }

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={onClick}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={clearHold}
        // Webbläsaren tog över gesten (scroll startade) → hållet är avblåst.
        onPointerCancel={clearHold}
        onContextMenu={(e) => {
          // Långtryck på mobil öppnar annars systemets "kopiera/spara"-meny mitt
          // över popovern. Samma event är dessutom desktopvägen in (högerklick)
          // och tangentbordets ContextMenu-knapp → öppna popovern i stället.
          e.preventDefault();
          e.stopPropagation();
          openPopover();
        }}
        onKeyDown={(e) => {
          // Tangentbordsmotsvarighet till hållet (håll-gester finns inte där).
          if (e.shiftKey && (e.key === "Enter" || e.key === " ")) {
            e.preventDefault();
            e.stopPropagation();
            openPopover();
          }
        }}
        disabled={state === "saving"}
        aria-label={state === "added" ? t("inCollection") : t("addToCollection")}
        title={t("holdForOptions")}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-keyshortcuts="Shift+Enter"
        // `manipulation` = allt utom dubbeltryck-zoom: sidan får fortfarande
        // scrolla när dragningen börjar på knappen (webbläsaren skickar då
        // pointercancel → hållet avbryts av sig självt). ⛔ Sätt INTE `none`
        // här som i copy-on-hold-title: den sitter på en rubrik man aldrig
        // scrollar från, den här knappen sitter mitt i ett rutnät.
        // touch-callout/user-select är redan avstängt globalt (globals.css).
        style={{ touchAction: "manipulation", WebkitTouchCallout: "none" }}
        // z-10 lyfter knappen över kortets stretched link.
        className="relative z-10 -my-1.5 -mr-1.5 flex h-11 w-11 shrink-0 items-center justify-center p-1.5"
      >
        <span
          className={cn(
            "grid h-[30px] w-[30px] place-items-center rounded-[9px] border transition-colors",
            state === "added"
              ? "border-holo-cyan bg-holo-cyan text-surface"
              : "border-surface-border bg-transparent text-holo-cyan",
            state === "saving" && "opacity-60",
            open && "border-holo-cyan"
          )}
        >
          {state === "added" ? (
            <IconCheck size={17} strokeWidth={2.6} />
          ) : (
            <IconPlus size={17} strokeWidth={1.9} />
          )}
        </span>
      </button>
      {/* Arket äger sin egen `open`-grind (BottomSheet returnerar null när den är
          stängd) — det behöver inte längre monteras av och på för att positionera
          sig mot knappen, som popovern gjorde. */}
      <CollectionQuickAddPopover
        open={open}
        onClose={() => setOpen(false)}
        onConfirm={(draft: QuickAddDraft) => {
          setOpen(false);
          void addToCollection(draft);
        }}
      />
    </>
  );
}
