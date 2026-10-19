"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Capacitor } from "@capacitor/core";
import { ProBullets, ProPlansContext, useProPlans, type ProPlans } from "@/components/features/pro-plan-picker";
import { refreshSessionToken } from "@/lib/client-session";
import {
  loadCurrentStorePlan,
  purchasesAvailable,
  storeManagementUrl,
  switchToYear,
  type CurrentStorePlan,
} from "@/lib/purchases";
import { PricingCard } from "./pricing-card";

/**
 * Överst på /priser: säljvyn (`children`, server-renderad) eller PRO-VYN för den som
 * redan har Pro (ägarbeslut 2026-10-20: "ser super ful ut" — en Pro-medlem fick
 * säljsidan med en grå ruta längst ned).
 *
 * Pro-vyn: kortet med raderna UPPLÅSTA, "Du har Scoutr Pro", planen och var den
 * köptes, samma tre rader — och för en MÅNADSPRENUMERANT i appen ett erbjudande om
 * 12 månader (butiken byter planen, se `switchToYear`). Webbens Stripe-plan byts inte
 * härifrån (inget byte byggt) — där finns portalen.
 *
 * ⛔ Säljvyn döljs medan planerna laddas OM fo_auth-hinten säger inloggad
 * (`html[data-auth]`, satt före första målningen) — annars blinkar säljsidan förbi
 * varje Pro-medlem. Utloggade ser den direkt (SSR), utan hydreringsfel.
 */
export function PricingTop({
  webYearPlan,
  bullets,
  children,
}: {
  webYearPlan: boolean;
  bullets: [string, string][];
  children: ReactNode;
}) {
  const plans = useProPlans(webYearPlan);
  return (
    <ProPlansContext.Provider value={plans}>
      {plans.pro ? (
        <ProHome plans={plans} bullets={bullets} />
      ) : (
        <div className={plans.ready ? undefined : "[[data-auth]_&]:invisible"}>{children}</div>
      )}
    </ProPlansContext.Provider>
  );
}

function ProHome({ plans, bullets }: { plans: ProPlans; bullets: [string, string][] }) {
  const t = useTranslations("ProHome");
  const tPay = useTranslations("Paywall");
  const [current, setCurrent] = useState<CurrentStorePlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    if (plans.proSource !== "store" || !plans.userId || !purchasesAvailable()) return;
    let alive = true;
    loadCurrentStorePlan(plans.userId)
      .then((c) => alive && setCurrent(c))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [plans.proSource, plans.userId]);

  const storeName =
    current?.store === "play_store"
      ? "Google Play"
      : current?.store === "app_store" || (plans.proSource === "store" && Capacitor.getPlatform() === "ios")
        ? "App Store"
        : plans.proSource === "store" && Capacitor.getPlatform() === "android"
          ? "Google Play"
          : null;
  const planLine =
    plans.proSource === "stripe"
      ? t("viaWeb")
      : plans.proSource === "bonus"
        ? t("viaBonus")
        : plans.proSource === "role"
          ? t("viaRole")
          : [current?.kind === "year" ? tPay("planYear") : current?.kind === "month" ? tPay("planMonth") : null,
             storeName ? t("viaStore", { store: storeName }) : null]
              .filter(Boolean)
              .join(" · ");

  const offer = current?.switchTo ?? null;
  const offerPrice = offer
    ? offer.per === "year"
      ? tPay("perYear", { price: offer.price })
      : tPay("perMonth", { price: offer.price })
    : null;
  const offerNote = offer
    ? offer.kind === "annual"
      ? tPay("noteAnnual", { price: offer.price })
      : tPay("noteCommitStore", { price: offer.price, total: offer.secondary ?? "" })
    : null;

  async function doSwitch() {
    if (!plans.userId || !current) return;
    setBusy(true);
    setMsg(null);
    try {
      const ok = await switchToYear(plans.userId, current.productId);
      if (ok) {
        await refreshSessionToken();
        setCurrent(await loadCurrentStorePlan(plans.userId).catch(() => current));
        setMsg(t("switched"));
      }
    } catch (e) {
      // Avbrutet i butikens ark är inget fel att visa.
      const cancelled = typeof e === "object" && e != null && (e as { userCancelled?: boolean }).userCancelled;
      if (!cancelled) setMsg(t("switchFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function manage() {
    if (plans.proSource === "stripe") {
      setBusy(true);
      const res = await fetch("/api/billing/portal", { method: "POST" }).catch(() => null);
      const data = await res?.json().catch(() => null);
      if (data?.url) window.location.href = data.url as string;
      else {
        setMsg(t("manageFailed"));
        setBusy(false);
      }
      return;
    }
    if (plans.userId && purchasesAvailable()) {
      const url = await storeManagementUrl(plans.userId).catch(() => null);
      if (url) window.location.href = url;
      else setMsg(t("manageHint"));
    }
  }

  // ⛔ Stripe-portalen aldrig inne i appen (samma regel som UpgradeButton: ingen
  // webbkassa i App Store-/Play-skalet) — där räcker hänvisningen.
  const canManage =
    (plans.proSource === "stripe" && !Capacitor.isNativePlatform()) ||
    (plans.proSource === "store" && purchasesAvailable());

  return (
    <section className="flex flex-col">
      <PricingCard unlocked />
      <h1 className="mt-5 flex items-center gap-2 font-display text-[26px] font-bold leading-tight tracking-[-0.025em] text-ink">
        {t("title")}
        <svg width="22" height="22" viewBox="0 0 16 16" aria-hidden="true" className="shrink-0 text-holo-cyan">
          <path d="M3 8.5l3 3 7-7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </h1>
      {planLine && <p className="mt-1 text-sm text-ink-muted">{planLine}</p>}
      <ProBullets items={bullets} className="mt-4" />

      {offer && (
        <div className="mt-6 rounded-2xl border border-holo-cyan/50 p-4">
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-[15px] font-semibold text-ink">{tPay("planYear")}</p>
            <p className="text-[15px] font-semibold text-ink">{offerPrice}</p>
          </div>
          <p className="mt-0.5 text-xs text-holo-cyan">{t("offerSub")}</p>
          <button
            type="button"
            onClick={doSwitch}
            disabled={busy}
            className="mt-3.5 flex h-[50px] w-full items-center justify-center rounded-[14px] bg-ink text-[15px] font-bold text-black transition-colors hover:bg-ink/90 active:bg-ink/80 disabled:opacity-60"
          >
            {busy ? t("working") : t("switchCta")}
          </button>
          <p className="mt-2 text-center text-[11px] leading-snug text-ink-faint">{offerNote}</p>
        </div>
      )}

      {msg && <p className="mt-3 text-center text-xs text-ink-muted">{msg}</p>}

      <div className="mt-5 text-center">
        {canManage ? (
          <button
            type="button"
            onClick={manage}
            disabled={busy}
            className="text-sm font-medium text-ink-muted underline underline-offset-2 transition-colors hover:text-ink disabled:opacity-50"
          >
            {t("manage")}
          </button>
        ) : (
          <p className="text-xs text-ink-faint">
            {plans.proSource === "bonus"
              ? t("manageBonus")
              : plans.proSource === "role"
                ? t("manageRole")
                : plans.proSource === "stripe"
                  ? t("manageWeb")
                  : t("manageHint")}
          </p>
        )}
      </div>
    </section>
  );
}
