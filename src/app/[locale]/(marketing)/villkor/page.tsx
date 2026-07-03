import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

export async function generateMetadata({
  params,
}: {
  params: { locale: string };
}): Promise<Metadata> {
  const t = await getTranslations({ locale: params.locale, namespace: "Terms" });
  return { title: t("metaTitle"), description: t("metaDescription") };
}

export default async function TermsPage({
  params,
}: {
  params: { locale: string };
}) {
  setRequestLocale(params.locale);
  const t = await getTranslations("Terms");
  const tLegal = await getTranslations("Legal");
  const useItems = t.raw("s3Items") as string[];

  return (
    <article className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
      <h1 className="font-display text-3xl font-bold text-ink">{t("h1")}</h1>
      <p className="mt-2 text-sm text-ink-faint">{tLegal("lastUpdated", { date: t("updated") })}</p>

      <div className="mt-8 space-y-8 text-sm leading-relaxed text-ink-muted [&_h2]:font-display [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-ink">
        <section>
          <h2>{t("s1Title")}</h2>
          <p className="mt-2">{t("s1p1")}</p>
          <p className="mt-2">{t("s1p2")}</p>
        </section>

        <section>
          <h2>{t("s2Title")}</h2>
          <p className="mt-2">{t("s2Body")}</p>
        </section>

        <section>
          <h2>{t("s3Title")}</h2>
          <p className="mt-2">{t("s3Intro")}</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {useItems.map((item, i) => (
              <li key={i}>{item}</li>
            ))}
          </ul>
          <p className="mt-2">{t("s3Outro")}</p>
        </section>

        <section>
          <h2>{t("s4Title")}</h2>
          <p className="mt-2">{t("s4Body")}</p>
        </section>

        <section>
          <h2>{t("s5Title")}</h2>
          <p className="mt-2">{t("s5Body")}</p>
        </section>

        <section>
          <h2>{t("s6Title")}</h2>
          <p className="mt-2">{t("s6Body")}</p>
        </section>

        <section>
          <h2>{t("s7Title")}</h2>
          <p className="mt-2">{t("s7Body")}</p>
        </section>

        <section>
          <h2>{t("s8Title")}</h2>
          <p className="mt-2">{t("s8Body")}</p>
        </section>

        <section>
          <h2>{t("s9Title")}</h2>
          <p className="mt-2">
            {t.rich("s9Body", {
              email: (chunks) => (
                <a href="mailto:hej@foilio.se" className="text-holo-cyan hover:underline">
                  {chunks}
                </a>
              ),
            })}
          </p>
        </section>
      </div>
    </article>
  );
}
