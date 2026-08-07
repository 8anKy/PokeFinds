import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { legalEntity } from "@/lib/legal-entity";

export async function generateMetadata({
  params,
}: {
  params: { locale: string };
}): Promise<Metadata> {
  const t = await getTranslations({ locale: params.locale, namespace: "Privacy" });
  return { title: t("metaTitle"), description: t("metaDescription") };
}

type LeadItem = { lead: string; text: string };

export default async function PrivacyPage({
  params,
}: {
  params: { locale: string };
}) {
  setRequestLocale(params.locale);
  const t = await getTranslations("Privacy");
  const tLegal = await getTranslations("Legal");
  const data = t.raw("s2Items") as LeadItem[];
  const purposes = t.raw("s3Items") as LeadItem[];
  const rights = t.raw("s5Items") as LeadItem[];
  const processors = t.raw("s7Items") as LeadItem[];
  const recipients = t.raw("s7bItems") as LeadItem[];
  // GDPR art. 13: den personuppgiftsansvarige ska anges som juridisk person, inte
  // bara ett varumärke. Namnet kommer från miljön (samma källa som /villkor);
  // saknas det faller texten tillbaka på varumärket hellre än att sidan kraschar.
  const entityName = legalEntity()?.name ?? "Foilio";

  const LeadList = ({ items }: { items: LeadItem[] }) => (
    <ul className="mt-2 list-disc space-y-1 pl-5">
      {items.map((it, i) => (
        <li key={i}>
          {it.lead ? <strong className="text-ink">{it.lead}</strong> : null}
          {it.lead ? " " : ""}
          {it.text}
        </li>
      ))}
    </ul>
  );

  return (
    <article className="mx-auto max-w-3xl px-2.5 py-16 sm:px-6">
      <h1 className="font-display text-3xl font-bold text-ink">{t("h1")}</h1>
      <p className="mt-2 text-sm text-ink-faint">{tLegal("lastUpdated", { date: t("updated") })}</p>

      <div className="mt-8 space-y-8 text-sm leading-relaxed text-ink-muted [&_h2]:font-display [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-ink">
        <section>
          <h2>{t("s1Title")}</h2>
          <p className="mt-2">
            {t.rich("s1Body", {
              entity: entityName,
              email: (chunks) => (
                <a href="mailto:hej@foilio.se" className="text-holo-cyan hover:underline">
                  {chunks}
                </a>
              ),
            })}
          </p>
        </section>

        <section>
          <h2>{t("s2Title")}</h2>
          <LeadList items={data} />
        </section>

        <section>
          <h2>{t("s3Title")}</h2>
          <LeadList items={purposes} />
          <p className="mt-2">{t("s3Outro")}</p>
        </section>

        <section>
          <h2>{t("s4Title")}</h2>
          <p className="mt-2">{t("s4Body")}</p>
        </section>

        <section>
          <h2>{t("s5Title")}</h2>
          <p className="mt-2">{t("s5Intro")}</p>
          <LeadList items={rights} />
          <p className="mt-2">
            {t.rich("s5Outro", {
              b: (chunks) => <strong className="text-ink">{chunks}</strong>,
            })}
          </p>
        </section>

        <section>
          <h2>{t("s6Title")}</h2>
          <p className="mt-2">
            {t.rich("s6Body", {
              link: (chunks) => (
                <Link href="/cookies" className="text-holo-cyan hover:underline">
                  {chunks}
                </Link>
              ),
            })}
          </p>
        </section>

        <section>
          <h2>{t("s7Title")}</h2>
          <p className="mt-2">{t("s7Intro")}</p>
          <LeadList items={processors} />
          <p className="mt-2">{t("s7Outro")}</p>
        </section>

        {/* Självständigt ansvariga mottagare (Discord, Tradera, appbutikerna) —
            SKILDA från biträdeslistan ovan med flit: s7 påstår att varje post är
            bunden av biträdesavtal, och det är varken sant eller möjligt för de
            här. Att blanda in dem hade gjort inledningsmeningen falsk. */}
        <section>
          <h2>{t("s7bTitle")}</h2>
          <p className="mt-2">{t("s7bIntro")}</p>
          <LeadList items={recipients} />
          <p className="mt-2">{t("s7bOutro")}</p>
        </section>

        <section>
          <h2>{t("s8Title")}</h2>
          <p className="mt-2">
            {t.rich("s8Body", {
              link: (chunks) => (
                <Link href="/villkor" className="text-holo-cyan hover:underline">
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
