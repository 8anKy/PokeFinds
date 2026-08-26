import type { Metadata } from "next";
import { alternatesFor } from "@/lib/canonical";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { IconCheck, IconPlus, IconX } from "@/components/ui/icons";
import { stripeCheckoutAdvertised } from "@/lib/stripe";
import { restockAlertsPaused } from "@/lib/restock-alerts-pause";
import { pausableFeatures } from "@/lib/pricing-features";
import { priceAlertsPaused } from "@/lib/price-alerts-pause";
import { UpgradeButton } from "./upgrade-button";
import { FreePlanCta } from "./free-plan-cta";
import { PageBackButton } from "@/components/layout/page-back-button";

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

function FeatureList({ items, excluded = [] }: { items: string[]; excluded?: string[] }) {
  return (
    <ul className="space-y-3">
      {items.map((f) => (
        <li key={f} className="flex items-start gap-2.5 text-sm text-ink-muted">
          <IconCheck size={18} className="mt-0.5 shrink-0 text-rise" />
          {f}
        </li>
      ))}
      {excluded.map((f) => (
        <li key={f} className="flex items-start gap-2.5 text-sm text-ink-faint">
          <IconX size={18} className="mt-0.5 shrink-0 text-ink-faint/70" />
          <span className="line-through decoration-ink-faint/40">{f}</span>
        </li>
      ))}
    </ul>
  );
}

export default async function PricingPage({
  params,
}: {
  params: { locale: string };
}) {
  setRequestLocale(params.locale);
  const t = await getTranslations("Pricing");
  const freeFeatures = t.raw("freeFeatures") as string[];
  const faq = t.raw("faqItems") as { q: string; a: string }[];

  /**
   * ⛔ DEN HÄR SIDAN ÄR KÖPSTÄLLET, OCH I APPEN ÄR DEN HELA PAYWALLEN (Capacitor-
   * WebView över exakt den här rutten). Står restock-larm i punktlistan medan de
   * är avstängda är det ett vilseledande påstående VID KÖPTILLFÄLLET, inte ett
   * gränssnittsfel. Två kunder hann köpa under pausen 2026-08-22/24 — den ena
   * fick pausbeskedet elva timmar efter köpet, den andra fick det aldrig
   * (engångsutskicket hade redan gått).
   *
   * ⛔ DÄRFÖR LIGGER PUNKTERNA I EGNA LISTOR, INTE BORTREDIGERADE. Att stryka dem
   * ur `premiumFeatures` hade krävt att någon MINNS att skriva tillbaka dem den
   * dag larmen slås på — samma sorts vakt som failar öppet. Nu följer listan
   * flaggan av sig själv.
   */
  const restockPaused = restockAlertsPaused();
  // ⛔ EGEN FLAGGA, INTE SAMMA. Prislarmen pausades 2026-08-26 för att de kan påstå ett
  // pris som inte finns (mätt falskt larm samma dag), restock-larmen 2026-08-23 för att
  // de kostade för mycket compute. De kommer tillbaka vid olika tillfällen.
  const pricePaused = priceAlertsPaused();
  const premiumFeatures = pausableFeatures(t.raw("premiumFeatures") as string[], [
    { items: t.raw("premiumPriceFeatures") as string[], paused: pricePaused },
    { items: t.raw("premiumRestockFeatures") as string[], paused: restockPaused },
  ]);
  const freeExcluded = pausableFeatures(t.raw("freeExcluded") as string[], [
    { items: t.raw("freeExcludedPrice") as string[], paused: pricePaused },
    { items: t.raw("freeExcludedRestock") as string[], paused: restockPaused },
  ]);

  return (
    // Mobil: pt-6 så bakåtknappen sitter i höjd med Mer-tabbens andra undersidor
    // (app-sidorna har py-6); desktop behåller luftiga py-16 (knappen är lg:hidden).
    <div className="mx-auto max-w-5xl px-2.5 pb-16 pt-6 sm:px-6 lg:pt-16">
      <PageBackButton fallback="/" />
      <div className="text-center">
        <h1 className="font-display text-3xl font-bold text-ink sm:text-4xl">
          {t("h1")}
        </h1>
        <p className="mx-auto mt-4 max-w-xl text-ink-muted">
          {t("subtitle")}
        </p>
      </div>

      {/* ⛔ Notisen står ovanför korten med flit: under köpknappen hade den varit
          en brasklapp efter beslutet. Den ska läsas innan priset. */}
      {/* Prislarmen har ingen Discord-utväg — det finns ingen gratis kanal som ersätter
          dem — så notisen står för sig själv, utan CTA. */}
      {pricePaused && (
        <div className="mx-auto mt-8 max-w-2xl rounded-xl border border-holo-gold/30 bg-holo-gold/5 px-5 py-4 text-sm text-ink-muted">
          <p>{t("priceAlertsPausedNotice")}</p>
        </div>
      )}

      {restockPaused && (
        <div className="mx-auto mt-8 max-w-2xl rounded-xl border border-holo-gold/30 bg-holo-gold/5 px-5 py-4 text-sm text-ink-muted">
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

      <div className="mt-12 grid gap-6 md:grid-cols-2">
        {/* Free */}
        <div className="card-surface flex flex-col p-8">
          <h2 className="font-display text-xl font-semibold text-ink">{t("freeName")}</h2>
          <p className="mt-1 text-sm text-ink-muted">{t("freeTagline")}</p>
          <p className="mt-6" data-price>
            <span className="font-display text-4xl font-bold text-ink">{t("freePrice")}</span>
            <span className="text-ink-muted"> {t("perMonth")}</span>
          </p>
          <div className="mt-8 flex-1">
            <FeatureList items={freeFeatures} excluded={freeExcluded} />
          </div>
          <FreePlanCta />
        </div>

        {/* Premium — rekommenderad: foil-linje + tydligare kant */}
        <div className="card-surface flex flex-col overflow-hidden border-holo-cyan/40">
          <div className="foil-line" aria-hidden="true" />
          <div className="flex flex-1 flex-col p-8">
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="font-display text-xl font-semibold text-ink">{t("proName")}</h2>
              <span className="text-xs font-medium text-holo-cyan">
                {t("proAudience")}
              </span>
            </div>
            <p className="mt-1 text-sm text-ink-muted">
              {t("proTagline")}
            </p>
            <p className="mt-6" data-price>
              <span className="holo-text font-display text-4xl font-bold">{t("proPrice")}</span>
              <span className="text-ink-muted"> {t("perMonth")}</span>
            </p>
            <div className="mt-8 flex-1">
              <p className="mb-3 text-sm font-medium text-ink">{t("proLead")}</p>
              <FeatureList items={premiumFeatures} />
            </div>
            {/* Servern äger frågan "går det att betala?" — en egen
                NEXT_PUBLIC_-flagga hade blivit en andra sanning som glider isär
                från STRIPE_ENABLED. */}
            <UpgradeButton webCheckout={stripeCheckoutAdvertised()} />
            {/* Apple 3.1.2: förnyelsevillkoret och BÅDA de legala länkarna måste
                stå VID köpknappen, inte bara i sidfoten (som dessutom är dold
                bakom bottenflikarna i appen). iOS-appen är en Capacitor-WebView
                över exakt den här sidan, så det HÄR är app:ens paywall — ändras
                texten slår den igenom utan nytt native-bygge. */}
            <p className="mt-3 text-center text-xs text-ink-faint">{t("subRenewNote")}</p>
            <p className="mt-2 flex flex-wrap items-center justify-center gap-x-2 text-xs text-ink-muted">
              <Link href="/villkor" className="underline underline-offset-2 transition-colors duration-150 hover:text-ink">
                {t("legalTerms")}
              </Link>
              <span aria-hidden="true" className="text-ink-faint">·</span>
              <Link href="/integritetspolicy" className="underline underline-offset-2 transition-colors duration-150 hover:text-ink">
                {t("legalPrivacy")}
              </Link>
            </p>
          </div>
        </div>
      </div>

      {/* FAQ */}
      <section className="mt-20">
        <h2 className="text-center font-display text-2xl font-bold text-ink">
          {t("faqTitle")}
        </h2>
        <div className="mt-6 space-y-3">
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
      </section>
    </div>
  );
}
