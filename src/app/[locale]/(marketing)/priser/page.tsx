import type { Metadata } from "next";
import { alternatesFor } from "@/lib/canonical";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { IconPlus } from "@/components/ui/icons";
import { stripeCheckoutAdvertised } from "@/lib/stripe";
import { restockAlertsPaused } from "@/lib/restock-alerts-pause";
import { pausableFeatures, type SpecRow } from "@/lib/pricing-features";
import { priceAlertsPaused } from "@/lib/price-alerts-pause";
import { ProBullets, ProPlanPurchase } from "@/components/features/pro-plan-picker";
import { OpenOnHash } from "./open-on-hash";
import { PricingCard } from "./pricing-card";
import { PricingTop } from "./pricing-top";
import { ProSpecTable } from "@/components/features/pro-spec-table";
import { FreePlanCta } from "./free-plan-cta";
import { SubpageHeader } from "@/components/layout/subpage-header";
import { TrackOnMount } from "@/components/features/track-on-mount";

export async function generateMetadata({
  params,
}: {
  params: { locale: string };
}): Promise<Metadata> {
  const t = await getTranslations({ locale: params.locale, namespace: "Pricing" });
  return {
    title: t("metaTitle"),
    description: t("metaDescription"),
    alternates: alternatesFor(params.locale, "/priser"),
  };
}

export default async function PricingPage({
  params,
}: {
  params: { locale: string };
}) {
  setRequestLocale(params.locale);
  const t = await getTranslations("Pricing");
  const tPay = await getTranslations("Paywall");
  const tNav = await getTranslations("Nav");
  const faq = t.raw("faqItems") as { q: string; a: string }[];

  /**
   * ⛔ DEN HÄR SIDAN ÄR KÖPSTÄLLET, OCH I APPEN ÄR DEN HELA PAYWALLEN (Capacitor-
   * WebView över exakt den här rutten) tillsammans med paywall-arket, som visar
   * SAMMA rader. Står restock-larm i spec-bladet medan de är avstängda är det ett
   * vilseledande påstående VID KÖPTILLFÄLLET, inte ett gränssnittsfel. Två kunder
   * hann köpa under pausen 2026-08-22/24 — den ena fick pausbeskedet elva timmar
   * efter köpet, den andra fick det aldrig (engångsutskicket hade redan gått).
   *
   * ⛔ DÄRFÖR LIGGER RADERNA I EGNA LISTOR, INTE BORTREDIGERADE. Att stryka dem ur
   * `specRows` hade krävt att någon MINNS att skriva tillbaka dem den dag larmen
   * slås på — samma sorts vakt som failar öppet. Nu följer bladet flaggan av sig
   * själv. Vaktat av tests/unit/restock-pause-copy.test.ts + price-alert-pause.test.ts.
   */
  const restockPaused = restockAlertsPaused();
  // ⛔ EGEN FLAGGA, INTE SAMMA. Prislarmen pausades 2026-08-26 för att de kan påstå ett
  // pris som inte finns (mätt falskt larm samma dag), restock-larmen 2026-08-23 för att
  // de kostade för mycket compute. De kommer tillbaka vid olika tillfällen.
  const pricePaused = priceAlertsPaused();
  const rows = pausableFeatures(t.raw("specRows") as SpecRow[], [
    { items: t.raw("specRowsPrice") as SpecRow[], paused: pricePaused },
    { items: t.raw("specRowsRestock") as SpecRow[], paused: restockPaused },
  ]);
  // Samma tre rader som arket, med samma pausflagga på restock-raden.
  const bullets: [string, string][] = [[tPay("bulletSoldTitle"), tPay("bulletSoldBody")]];
  if (!restockPaused) bullets.push([tPay("bulletRestockTitle"), tPay("bulletRestockBody")]);
  bullets.push([tPay("bulletScanTitle"), tPay("bulletScanBody")]);

  return (
    // Mobil: pt-6 så bakåtknappen sitter i höjd med Mer-tabbens andra undersidor
    // (app-sidorna har py-6); desktop behåller luftiga py-16 (knappen är lg:hidden).
    <div className="mx-auto max-w-5xl px-2.5 pb-16 pt-6 sm:px-6 lg:pt-16">
      {/* Tratten: sidan räknas som en paywall-öppning med källan "priser". */}
      <TrackOnMount type="paywall_open" slug="priser" />
      <SubpageHeader title={tNav("pricing")} fallback="/mer" mobileOnly />

      {/* ⛔ Pausnotisen står FÖRST, ovanför pris och kort, med flit: under
          köpknappen hade den varit en brasklapp efter beslutet. Den ska läsas innan
          priset. EN notis, aldrig två (ägarbeslut 2026-09-05): är restock-larmen
          pausade visas bara restock-notisen (den har Discord-utvägen); prisnotisen
          visas bara när prislarmen är det ENDA som är pausat. Spec-bladet säljer
          ändå inga pausade larm — raderna följer flaggorna — så notisen är
          "det här gäller ändå", inte den enda vakten. */}
      {(pricePaused || restockPaused) && (
        <div className="mb-8 flex flex-col gap-3">
          {pricePaused && !restockPaused && (
            <div className="rounded-xl border border-holo-gold/30 bg-holo-gold/5 px-5 py-4 text-sm text-ink-muted">
              <p>{t("priceAlertsPausedNotice")}</p>
            </div>
          )}
          {restockPaused && (
            <div className="rounded-xl border border-holo-gold/30 bg-holo-gold/5 px-5 py-4 text-sm text-ink-muted">
              <p>{t("restockPausedNotice")}</p>
              {/* Internt till /discord, inte rakt ut till discord.gg: den sidan
                  FÖRKLARAR vad servern är, och en utgående länk från paywallen tar
                  besökaren ur köpflödet utan att svara på frågan. */}
              <Link
                href="/discord"
                className="mt-2 inline-block font-medium text-holo-cyan underline-offset-2 hover:underline"
              >
                {t("restockPausedCta")}
              </Link>
            </div>
          )}
        </div>
      )}

      {/* A+ (ägarbeslut 2026-10-19, "som artifacten"): sidan ÄR arket — ett kort med de
          låsta sålt-raderna, rubriken, tre bockrader, planvalet med 12 månader förvalt
          och EN vit knapp. Jämförelsen + FAQ ligger HOPFÄLLD under "Jämför allt" (kvar
          i HTML:en för sök och granskning, men inte en lista under köpet). Kortets pris
          och linje hämtas i klienten (pricing-card.tsx) — ett inbakat pris hade varit gammalt. */}
      <div className="mx-auto w-full max-w-md">
        {/* Pro-medlemmar får Pro-vyn i stället (pricing-top.tsx). */}
        <PricingTop
          webYearPlan={stripeCheckoutAdvertised() && !!process.env.STRIPE_PRICE_ID_PRO_COMMIT}
          bullets={bullets}
        >
          <section className="flex flex-col">
            <PricingCard />
            <h1 className="mt-5 font-display text-[26px] font-bold leading-tight tracking-[-0.025em] text-ink">
              {tPay("headlineSold")}
            </h1>
            <p className="sr-only" data-price>
              {tPay("title")} · {t("heroPrice")} {t("heroSub")}
            </p>
            <ProBullets items={bullets} className="mt-3.5" />

            <div className="mt-5 w-full">
              {/* Servern äger frågan "går det att betala?" — en egen
                  NEXT_PUBLIC_-flagga hade blivit en andra sanning som glider isär
                  från STRIPE_ENABLED. */}
              <ProPlanPurchase
                webCheckout={stripeCheckoutAdvertised()}
                webYearPlan={!!process.env.STRIPE_PRICE_ID_PRO_COMMIT}
                fallbackNote={t("subRenewNote")}
              />
              {/* Apple 3.1.2: förnyelsevillkoret och BÅDA de legala länkarna måste
                  stå VID köpknappen, inte bara i sidfoten (som dessutom är dold
                  bakom bottenflikarna i appen). iOS-appen är en Capacitor-WebView
                  över exakt den här sidan, så det HÄR är app:ens paywall — ändras
                  texten slår den igenom utan nytt native-bygge. Paywall-arket bär
                  samma text vid sin knapp. */}
              <p className="mt-1.5 flex flex-wrap items-center justify-center gap-x-2 text-[11px] text-ink-muted">
                <a href="#jamfor" className="underline underline-offset-2 transition-colors duration-150 hover:text-ink">
                  {tPay("compareAll")}
                </a>
                <span aria-hidden="true" className="text-ink-faint">·</span>
                <Link href="/villkor" className="underline underline-offset-2 transition-colors duration-150 hover:text-ink">
                  {t("legalTerms")}
                </Link>
                <span aria-hidden="true" className="text-ink-faint">·</span>
                <Link href="/integritetspolicy" className="underline underline-offset-2 transition-colors duration-150 hover:text-ink">
                  {t("legalPrivacy")}
                </Link>
              </p>
            </div>
          </section>
        </PricingTop>

        <OpenOnHash id="jamfor" />
        <details id="jamfor" className="group mt-12 scroll-mt-24 border-t border-surface-border pt-4">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-2 text-sm font-semibold text-ink [&::-webkit-details-marker]:hidden">
            {t("specTitle")}
            <IconPlus size={18} className="shrink-0 text-ink-faint transition-transform group-open:rotate-45" />
          </summary>
          <ProSpecTable rows={rows} freeLabel={t("specFree")} proLabel={t("specPro")} className="mt-3" />

          <div className="card-surface mt-4 flex items-center justify-between gap-4 px-4 py-3">
            <div>
              <p className="text-sm font-bold text-ink">{t("freeRowTitle")}</p>
              <p className="mt-0.5 text-xs text-ink-faint">{t("freeRowDesc")}</p>
            </div>
            <p className="font-display text-lg font-bold text-ink" data-price>
              {t("freeRowPrice")}
            </p>
          </div>
          <FreePlanCta />

          <h2 className="mt-14 font-display text-xl font-bold text-ink">{t("faqTitle")}</h2>
          <div className="mt-4 space-y-3">
            {faq.map((item) => (
              <details key={item.q} className="card-surface group">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 font-medium text-ink [&::-webkit-details-marker]:hidden">
                  {item.q}
                  <IconPlus
                    size={18}
                    className="shrink-0 text-ink-faint transition-transform group-open:rotate-45"
                  />
                </summary>
                <p className="border-t border-surface-border px-5 py-4 text-sm text-ink-muted">
                  {item.a}
                </p>
              </details>
            ))}
          </div>
        </details>
      </div>
    </div>
  );
}
