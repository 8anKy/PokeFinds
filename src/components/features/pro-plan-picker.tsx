"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { hasAuthHint } from "@/lib/auth-hint";
import { loadStorePlans, purchasesAvailable } from "@/lib/purchases";
import {
  PRO_COMMIT_MONTHLY_ORE,
  PRO_COMMIT_TOTAL_ORE,
  PRO_MONTHLY_ORE,
  PRO_TRIAL_DAYS,
  formatKr,
  type ProPlanChoice,
} from "@/lib/pro-plans";
import type { StorePlanOption } from "@/lib/store-plans";
import { UpgradeButton } from "@/components/features/upgrade-button";

/**
 * PLANVALET I PRO-ARKET (2026-10-19, design "A+"): 12 månader förvald och märkt
 * "Mest valt", månadsvis under. Två planer, aldrig tre — fler alternativ sänker
 * köpen, och årsplanen säljs bäst bredvid sitt eget månadspris.
 *
 * Priserna kommer från BUTIKEN i appen (Apple/Google underkänner annars köpstället)
 * och från våra konstanter på webben (Stripe-priserna har samma tal). Provperioden
 * visas bara när den faktiskt ges: butiken säger det i appen, servern på webben
 * (`webTrialEligible` = aldrig betalat eller provat Pro).
 */

export interface PlanView {
  kind: StorePlanOption["kind"];
  price: string;
  per: "month" | "year";
  secondary: string | null;
  trialDays: number | null;
}

export interface ProPlans {
  ready: boolean;
  /** Butiksköp (app) — styr villkorsraden: Apple förnyar åtagandet 12 mån i taget. */
  store: boolean;
  /** Har redan Pro ⇒ inget planval, ingen provperiodsrad — /priser visar Pro-vyn. */
  pro: boolean;
  /** Pro-medlemmens källa (`proSource` ur /api/users/me) + id — Pro-vyns planrad och byte. */
  proSource?: "stripe" | "store" | "bonus" | "role" | null;
  userId?: string | null;
  year: PlanView | null;
  month: PlanView | null;
}

const WEB_PLANS = (trial: boolean): Pick<ProPlans, "year" | "month"> => ({
  year: {
    kind: "commit",
    price: formatKr(PRO_COMMIT_MONTHLY_ORE),
    per: "month",
    secondary: formatKr(PRO_COMMIT_TOTAL_ORE),
    trialDays: trial ? PRO_TRIAL_DAYS : null,
  },
  month: { kind: "month", price: formatKr(PRO_MONTHLY_ORE), per: "month", secondary: null, trialDays: null },
});

/**
 * /priser hämtar planerna EN gång (Pro-vyn eller säljvyn avgörs av dem) och delar
 * dem med köpblocket — annars två /api/users/me per sidvisning.
 */
export const ProPlansContext = createContext<ProPlans | null>(null);

export function useProPlans(webYearPlan: boolean, skip = false): ProPlans {
  const [plans, setPlans] = useState<ProPlans>({ ready: false, store: false, pro: false, year: null, month: null });

  useEffect(() => {
    if (skip) return;
    let alive = true;
    const loggedIn = hasAuthHint();
    const proPlans = (store: boolean, me: { id?: string; proSource?: ProPlans["proSource"] }): ProPlans => ({
      ready: true,
      store,
      pro: true,
      proSource: me.proSource ?? null,
      userId: me.id ?? null,
      year: null,
      month: null,
    });
    if (purchasesAvailable()) {
      void (async () => {
        try {
          // Utloggad ⇒ butikens planer ändå (anonymt SDK); knappen ber om inloggning.
          const me = loggedIn ? await fetch("/api/users/me").then((r) => r.json()) : null;
          if (me?.isPro) {
            if (alive) setPlans(proPlans(true, me));
            return;
          }
          const p = await loadStorePlans(me?.id ?? null);
          if (alive) setPlans({ ready: true, store: true, pro: false, year: p.year, month: p.month });
        } catch {
          // Butiken svarar inte ⇒ bara knappen (månadsplanen), som förut.
          if (alive) setPlans({ ready: true, store: true, pro: false, year: null, month: null });
        }
      })();
      return () => {
        alive = false;
      };
    }
    const web = (trial: boolean): ProPlans => {
      const p = WEB_PLANS(trial);
      return { ready: true, store: false, pro: false, year: webYearPlan ? p.year : null, month: p.month };
    };
    if (!loggedIn) {
      setPlans(web(true));
      return;
    }
    fetch("/api/users/me")
      .then((r) => r.json())
      .then((me) => alive && setPlans(me?.isPro ? proPlans(false, me) : web(me?.webTrialEligible !== false)))
      .catch(() => alive && setPlans(web(false)));
    return () => {
      alive = false;
    };
  }, [webYearPlan, skip]);

  return plans;
}

function Radio({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border-[1.5px]",
        on ? "border-holo-cyan" : "border-surface-border"
      )}
    >
      {on && <span className="h-2 w-2 rounded-full bg-holo-cyan" />}
    </span>
  );
}

export function ProPlanPicker({
  plans,
  choice,
  onChoose,
}: {
  plans: ProPlans;
  choice: ProPlanChoice;
  onChoose: (c: ProPlanChoice) => void;
}) {
  const t = useTranslations("Paywall");
  if (!plans.year || !plans.month) return null;
  const { year, month } = plans;
  const yearPrice = year.per === "year" ? t("perYear", { price: year.price }) : t("perMonth", { price: year.price });
  const yearSub = year.trialDays
    ? t("trialLine", { days: year.trialDays })
    : year.kind === "annual" && year.secondary
      ? t("annualEquivalent", { price: year.secondary })
      : null;

  return (
    <div role="radiogroup" aria-label={t("planGroup")} className="flex w-full flex-col gap-2">
      <button
        type="button"
        role="radio"
        aria-checked={choice === "year"}
        onClick={() => onChoose("year")}
        className={cn(
          "relative flex h-[58px] items-center gap-3 rounded-[14px] border bg-surface-base px-3.5 text-left",
          choice === "year" ? "border-holo-cyan" : "border-surface-border"
        )}
      >
        <Radio on={choice === "year"} />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-[15px] font-semibold text-ink">{t("planYear")}</span>
          {yearSub && (
            <span className={cn("text-xs", year.trialDays ? "text-holo-cyan" : "text-ink-muted")}>{yearSub}</span>
          )}
        </span>
        <span className="text-[15px] font-semibold text-ink">{yearPrice}</span>
        <span className="absolute -top-[9px] right-3 rounded-md bg-holo-cyan px-[7px] py-0.5 text-[10px] font-bold uppercase tracking-[0.06em] text-black">
          {t("planBadge")}
        </span>
      </button>
      <button
        type="button"
        role="radio"
        aria-checked={choice === "month"}
        onClick={() => onChoose("month")}
        className={cn(
          "flex h-[58px] items-center gap-3 rounded-[14px] border bg-surface-base px-3.5 text-left",
          choice === "month" ? "border-holo-cyan" : "border-surface-border"
        )}
      >
        <Radio on={choice === "month"} />
        <span className="flex-1 text-[15px] font-semibold text-ink">{t("planMonth")}</span>
        <span className="text-[15px] font-semibold text-ink-muted">{t("perMonth", { price: month.price })}</span>
      </button>
    </div>
  );
}

/** Knapptexten och villkorsraden vid knappen för vald plan (Apple 3.1.2: pris + förnyelse). */
export function usePlanCopy(plans: ProPlans, choice: ProPlanChoice): { cta: string | undefined; note: string | null } {
  const t = useTranslations("Paywall");
  const plan = choice === "year" ? plans.year : plans.month;
  if (plans.pro || !plan) return { cta: undefined, note: null };
  if (plan.kind === "month") {
    return { cta: t("ctaMonth", { price: plan.price }), note: t("noteMonth", { price: plan.price }) };
  }
  const days = plan.trialDays;
  const cta = days ? t("ctaTrial", { days }) : t("ctaYear");
  if (plan.kind === "annual") {
    return { cta, note: days ? t("noteAnnualTrial", { days, price: plan.price }) : t("noteAnnual", { price: plan.price }) };
  }
  const total = plan.secondary ?? "";
  const key = plans.store
    ? days
      ? "noteCommitTrialStore"
      : "noteCommitStore"
    : days
      ? "noteCommitTrialWeb"
      : "noteCommitWeb";
  return { cta, note: t(key, { days: days ?? 0, price: plan.price, total }) };
}

/** A+-arkets tre rader: turkos bock, fet rubrik, dämpad förklaring. Delas av arket och /priser. */
export function ProBullets({ items, className }: { items: [string, string][]; className?: string }) {
  return (
    <ul className={cn("flex w-full flex-col gap-2.5", className)}>
      {items.map(([title, body]) => (
        <li key={title} className="flex items-start gap-2.5 text-[14.5px] leading-snug">
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" className="mt-0.5 shrink-0">
            <path
              d="M3 8.5l3 3 7-7"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="text-holo-cyan"
            />
          </svg>
          <span>
            <span className="font-semibold text-ink">{title}</span>
            <span className="text-ink-faint"> — {body}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Planvalet + köpknappen + villkorsraden som ETT block — prissidan (/priser), som i
 * appen ÄR paywallen (Capacitor-WebView över rutten). Arket bygger samma tre delar
 * själv eftersom knappen bor i arkets fasta fot.
 */
export function ProPlanPurchase({
  webCheckout,
  webYearPlan,
  fallbackNote,
}: {
  webCheckout: boolean;
  webYearPlan: boolean;
  fallbackNote: string;
}) {
  const shared = useContext(ProPlansContext);
  const own = useProPlans(webCheckout && webYearPlan, shared != null);
  const plans = shared ?? own;
  const [choice, setChoice] = useState<ProPlanChoice>("year");
  const effective: ProPlanChoice = plans.year ? choice : "month";
  const { cta, note } = usePlanCopy(plans, effective);
  return (
    <>
      {plans.year && plans.month && (
        <div className="mb-5">
          <ProPlanPicker plans={plans} choice={effective} onChoose={setChoice} />
        </div>
      )}
      <UpgradeButton webCheckout={webCheckout} compact plan={effective} label={cta} tone="light" />
      {!plans.pro && (
        <p className="mt-2.5 text-center text-[11px] leading-snug text-ink-faint">{note ?? fallbackNote}</p>
      )}
    </>
  );
}
