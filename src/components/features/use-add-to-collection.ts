"use client";

/**
 * EN väg in i samlingen för produktkortets "+" och produktsidans knapp (2026-10-25):
 * POST, kvitto med ÅNGRA, och kortet som flyger till Samling-fliken med "+N".
 *
 * ⛔ Ångra drar av exakt det som lades till — svaret är antingen en ny post eller en
 * befintlig lot som stackades (samma pris ⇒ +antal, collection-lots.ts), så ett
 * ångra får aldrig radera någon annans exemplar.
 */
import { useCallback } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { useToast } from "@/components/ui/toast";
import { clearSetCompletionCache } from "@/lib/set-completion";
import { previewSlabIfFree } from "@/lib/slab-preview";
import type { QuickAddDraft, QuickAddMeta } from "@/components/features/collection-quick-add-popover";

export interface AddToCollectionInput {
  productId: string;
  draft: QuickAddDraft;
  meta?: QuickAddMeta;
  title: string;
  imageUrl?: string | null;
  /** Ögonblicksbild av värdet (öre) — bara när posten är produkten själv. */
  estimatedValue?: number | null;
  /** Där kortet lyfter ifrån (knappen i rutnätet). Utan: underkanten, där arket var. */
  flyFrom?: Element | null;
  /** Körs när ett ångra lyckats (knappen går tillbaka från bock till "+"). */
  onUndone?: () => void;
}

export type AddResult = { status: "added"; itemId: string | null } | { status: "login" } | { status: "failed" };

export function useAddToCollection() {
  const t = useTranslations("Product");
  const tc = useTranslations("Common");
  const router = useRouter();
  const { toast } = useToast();

  const undo = useCallback(
    async (itemId: string, savedQuantity: number, addedQuantity: number, onUndone?: () => void) => {
      try {
        const remaining = savedQuantity - addedQuantity;
        const res =
          remaining > 0
            ? await fetch(`/api/collection/${itemId}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ quantity: remaining }),
              })
            : await fetch(`/api/collection/${itemId}`, { method: "DELETE" });
        if (!res.ok) throw new Error("undo");
        clearSetCompletionCache();
        onUndone?.();
        toast({ title: t("addUndone"), variant: "default" });
      } catch {
        toast({ title: t("addUndoFailed"), variant: "error" });
      }
    },
    [t, toast]
  );

  return useCallback(
    async (input: AddToCollectionInput): Promise<AddResult> => {
      const { draft, meta } = input;
      const target = draft.productId ?? input.productId;
      try {
        const res = await fetch("/api/collection", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...draft,
            productId: target,
            ...(input.estimatedValue != null && target === input.productId ? { estimatedValue: input.estimatedValue } : {}),
          }),
        });
        if (res.status === 401) {
          router.push("/logga-in");
          return { status: "login" };
        }
        if (!res.ok) throw new Error("add");
        const saved = (await res.json().catch(() => null)) as { id?: string; quantity?: number } | null;
        // Set-kompletteringen cachas 60 s i klienten — annars står stapeln kvar på
        // gamla siffror på exakt den sida man tänkte se dem ändras.
        clearSetCompletionCache();
        flyToCollectionTab(input.imageUrl ?? null, input.flyFrom ?? null, draft.quantity);
        const count = meta?.ownedBefore != null ? meta.ownedBefore + draft.quantity : null;
        toast({
          title: meta?.portfolioName
            ? t("addedTo", { portfolio: meta.portfolioName })
            : draft.quantity > 1
              ? t("addedToCollectionN", { count: draft.quantity })
              : t("addedToCollection"),
          description: t("addedToDesc", {
            name: input.title,
            detail: meta?.detailLabel ?? "",
            hasDetail: meta?.detailLabel ? "yes" : "no",
            count: count ?? 0,
            hasCount: count != null ? "yes" : "no",
          }),
          variant: "success",
          // ⛔ Ett tillägg har ingen bekräftelsedialog (ägarbeslut 2026-09-05) —
          // ångra-knappen är säkerhetsnätet i stället.
          action: saved?.id
            ? { label: tc("undo"), onClick: () => void undo(saved.id!, saved.quantity ?? draft.quantity, draft.quantity, input.onUndone) }
            : undefined,
        });
        void previewSlabIfFree(router, {
          name: input.title,
          imageUrl: input.imageUrl ?? null,
          gradingCompany: draft.gradingCompany,
          grade: draft.grade,
        });
        return { status: "added", itemId: saved?.id ?? null };
      } catch {
        toast({ title: t("addFailed"), variant: "error" });
        return { status: "failed" };
      }
    },
    [router, t, tc, toast, undo]
  );
}

/**
 * Kortet flyger till Samling-fliken och fliken visar "+N". Rent dekorativt: saknas
 * fliken (desktop) eller vill användaren ha mindre rörelse händer ingenting — kvittot
 * står ändå i toasten.
 */
export function flyToCollectionTab(imageUrl: string | null, from: Element | null, quantity: number): void {
  if (typeof document === "undefined") return;
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
  const tab = Array.from(document.querySelectorAll<HTMLElement>('[data-tour="tab-portfolio"]')).find(
    (el) => el.getClientRects().length > 0
  );
  if (!tab || typeof tab.animate !== "function") return;
  const to = tab.getBoundingClientRect();
  const src = from?.getBoundingClientRect();
  const w = 64;
  const h = 90;
  const startX = src ? src.left + src.width / 2 : window.innerWidth / 2;
  const startY = src ? src.top + src.height / 2 : window.innerHeight * 0.62;
  const endX = to.left + to.width / 2;
  const endY = to.top + to.height / 2;

  const node = document.createElement(imageUrl ? "img" : "div");
  if (imageUrl) (node as HTMLImageElement).src = imageUrl;
  Object.assign(node.style, {
    position: "fixed",
    left: `${startX - w / 2}px`,
    top: `${startY - h / 2}px`,
    width: `${w}px`,
    height: `${h}px`,
    objectFit: "contain",
    borderRadius: "6px",
    zIndex: "90",
    pointerEvents: "none",
    background: imageUrl ? "transparent" : "#2dd4bf",
    boxShadow: "0 12px 30px rgba(0,0,0,0.55)",
  } satisfies Partial<CSSStyleDeclaration>);
  node.setAttribute("aria-hidden", "true");
  document.body.appendChild(node);
  const dx = endX - startX;
  const dy = endY - startY;
  const flight = node.animate(
    [
      { transform: "translate(0,0) scale(1) rotate(0deg)", opacity: 1 },
      { transform: `translate(${dx * 0.45}px, ${dy * 0.35 - 80}px) scale(0.7) rotate(-8deg)`, opacity: 1, offset: 0.45 },
      { transform: `translate(${dx}px, ${dy}px) scale(0.18) rotate(-14deg)`, opacity: 0.4 },
    ],
    { duration: 620, easing: "cubic-bezier(.4,0,.2,1)" }
  );
  flight.onfinish = () => {
    node.remove();
    tab.animate([{ transform: "scale(1)" }, { transform: "scale(1.18)" }, { transform: "scale(1)" }], {
      duration: 320,
      easing: "ease-out",
    });
    const badge = document.createElement("span");
    badge.textContent = `+${quantity}`;
    badge.setAttribute("aria-hidden", "true");
    Object.assign(badge.style, {
      position: "fixed",
      left: `${endX + 6}px`,
      top: `${to.top - 4}px`,
      padding: "1px 6px",
      borderRadius: "999px",
      background: "#2dd4bf",
      color: "#000",
      font: "800 11px/16px Inter, system-ui, sans-serif",
      zIndex: "90",
      pointerEvents: "none",
    } satisfies Partial<CSSStyleDeclaration>);
    document.body.appendChild(badge);
    const pop = badge.animate(
      [
        { transform: "translateY(4px) scale(0.6)", opacity: 0 },
        { transform: "translateY(0) scale(1)", opacity: 1, offset: 0.2 },
        { transform: "translateY(0) scale(1)", opacity: 1, offset: 0.8 },
        { transform: "translateY(-6px) scale(1)", opacity: 0 },
      ],
      { duration: 1400, easing: "ease-out" }
    );
    pop.onfinish = () => badge.remove();
  };
}
