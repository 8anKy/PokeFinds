import type { Metadata } from "next";
import { alternatesFor } from "@/lib/canonical";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";

export async function generateMetadata({
  params,
}: {
  params: { locale: string };
}): Promise<Metadata> {
  const t = await getTranslations({ locale: params.locale, namespace: "About" });
  return {
    title: t("metaTitle"),
    description: t("metaDescription"),
    alternates: alternatesFor(params.locale, "/om"),
  };
}

export default async function AboutPage({
  params,
}: {
  params: { locale: string };
}) {
  setRequestLocale(params.locale);
  const t = await getTranslations("About");
  // 5:an är kortskannern + AI-graderingen — sidan beskrev länge bara halva produkten.
  const doItems = [1, 2, 3, 4, 5] as const;

  return (
    <article className="mx-auto max-w-3xl px-2.5 py-16 sm:px-6">
      <h1 className="font-display text-3xl font-bold text-ink">{t("h1")}</h1>
      <p className="mt-2 text-sm text-ink-faint">{t("subtitle")}</p>

      <div className="mt-8 space-y-8 text-sm leading-relaxed text-ink-muted [&_h2]:font-display [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-ink">
        <section>
          <h2>{t("whatTitle")}</h2>
          <p className="mt-2">{t("whatBody")}</p>
        </section>

        <section>
          <h2>{t("doTitle")}</h2>
          <ul className="mt-2 list-disc space-y-2 pl-5">
            {doItems.map((n) => (
              <li key={n}>
                <strong>{t(`do${n}Lead`)}</strong>: {t(`do${n}Text`)}
              </li>
            ))}
          </ul>
        </section>

        {/* Rankningstransparens (EU:s Omnibus-regler): huvudparametrarna för
            "Bäst matchning" och löftet att ingen kan betala för placering.
            id:t länkas från sorteringsarket i katalogen. */}
        <section id="ranking">
          <h2>{t("rankingTitle")}</h2>
          {t("rankingBody")
            .split("\n\n")
            .map((p, i) => (
              <p key={i} className="mt-2">
                {p}
              </p>
            ))}
        </section>

        <section>
          <h2>{t("independentTitle")}</h2>
          <p className="mt-2">{t("independentBody")}</p>
        </section>

        <section>
          <h2>{t("contactTitle")}</h2>
          <p className="mt-2">
            {t.rich("contactBody", {
              email: (chunks) => (
                <a href="mailto:hej@foilio.se" className="text-holo-cyan hover:underline">
                  {chunks}
                </a>
              ),
              link: (chunks) => (
                <Link href="/kontakt" className="text-holo-cyan hover:underline">
                  {chunks}
                </Link>
              ),
            })}
          </p>
        </section>
      </div>
    </article>
  );
}
