/**
 * /guider/[slug] — en guide ur `src/content/guides.ts`.
 *
 * ⛔ HELSTATISK: alla slugs prerenderas vid bygget (`generateStaticParams`), ingen DB,
 *    ingen `auth()`. En ändrad guide når besökarna med nästa deploy.
 * ⛔ Guiderna är skrivna på SVENSKA även under `/en/` — den kanoniska URL:en pekar
 *    därför alltid på svenska, så att Google inte ser två språkversioner av samma text.
 * ⛔ INGEN `notFound()` (samma skäl som /nyheter/[slug]): rot-`not-found.tsx` läser
 *    locale ur headers och fäller en statisk rutt med HTTP 500. En okänd slug får en
 *    egen "finns inte"-vy med noindex.
 * ⛔ Article-JSON-LD påstår bara det sidan visar: rubrik, beskrivning, datum och Foilio
 *    som utgivare. Ingen författarperson, inget betyg, ingen bild vi inte har.
 */
import type { Metadata } from "next";
import { getLocale, getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { baseOpenGraph, localeUrl } from "@/lib/canonical";
import { formatDate } from "@/lib/format";
import { GUIDES, getGuide, type GuideBlock } from "@/content/guides";
import { IconArrowRight, IconExternalLink } from "@/components/ui/icons";

export function generateStaticParams() {
  return routing.locales.flatMap((locale) => GUIDES.map((g) => ({ locale, slug: g.slug })));
}

/** Svenska är guidens enda språk ⇒ kanonisk URL = den svenska, på båda språken. */
function guideAlternates(path: string): Metadata["alternates"] {
  return { canonical: localeUrl("sv", path), languages: { sv: localeUrl("sv", path), "x-default": localeUrl("sv", path) } };
}

export async function generateMetadata({
  params,
}: {
  params: { locale: string; slug: string };
}): Promise<Metadata> {
  const t = await getTranslations({ locale: params.locale, namespace: "Guides" });
  const guide = getGuide(params.slug);
  if (!guide) return { title: t("notFound"), robots: { index: false, follow: false } };
  return {
    title: guide.title,
    description: guide.description,
    alternates: guideAlternates(`/guider/${guide.slug}`),
    openGraph: {
      ...baseOpenGraph(params.locale),
      type: "article",
      title: guide.title,
      description: guide.description,
      publishedTime: guide.publishedAt,
      modifiedTime: guide.updatedAt,
    },
  };
}

function Block({ block }: { block: GuideBlock }) {
  switch (block.type) {
    case "h":
      return <h2 className="mt-6 text-pretty font-display text-xl font-bold leading-snug text-ink">{block.text}</h2>;
    case "p":
      return <p className="text-pretty text-[15px] leading-relaxed text-ink-muted">{block.text}</p>;
    case "list":
      return (
        <ul className="list-disc space-y-2 pl-5 text-[15px] leading-relaxed text-ink-muted">
          {block.items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      );
    case "links":
      return (
        <ul className="flex flex-col divide-y divide-surface-border overflow-hidden rounded-2xl border border-surface-border bg-surface-overlay">
          {block.items.map((item) => (
            <li key={item.href}>
              <Link
                href={item.href}
                className="group flex min-h-[48px] items-center gap-3 px-4 py-2.5 transition-colors duration-150 hover:bg-surface-raised"
              >
                <div className="min-w-0 flex-1">
                  <div className="text-pretty text-sm font-semibold text-ink">{item.label}</div>
                  {item.note && <div className="text-xs text-ink-faint">{item.note}</div>}
                </div>
                <IconArrowRight
                  size={16}
                  className="shrink-0 text-ink-faint transition-colors duration-150 group-hover:text-holo-cyan"
                />
              </Link>
            </li>
          ))}
        </ul>
      );
  }
}

export default async function GuidePage({ params }: { params: { locale: string; slug: string } }) {
  setRequestLocale(params.locale);
  const t = await getTranslations("Guides");
  const locale = await getLocale();
  const guide = getGuide(params.slug);

  if (!guide) {
    return (
      <div className="mx-auto flex max-w-3xl flex-col items-center gap-4 px-2.5 py-20 text-center sm:px-6">
        <h1 className="font-display text-2xl font-bold text-ink">{t("notFound")}</h1>
        <p className="max-w-sm text-sm text-ink-muted">{t("notFoundBody")}</p>
        <Link
          href="/guider"
          className="inline-flex min-h-[44px] items-center rounded-xl border border-surface-border bg-surface-overlay px-4 text-sm font-semibold text-ink"
        >
          {t("breadcrumb")}
        </Link>
      </div>
    );
  }

  const path = `/guider/${guide.slug}`;
  const jsonLd = [
    {
      "@context": "https://schema.org",
      "@type": "Article",
      headline: guide.title,
      description: guide.description,
      inLanguage: "sv-SE",
      datePublished: guide.publishedAt,
      dateModified: guide.updatedAt,
      mainEntityOfPage: localeUrl("sv", path),
      author: { "@type": "Organization", name: "Foilio", url: localeUrl("sv", "/") },
      publisher: { "@type": "Organization", name: "Foilio", url: localeUrl("sv", "/") },
    },
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: t("breadcrumb"), item: localeUrl(params.locale, "/guider") },
        { "@type": "ListItem", position: 2, name: guide.title, item: localeUrl(params.locale, path) },
      ],
    },
  ];

  return (
    <article className="mx-auto max-w-3xl px-2.5 pb-[calc(var(--bottom-tabs-space)+2rem)] pt-6 sm:px-6 lg:pb-16 lg:pt-10">
      {/* <-escapen: JSON.stringify escapar inte "<". */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }}
      />
      <nav aria-label={t("breadcrumb")} className="text-sm text-ink-muted">
        <Link href="/guider" className="hover:text-ink">
          {t("breadcrumb")}
        </Link>
      </nav>

      <div className="mt-4 text-[10px] font-bold uppercase tracking-[0.1em] text-holo-cyan">
        {guide.kind === "set" ? t("kindSet") : t("kindGuide")}
      </div>
      <h1 className="mt-2 text-pretty font-display text-[28px] font-bold leading-[1.15] tracking-[-0.02em] text-ink sm:text-4xl">
        {guide.title}
      </h1>
      <p className="mt-2 text-xs tabular-nums text-ink-faint">
        {t("updated", { date: formatDate(guide.updatedAt, locale) })}
        {locale !== "sv" && <> · {t("swedishOnly")}</>}
      </p>

      <p className="mt-5 text-pretty text-[17px] leading-relaxed text-ink">{guide.intro}</p>

      {guide.facts && guide.facts.length > 0 && (
        <section className="card-surface mt-6 p-4 sm:p-5">
          <h2 className="text-[10px] font-bold uppercase tracking-[0.1em] text-ink-faint">{t("factsTitle")}</h2>
          <dl className="mt-3 flex flex-col gap-3">
            {guide.facts.map((f) => (
              <div key={f.label} className="flex flex-col gap-0.5 sm:grid sm:grid-cols-[11rem_1fr] sm:gap-4">
                <dt className="text-xs font-semibold text-ink-muted sm:text-sm">{f.label}</dt>
                <dd className="min-w-0 text-pretty text-sm text-ink">{f.value}</dd>
              </div>
            ))}
          </dl>
          {guide.setId && (
            <Link
              href={`/sets/${guide.setId}`}
              className="mt-4 inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-holo-cyan px-4 text-sm font-semibold text-surface transition-colors duration-150 hover:bg-holo-cyan/90"
            >
              {t("seeSet")}
              <IconArrowRight size={16} />
            </Link>
          )}
        </section>
      )}

      <div className="mt-6 flex flex-col gap-4">
        {guide.body.map((block, i) => (
          <Block key={i} block={block} />
        ))}
      </div>

      {guide.sources.length > 0 && (
        <section className="mt-10 border-t border-surface-border pt-5">
          <h2 className="text-[10px] font-bold uppercase tracking-[0.1em] text-ink-faint">{t("sourcesTitle")}</h2>
          <ul className="mt-3 flex flex-col gap-2">
            {guide.sources.map((s) => (
              <li key={s.url}>
                <a
                  href={s.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-start gap-1.5 break-words text-xs text-ink-muted hover:text-ink"
                >
                  <IconExternalLink size={12} className="mt-0.5 shrink-0" />
                  <span className="min-w-0">{s.label}</span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}
    </article>
  );
}
