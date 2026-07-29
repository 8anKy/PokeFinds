"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { useAuthHint } from "@/lib/auth-hint";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { IconCheck, IconPlus } from "@/components/ui/icons";

interface CollectionQuickAddProps {
  productId: string;
  /** Produktens lägsta pris i öre — sparas som ögonblicksbild vid tillägg. */
  estimatedValue?: number | null;
}

/**
 * "+"-knappen i produktkortet: lägger produkten i samlingen utan att öppna den.
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

  async function onClick(e: React.MouseEvent) {
    // Kortet är en "stretched link" (a::after täcker hela ytan) — utan detta
    // navigerar klicket till produktsidan i stället för att spara.
    e.preventDefault();
    e.stopPropagation();
    if (state !== "idle") return;
    if (loggedIn === false) {
      router.push("/logga-in");
      return;
    }
    setState("saving");
    try {
      const res = await fetch("/api/collection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productId,
          quantity: 1,
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
      toast({ title: t("addedToCollection"), variant: "success" });
    } catch {
      setState("idle");
      toast({ title: t("addFailed"), variant: "error" });
    }
  }

  const added = state === "added";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={state === "saving"}
      aria-label={added ? t("inCollection") : t("addToCollection")}
      // z-10 lyfter knappen över kortets stretched link.
      className="relative z-10 -my-1.5 -mr-1.5 flex h-11 w-11 shrink-0 items-center justify-center p-1.5"
    >
      <span
        className={cn(
          "grid h-[30px] w-[30px] place-items-center rounded-[9px] border transition-colors",
          added
            ? "border-holo-cyan bg-holo-cyan text-surface"
            : "border-surface-border bg-transparent text-holo-cyan",
          state === "saving" && "opacity-60"
        )}
      >
        {added ? <IconCheck size={17} strokeWidth={2.6} /> : <IconPlus size={17} strokeWidth={1.9} />}
      </span>
    </button>
  );
}
