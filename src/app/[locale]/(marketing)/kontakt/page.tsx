import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { IconMail, IconShield } from "@/components/ui/icons";
import { PageBackButton } from "@/components/layout/page-back-button";

export async function generateMetadata({
  params,
}: {
  params: { locale: string };
}): Promise<Metadata> {
  const t = await getTranslations({ locale: params.locale, namespace: "Contact" });
  return { title: t("metaTitle"), description: t("metaDescription") };
}

export default async function ContactPage({
  params,
}: {
  params: { locale: string };
}) {
  setRequestLocale(params.locale);
  const t = await getTranslations("Contact");

  return (
    // Mobil: pt-6 så bakåtknappen sitter i höjd med Mer-tabbens andra undersidor
    // (app-sidorna har py-6); desktop behåller luftiga py-16 (knappen är lg:hidden).
    <article className="mx-auto max-w-3xl px-4 pb-16 pt-6 sm:px-6 lg:pt-16">
      <PageBackButton fallback="/" />
      <h1 className="font-display text-3xl font-bold text-ink">{t("h1")}</h1>
      <p className="mt-2 text-ink-muted">{t("subtitle")}</p>

      <div className="mt-10 grid gap-6 sm:grid-cols-2">
        <div className="card-surface flex flex-col items-start gap-3 p-6">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-holo-cyan/10 text-holo-cyan">
            <IconMail size={20} />
          </div>
          <h2 className="font-display text-lg font-semibold text-ink">{t("emailTitle")}</h2>
          <p className="text-sm text-ink-muted">{t("emailBody")}</p>
          <a
            href="mailto:hej@foilio.se"
            className="mt-auto text-sm font-medium text-holo-cyan hover:underline"
          >
            hej@foilio.se
          </a>
        </div>

        <div className="card-surface flex flex-col items-start gap-3 p-6">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-holo-cyan/10 text-holo-cyan">
            <IconShield size={20} />
          </div>
          <h2 className="font-display text-lg font-semibold text-ink">{t("securityTitle")}</h2>
          <p className="text-sm text-ink-muted">{t("securityBody")}</p>
          <a
            href="mailto:hej@foilio.se"
            className="mt-auto text-sm font-medium text-holo-cyan hover:underline"
          >
            hej@foilio.se
          </a>
        </div>
      </div>

      <div className="mt-10 space-y-4 text-sm text-ink-muted">
        <h2 className="font-display text-lg font-semibold text-ink">{t("commonTitle")}</h2>
        <ul className="list-disc space-y-2 pl-5">
          <li>
            <strong>{t("c1Lead")}</strong>: {t("c1Text")}
          </li>
          <li>
            <strong>{t("c2Lead")}</strong>: {t("c2Text")}
          </li>
          <li>
            <strong>{t("c3Lead")}</strong>:{" "}
            {t.rich("c3Body", {
              link: (chunks) => (
                <Link href="/installningar" className="text-holo-cyan hover:underline">
                  {chunks}
                </Link>
              ),
            })}
          </li>
        </ul>
      </div>

      <div className="mt-10 rounded-lg border border-surface-border bg-surface-overlay/50 p-5 text-sm text-ink-muted">
        <p>
          <strong className="text-ink">{t("responseLead")}</strong> {t("responseText")}
        </p>
      </div>
    </article>
  );
}
