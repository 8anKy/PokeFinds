"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { useSession } from "next-auth/react";
import { Button, LinkButton } from "@/components/ui/button";
import { hasAuthHint } from "@/lib/auth-hint";
import { purchasesAvailable, purchasePremium, restorePremium } from "@/lib/purchases";

/**
 * I native-appen (Capacitor) = riktig Apple/Google In-App Purchase via RevenueCat.
 * På webben = Stripe Checkout.
 *
 * ⛔ De två får ALDRIG byta plats. Apple förbjuder egen checkout för digitala
 * varor i app:en, så `purchasesAvailable()` är gränsen — inte en stilfråga.
 * `webCheckout` kommer från servern (`stripeEnabled()`), så knappen aldrig lovar
 * en betalväg som inte är konfigurerad.
 */
export function UpgradeButton({ webCheckout = false }: { webCheckout?: boolean }) {
  const t = useTranslations("Upgrade");
  const router = useRouter();
  const { update } = useSession();
  const [native, setNative] = useState(false);
  const [loggedIn, setLoggedIn] = useState(false);
  const [isPro, setIsPro] = useState(false);
  /** Varför kontot har Pro — styr vad vi får lova om uppsägning. Se lib/plan. */
  const [proSource, setProSource] = useState<"stripe" | "store" | "bonus" | "role" | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  /**
   * Vänta in att Pro slår igenom efter ett köp.
   *
   * ⛔ FRÅGAN STÄLLS TILL DATABASEN, INTE TILL SESSIONSTOKEN. RevenueCat-
   * webhooken skriver planTier i DB; token:en läser bara om planen var 30:e
   * minut (TOKEN_REFRESH_MS). `/api/users/me` läser DB färskt och är samma
   * källa som resten av den här sidan redan litar på — att polla
   * `session.update()` mätte i praktiken när token:en råkade uppdateras, inte
   * när kunden faktiskt fick Pro.
   *
   * ⛔ FÖNSTRET ÄR 30 s, INTE 9. Webhooken landar normalt på 1–3 s, men vår
   * Neon-compute skalar till noll — en kall väckning äter lätt tio sekunder.
   * Mätt 2026-08-09: ett riktigt sandbox-köp hann INTE inom sex försök, och
   * kunden fick "Pro aktiveras strax" trots att köpet gått igenom.
   */
  const waitForPro = useCallback(async () => {
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 1500));
      const me = await fetch("/api/users/me")
        .then((r) => r.json())
        .catch(() => null);
      if (me?.isPro) {
        // Låt token:en hinna ikapp så sidor som läser sessionen slipper vänta
        // ut TTL:n. Fel här får inte fälla köpet — Pro gäller redan i DB.
        await update().catch(() => undefined);
        return true;
      }
    }
    return false;
  }, [update]);

  /**
   * ⛔ ALLT SOM EFFEKTEN BEHÖVER LIGGER I REFS, OCH DEN KÖR EN GÅNG.
   *
   * `update` från `useSession()` är INTE referensstabil, så `waitForPro` fick ny
   * identitet vid varje rendering. Effekten berodde på den — och pollningen
   * ANROPAR `update()`, som renderar om — så effekten startade om sig själv i all
   * oändlighet: sidan blinkade, `/api/users/me` anropades om och om igen, och
   * knappen fastnade på "Bearbetar…". `router.refresh()` på slutet spann vidare
   * på samma varv.
   *
   * Samma familj som kamerans livscykelbugg (2026-08-02): en effekt får ALDRIG
   * bero på ett hook-objekts identitet. Refs + tom beroendelista uttrycker det
   * som faktiskt menas — "kör vid montering".
   */
  const tRef = useRef(t);
  tRef.current = t;
  const waitForProRef = useRef(waitForPro);
  waitForProRef.current = waitForPro;
  const routerRef = useRef(router);
  routerRef.current = router;
  const handledReturn = useRef(false);

  useEffect(() => {
    setNative(purchasesAvailable());
    const logged = hasAuthHint();
    setLoggedIn(logged);
    if (logged) {
      fetch("/api/users/me")
        .then((r) => r.json())
        .then((me) => {
          setIsPro(!!me?.isPro);
          setProSource(me?.proSource ?? null);
        })
        .catch(() => undefined);
    }

    // Återkomsten från Stripe. ⛔ Läses ur window.location, INTE useSearchParams:
    // den hooken tvingar sidan ur statisk rendering (eller kräver en Suspense-
    // gräns), och /priser är en cachad marknadsföringssida.
    const params = new URLSearchParams(window.location.search);
    if (!logged || params.get("checkout") !== "klar" || handledReturn.current) return;
    handledReturn.current = true;

    // ⛔ Städa bort parametern MED EN GÅNG. Annars startar en omladdning, en
    // bokmärkning eller bakåtknappen samma väntan igen — och för någon som INTE
    // just köpt (t.ex. efter en uppsägning) betyder det "Bearbetar…" i evighet.
    // Exakt så upptäcktes buggen 2026-08-07.
    params.delete("checkout");
    params.delete("session_id");
    const rest = params.toString();
    window.history.replaceState(null, "", window.location.pathname + (rest ? `?${rest}` : ""));

    setBusy(true);
    setMsg(tRef.current("msgThanks"));
    waitForProRef.current()
      .then((ok) => {
        setMsg(ok ? tRef.current("msgActivated") : tRef.current("msgPurchasePending"));
        // ⛔ Uppdatera BARA vid faktiskt genomslag. En refresh på misslyckande
        // ändrar ingenting och var halva loopen.
        if (ok) {
          setIsPro(true);
          routerRef.current.refresh();
        }
      })
      .finally(() => setBusy(false));
  }, []);

  async function openBilling(path: string, failMsg: string) {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(path, { method: "POST" });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.url) throw new Error(data?.error || failMsg);
      // Stripe är en extern sida → hel navigering, inte router.push.
      window.location.href = data.url as string;
    } catch (e) {
      setMsg(e instanceof Error ? e.message : failMsg);
      setBusy(false);
    }
  }

  // Redan Pro → visa nuvarande plan istället för köpknapp (oavsett native/webb).
  if (isPro) {
    return (
      <div className="mt-8 w-full rounded-xl border border-holo-cyan/40 bg-holo-cyan/5 px-4 py-3 text-center">
        <p className="text-sm font-semibold text-holo-cyan">{t("currentPlan")}</p>
        {/* Uppsägning sker DÄR KÖPET GJORDES, och texten måste säga vilket.
            ⛔ Erbjud aldrig en avbryt-knapp för ett app-köp: den prenumerationen
            ägs av Apple/Google och vi har ingen väg att säga upp den. Ett löfte
            som inte går att hålla är sämre än en hänvisning som är sann. */}
        {proSource === "stripe" && !native ? (
          <>
            <button
              type="button"
              disabled={busy}
              onClick={() => openBilling("/api/billing/portal", t("msgPortalFailed"))}
              className="mt-2 text-xs font-medium text-holo-cyan underline disabled:opacity-50"
            >
              {busy ? t("processing") : t("manageWebSub")}
            </button>
            <p className="mt-1 text-xs text-ink-muted">{t("manageSubWeb")}</p>
          </>
        ) : (
          <p className="mt-1 text-xs text-ink-muted">
            {proSource === "store"
              ? t("manageSub")
              : proSource === "bonus"
                ? t("manageSubBonus")
                : t("manageSubRole")}
          </p>
        )}
        {msg && <p className="mt-2 text-xs text-ink-muted">{msg}</p>}
      </div>
    );
  }

  if (!native) {
    if (!webCheckout) {
      return (
        <>
          <Button disabled className="mt-8 w-full">{t("comingSoon")}</Button>
          <p className="mt-2 text-center text-xs text-ink-faint">{t("paymentSoon")}</p>
        </>
      );
    }
    if (!loggedIn) {
      return (
        <LinkButton href="/logga-in" className="mt-8 w-full">
          {t("loginToUpgrade")}
        </LinkButton>
      );
    }
    return (
      <>
        <Button
          className="mt-8 w-full"
          disabled={busy}
          onClick={() => openBilling("/api/billing/checkout", t("msgFailed"))}
        >
          {busy ? t("processing") : t("upgradeToPro")}
        </Button>
        <p className="mt-2 text-center text-xs text-ink-faint">{t("securePayment")}</p>
        {msg && <p className="mt-2 text-center text-xs text-ink-muted">{msg}</p>}
      </>
    );
  }

  if (!loggedIn) {
    return (
      <LinkButton href="/logga-in" className="mt-8 w-full">
        {t("loginToUpgrade")}
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
      if (!id) throw new Error(t("msgAccountRead"));
      const ok = await action(id);
      if (ok) {
        setMsg(okMsg);
        // RevenueCat-webhooken (server→server) skriver planTier=PREMIUM i DB.
        // Polla session-update tills den flippar. Sen soft refresh (INTE
        // location.reload → eskalerar till Safari i Capacitor-WebView).
        const activated = await waitForPro();
        setMsg(activated ? t("msgActivated") : t("msgPurchasePending"));
        router.refresh();
      } else {
        setMsg(t("msgNoActivePro"));
      }
    } catch (e) {
      setMsg(e instanceof Error ? e.message : t("msgFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button
        className="mt-8 w-full"
        disabled={busy}
        onClick={() => run(purchasePremium, t("msgThanks"))}
      >
        {busy ? t("processing") : t("upgradeToPro")}
      </Button>
      <button
        type="button"
        disabled={busy}
        onClick={() => run(restorePremium, t("msgRestored"))}
        className="mt-3 w-full text-center text-xs text-ink-faint underline disabled:opacity-50"
      >
        {t("restore")}
      </button>
      {msg && <p className="mt-2 text-center text-xs text-ink-muted">{msg}</p>}
    </>
  );
}
