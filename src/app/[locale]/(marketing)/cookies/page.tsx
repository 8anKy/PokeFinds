import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";

export async function generateMetadata({
  params,
}: {
  params: { locale: string };
}): Promise<Metadata> {
  const t = await getTranslations({ locale: params.locale, namespace: "Cookies" });
  return { title: t("metaTitle"), description: t("metaDescription") };
}

export default async function CookiesPage({
  params,
}: {
  params: { locale: string };
}) {
  setRequestLocale(params.locale);
  const t = await getTranslations("Cookies");
  const tLegal = await getTranslations("Legal");
  const necessary = t.raw("necessaryItems") as { code: string; text: string }[];
  const pref = t.raw("prefItems") as { code: string; text: string }[];

  return (
    <article className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
      <h1 className="font-display text-3xl font-bold text-ink">{t("h1")}</h1>
      <p className="mt-2 text-sm text-ink-faint">{tLegal("lastUpdated", { date: t("updated") })}</p>

      <div className="mt-8 space-y-8 text-sm leading-relaxed text-ink-muted [&_h2]:font-display [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-ink">
        <section>
          <h2>{t("s1Title")}</h2>
          <p className="mt-2">{t("s1Body")}</p>
        </section>

        <section>
          <h2>{t("s2Title")}</h2>
          <div className="mt-2 space-y-4">
            <div>
              <h3 className="font-semibold text-ink">{t("necessaryTitle")}</h3>
              <p className="mt-1">{t("necessaryBody")}</p>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                {necessary.map((c) => (
                  <li key={c.code}><strong>{c.code}</strong> — {c.text}</li>
                ))}
              </ul>
            </div>
            <div>
              <h3 className="font-semibold text-ink">{t("prefTitle")}</h3>
              <p className="mt-1">{t("prefBody")}</p>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                {pref.map((c) => (
                  <li key={c.code}><strong>{c.code}</strong> — {c.text}</li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        <section>
          <h2>{t("s3Title")}</h2>
          <p className="mt-2">{t("s3Body")}</p>
        </section>

        <section>
          <h2>{t("s4Title")}</h2>
          <p className="mt-2">{t("s4Body")}</p>
        </section>

        <section>
          <h2>{t("s5Title")}</h2>
          <p className="mt-2">
            {t.rich("s5Body", {
              link: (chunks) => (
                <Link href="/integritetspolicy" className="text-holo-cyan hover:underline">
                  {chunks}
                </Link>
              ),
            })}
          </p>
        </section>

        <section>
          <h2>{t("s6Title")}</h2>
          <p className="mt-2">
            {t.rich("s6Body", {
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
