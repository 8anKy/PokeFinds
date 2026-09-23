/**
 * /guider — listan över Foilios set-guider och köpguider.
 *
 * ⛔ INGEN DB, INGEN `auth()`: innehållet är en incheckad fil (`src/content/guides.ts`)
 *    och sidan är helstatisk. Nås via sidfoten, sitemapen och länken på setsidorna.
 */
import type { Metadata } from "next";
import { getLocale, getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { alternatesFor, baseOpenGraph } from "@/lib/canonical";
import { formatDate } from "@/lib/format";
import { guidesNewestFirst } from "@/content/guides";
import { KIND_KEY } from "@/components/features/guide-kind";
import { IconArrowRight } from "@/components/ui/icons";

export async function generateMetadata({ params }: { params: { locale: string } }): Promise<Metadata> {
  const t = await getTranslations({ locale: params.locale, namespace: "Guides" });
  return {
    title: t("metaTitle"),
    description: t("metaDescription"),
    alternates: alternatesFor(params.locale, "/guider"),
    openGraph: { ...baseOpenGraph(params.locale), title: t("metaTitle"), description: t("metaDescription") },
  };
}

export default async function GuidesPage({ params }: { params: { locale: string } }) {
  setRequestLocale(params.locale);
  const t = await getTranslations("Guides");
  const locale = await getLocale();
  const guides = guidesNewestFirst();

  return (
    <div className="mx-auto max-w-3xl px-2.5 py-10 sm:px-6 lg:py-16">
      <h1 className="font-display text-3xl font-bold text-ink">{t("h1")}</h1>
      <p className="mt-3 text-pretty text-sm leading-relaxed text-ink-muted">{t("intro")}</p>
      {locale !== "sv" && <p className="mt-2 text-xs text-ink-faint">{t("swedishOnly")}</p>}

      <ul className="mt-8 flex flex-col gap-3">
        {guides.map((g) => (
          <li key={g.slug}>
            <Link
              href={`/guider/${g.slug}`}
              className="card-surface group flex items-start gap-3 p-4 transition-colors duration-150 hover:border-holo-cyan/40"
            >
              <div className="min-w-0 flex-1">
                <div className="text-[10px] font-bold uppercase tracking-[0.1em] text-holo-cyan">
                  {t(KIND_KEY[g.kind])}
                </div>
                <h2 className="mt-1 text-pretty text-base font-semibold leading-snug text-ink">{g.title}</h2>
                <p className="mt-1 text-pretty text-sm leading-relaxed text-ink-muted">{g.description}</p>
                <p className="mt-2 text-xs tabular-nums text-ink-faint">
                  {t("updated", { date: formatDate(g.updatedAt, locale) })}
                </p>
              </div>
              <IconArrowRight
                size={18}
                className="mt-1 shrink-0 text-ink-faint transition-colors duration-150 group-hover:text-holo-cyan"
              />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
