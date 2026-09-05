"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { getSharedSession } from "@/lib/client-session";
import { useRouter } from "@/i18n/navigation";
import { useAuthHint } from "@/lib/auth-hint";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { IconBell, IconBellFilled, IconLock } from "@/components/ui/icons";
import { getWatchedSetIds, setSetWatched } from "@/lib/watched-sets";
import { restockAlertsPausedClient } from "@/lib/restock-alerts-pause";
import { openPaywallOrNavigate } from "@/lib/paywall";

interface SetWatchButtonProps {
  setId: string;
  setName: string;
  /** Antal sealed-produkter i setet — hinten under knappen. */
  sealedCount: number;
}

/**
 * "Bevaka sealed" i setsidans rubrikrad.
 *
 * KLIENT-SIDA MED FLIT: setsidan är ISR-cachad (`revalidate = 3600`) och får inte
 * kalla `auth()` — det var precis det som drev upp Neon-CU:n (se "Caching/ISR" i
 * CLAUDE.md). Plan och bevakningstillstånd läses därför härifrån, och BARA när
 * `fo_auth`-hinten säger att någon är inloggad: utloggade besökare ska aldrig
 * generera ett anrop som väcker databasen.
 *
 * Gratiskonto får se knappen (låst, med Pro-märke) i stället för att den döljs —
 * en funktion man inte kan se säljer ingenting (samma val som bulkskanningen).
 */
export function SetWatchButton({ setId, setName, sealedCount }: SetWatchButtonProps) {
  const t = useTranslations("Watch");
  const loggedIn = useAuthHint();
  const router = useRouter();
  const { toast } = useToast();
  const [watched, setWatched] = useState(false);
  const [isPro, setIsPro] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (loggedIn !== true) return;
    void getSharedSession().then((s) => setIsPro(!!s?.user?.isPro));
    let cancelled = false;
    void getWatchedSetIds().then((ids) => {
      if (!cancelled) setWatched(ids.has(setId));
    });
    return () => {
      cancelled = true;
    };
  }, [loggedIn, setId]);

  async function toggle() {
    if (loggedIn === false) {
      router.push("/logga-in");
      return;
    }
    // Låst tillstånd först när planen är KÄND: att gissa "låst" medan den laddas
    // blinkade ett Pro-lås för betalande kunder vid varje sidöppning (mätt på
    // skannerns bulkknapp 2026-08-02).
    if (isPro === false) {
      openPaywallOrNavigate(router, { source: "set-watch" });
      return;
    }
    const next = !watched;
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
      setWatched(next);
      setSetWatched(setId, next);
      toast({
        title: next ? t("setWatched", { set: setName }) : t("setUnwatched"),
        variant: "success",
      });
    } catch {
      toast({ title: t("failed"), variant: "error" });
    } finally {
      setSaving(false);
    }
  }

  /**
   * ⛔ SET-BEVAKNING ÄR EN REN RESTOCK-FUNKTION: den gör ingenting annat än att
   * skapa restock-larm för setets sealed-produkter. Är larmen pausade är
   * knappen ett löfte utan täckning, så den låses för ALLA — även den som
   * betalar. Låst hellre än dold: en knapp som förklarar varför den är av är
   * ärligare än en funktion som tyst försvann.
   */
  const paused = restockAlertsPausedClient();
  const locked = paused || isPro === false;

  return (
    <div className="flex flex-col items-stretch gap-1 sm:items-end">
      <Button
        variant={watched ? "primary" : "secondary"}
        loading={saving}
        onClick={() => void toggle()}
        aria-pressed={watched}
      >
        {/* Ifylld klocka när setet bevakas — samma tillståndsspråk som klockan i
            produktkortet. ⛔ Ingen bock: den betyder "tillagd i samlingen" i
            resten av appen. */}
        {locked ? (
          <IconLock size={16} />
        ) : watched ? (
          <IconBellFilled size={16} />
        ) : (
          <IconBell size={16} />
        )}
        {watched ? t("setButtonActive") : t("setButton")}
        {locked && !paused && (
          <span className="ml-1 rounded bg-holo-cyan/15 px-1.5 py-0.5 text-[10px] font-bold text-holo-cyan">
            PRO
          </span>
        )}
      </Button>
      <p className="text-xs text-ink-faint sm:text-right">
        {paused
          ? t("setButtonHintPaused")
          : watched
            ? t("setButtonHintActive")
            : t("setButtonHint", { count: sealedCount })}
      </p>
    </div>
  );
}
