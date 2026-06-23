"use client";

import { useEffect, useState } from "react";
import { Button, LinkButton } from "@/components/ui/button";
import { hasAuthHint } from "@/lib/auth-hint";
import { purchasesAvailable, purchasePremium, restorePremium } from "@/lib/purchases";

/**
 * I native-appen (Capacitor) = riktig Apple/Google In-App Purchase via RevenueCat.
 * På webben = oförändrat "Kommer snart" (Apple förbjuder egen checkout i app:en,
 * och webb-Stripe är medvetet inte byggt än).
 */
export function UpgradeButton() {
  const [native, setNative] = useState(false);
  const [loggedIn, setLoggedIn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    setNative(purchasesAvailable());
    setLoggedIn(hasAuthHint());
  }, []);

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
      const me = await fetch("/api/users/me").then((r) => r.json());
      const id = me?.data?.id;
      if (!id) throw new Error("Kunde inte läsa kontot.");
      const ok = await action(id);
      if (ok) {
        setMsg(okMsg);
        setTimeout(() => location.reload(), 1500); // webhooken hinner skriva planTier
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
