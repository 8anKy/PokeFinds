"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { Button, LinkButton } from "@/components/ui/button";
import { hasAuthHint } from "@/lib/auth-hint";
import { purchasesAvailable, purchasePremium, restorePremium } from "@/lib/purchases";

/**
 * I native-appen (Capacitor) = riktig Apple/Google In-App Purchase via RevenueCat.
 * På webben = oförändrat "Kommer snart" (Apple förbjuder egen checkout i app:en,
 * och webb-Stripe är medvetet inte byggt än).
 */
export function UpgradeButton() {
  const router = useRouter();
  const { update } = useSession();
  const [native, setNative] = useState(false);
  const [loggedIn, setLoggedIn] = useState(false);
  const [isPro, setIsPro] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    setNative(purchasesAvailable());
    const logged = hasAuthHint();
    setLoggedIn(logged);
    if (logged) {
      fetch("/api/users/me")
        .then((r) => r.json())
        .then((me) => setIsPro(me?.planTier === "PREMIUM"))
        .catch(() => undefined);
    }
  }, []);

  // Redan Pro → visa nuvarande plan istället för köpknapp (oavsett native/webb).
  if (isPro) {
    return (
      <div className="mt-8 w-full rounded-xl border border-holo-cyan/40 bg-holo-cyan/5 px-4 py-3 text-center">
        <p className="text-sm font-semibold text-holo-cyan">Din nuvarande plan ✓</p>
        <p className="mt-1 text-xs text-ink-muted">
          Hantera eller säg upp i App Store (Inställningar → ditt namn → Prenumerationer).
        </p>
      </div>
    );
  }

  if (!native) {
    return (
      <>
        <Button disabled className="mt-8 w-full">Kommer snart</Button>
        <p className="mt-2 text-center text-xs text-ink-faint">
          Betalning lanseras inom kort. Ingen bindningstid.
        </p>
      </>
    );
  }

  if (!loggedIn) {
    return (
      <LinkButton href="/logga-in" className="mt-8 w-full">
        Logga in för att uppgradera
      </LinkButton>
    );
  }

  async function run(action: (id: string) => Promise<boolean>, okMsg: string) {
    setBusy(true);
    setMsg(null);
    try {
      // /api/users/me returnerar user-objektet direkt (jsonOk → ingen data-wrapper).
      const me = await fetch("/api/users/me").then((r) => r.json());
      const id = me?.id;
      if (!id) throw new Error("Kunde inte läsa kontot.");
      const ok = await action(id);
      if (ok) {
        setMsg(okMsg);
        // RevenueCat-webhooken (server→server) skriver planTier=PREMIUM i DB.
        // Polla session-update (jwt-callbackens "update"-trigger re-läser planTier
        // från DB) tills den flippar — webhooken landar oftast på 1–3 s. Sen soft
        // refresh (INTE location.reload → eskalerar till Safari i Capacitor-WebView).
        let activated = false;
        for (let i = 0; i < 6; i++) {
          await new Promise((r) => setTimeout(r, 1500));
          const s = await update();
          if (s?.user?.planTier === "PREMIUM") {
            activated = true;
            break;
          }
        }
        setMsg(activated ? "Pro aktiverat! 🎉" : "Köpet gick igenom — Pro aktiveras strax.");
        router.refresh();
      } else {
        setMsg("Ingen aktiv Pro hittades.");
      }
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Köpet kunde inte slutföras.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button
        className="mt-8 w-full"
        disabled={busy}
        onClick={() => run(purchasePremium, "Tack! Pro aktiveras strax.")}
      >
        {busy ? "Bearbetar…" : "Uppgradera till Pro"}
      </Button>
      <button
        type="button"
        disabled={busy}
        onClick={() => run(restorePremium, "Pro återställt.")}
        className="mt-3 w-full text-center text-xs text-ink-faint underline disabled:opacity-50"
      >
        Återställ köp
      </button>
      {msg && <p className="mt-2 text-center text-xs text-ink-muted">{msg}</p>}
    </>
  );
}
