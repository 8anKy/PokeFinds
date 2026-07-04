import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { LinkButton } from "@/components/ui/button";
import { IconCheck, IconPlus, IconX } from "@/components/ui/icons";
import { UpgradeButton } from "./upgrade-button";

export async function generateMetadata({
  params,
}: {
  params: { locale: string };
}): Promise<Metadata> {
  const t = await getTranslations({ locale: params.locale, namespace: "Pricing" });
  return { title: t("metaTitle"), description: t("metaDescription") };
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
  const freeExcluded = t.raw("freeExcluded") as string[];
  const premiumFeatures = t.raw("premiumFeatures") as string[];
  const faq = t.raw("faqItems") as { q: string; a: string }[];

  return (
    <div className="mx-auto max-w-5xl px-4 py-16 sm:px-6">
      <div className="text-center">
        <h1 className="font-display text-3xl font-bold text-ink sm:text-4xl">
          {t("h1")}
        </h1>
        <p className="mx-auto mt-4 max-w-xl text-ink-muted">
          {t("subtitle")}
        </p>
      </div>

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
          <LinkButton href="/registrera" variant="secondary" className="mt-8 w-full">
            {t("freeCta")}
          </LinkButton>
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
            <UpgradeButton />
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
