import type { Metadata } from "next";
import { alternatesFor } from "@/lib/canonical";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { legalEntity } from "@/lib/legal-entity";

export async function generateMetadata({
  params,
}: {
  params: { locale: string };
}): Promise<Metadata> {
  const t = await getTranslations({ locale: params.locale, namespace: "Terms" });
  return {
    title: t("metaTitle"),
    description: t("metaDescription"),
    alternates: alternatesFor(params.locale, "/villkor"),
  };
}

/**
 * Användarvillkoren, omskrivna 2026-08-08 efter gapanalysen i det privata
 * systerrepot (TERMS-GAP.md): 20 sektioner som täcker hela dagens produktyta
 * (skanner, gradering, larm, Tradera-sälj, Discord, rangordning, Pro på webben).
 *
 * ⚠️ Publicerade som utkast per ägarbeslut 2026-08-08; en svensk jurist ska läsa
 * hela paketet i efterhand. All copy bor i messages/{sv,en}.json → Terms.
 *
 * Brödtext delas på "\n\n" till stycken — så slipper varje stycke en egen nyckel.
 */
export default async function TermsPage({
  params,
}: {
  params: { locale: string };
}) {
  setRequestLocale(params.locale);
  const t = await getTranslations("Terms");
  const tLegal = await getTranslations("Legal");
  const useItems = t.raw("s3Items") as string[];
  const inviteItems = t.raw("s20Items") as string[];
  // Säljarens identitet kommer från miljön, aldrig från repot — se lib/legal-entity.
  const entity = legalEntity();

  const Paragraphs = ({ text }: { text: string }) => (
    <>
      {text.split("\n\n").map((p, i) => (
        <p key={i} className="mt-2">
          {p}
        </p>
      ))}
    </>
  );

  /** Sektioner som bara är rubrik + stycken, i tre block runt specialsektionerna. */
  const beforeUse = ["s1", "s2"] as const; // → sedan s3 (punktlista)
  const afterUse = ["s4", "s5", "s6", "s7"] as const; // → sedan s8 (ankare) + s11 (skäligt bruk)
  const afterPro = ["s12", "s13", "s14", "s15", "s16", "s17"] as const; // → sedan s18 (e-postlänk), s19, s20

  return (
    <article className="mx-auto max-w-3xl px-2.5 py-16 sm:px-6">
      <h1 className="font-display text-3xl font-bold text-ink">{t("h1")}</h1>
      <p className="mt-2 text-sm text-ink-faint">{tLegal("lastUpdated", { date: t("updated") })}</p>

      <div className="mt-8 space-y-8 text-sm leading-relaxed text-ink-muted [&_h2]:font-display [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-ink">
        <p>{t("intro")}</p>

        {beforeUse.map((key) => (
          <section key={key}>
            <h2>{t(`${key}Title`)}</h2>
            <Paragraphs text={t(`${key}Body`)} />
          </section>
        ))}

        <section>
          <h2>{t("s3Title")}</h2>
          <p className="mt-2">{t("s3Intro")}</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {useItems.map((item, i) => (
              <li key={i}>{item}</li>
            ))}
          </ul>
          <Paragraphs text={t("s3Outro")} />
        </section>

        {afterUse.map((key) => (
          <section key={key}>
            <h2>{t(`${key}Title`)}</h2>
            <Paragraphs text={t(`${key}Body`)} />
          </section>
        ))}

        {/* id: rankningstransparensen ska gå att länka till från sorteringskontrollen. */}
        <section id="rangordning">
          <h2>{t("s8Title")}</h2>
          <Paragraphs text={t("s8Body")} />
        </section>

        <section>
          <h2>{t("s9Title")}</h2>
          <Paragraphs text={t("s9Body")} />
        </section>

        <section>
          <h2>{t("s10Title")}</h2>
          <Paragraphs text={t("s10Body")} />
        </section>

        <section>
          <h2>{t("s11Title")}</h2>
          <Paragraphs text={t("s11Body")} />
          {/* SKÄLIGT BRUK. Egen nyckel med flit: talet 1 000 är ett avtalsvillkor
              parat med PREMIUM_FAIR_USE i koden — ändra dem tillsammans. */}
          <p className="mt-2">{t("s11FairUse")}</p>
        </section>

        {afterPro.map((key) => (
          <section key={key}>
            <h2>{t(`${key}Title`)}</h2>
            <Paragraphs text={t(`${key}Body`)} />
          </section>
        ))}

        <section>
          <h2>{t("s18Title")}</h2>
          <p className="mt-2">
            {t.rich("s18Body", {
              email: (chunks) => (
                <a href="mailto:hej@foilio.se" className="text-holo-cyan hover:underline">
                  {chunks}
                </a>
              ),
            })}
          </p>
          <p className="mt-2">{t("s18Arn")}</p>
          <p className="mt-2">{t("s18Law")}</p>
        </section>

        <section id="inbjudningar">
          <h2>{t("s20Title")}</h2>
          <p className="mt-2">{t("s20Intro")}</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {inviteItems.map((item, i) => (
              <li key={i}>{item}</li>
            ))}
          </ul>
        </section>

        {/* E-handelslagen 8 §. Renderas bara när uppgifterna är KOMPLETTA —
            se legalEntity(); ett halvt företagsblock ser ut att uppfylla kravet
            utan att göra det. Checkout vägrar dessutom sälja utan dem. */}
        {entity && (
          <section id="foretagsuppgifter">
            <h2>{t("companyTitle")}</h2>
            <p className="mt-2">{t("companyIntro")}</p>
            <dl className="mt-3 space-y-1">
              <div>
                <dt className="inline font-medium text-ink">{t("companyName")}: </dt>
                <dd className="inline">{entity.name}</dd>
              </div>
              <div>
                <dt className="inline font-medium text-ink">{t("companyAddress")}: </dt>
                <dd className="inline">{entity.addressLines.join(", ")}</dd>
              </div>
              <div>
                <dt className="inline font-medium text-ink">{t("companyVat")}: </dt>
                <dd className="inline">{entity.vatNumber}</dd>
              </div>
              <div>
                <dt className="inline font-medium text-ink">{t("companyEmail")}: </dt>
                <dd className="inline">
                  <a
                    href={`mailto:${entity.email}`}
                    className="text-holo-cyan hover:underline"
                  >
                    {entity.email}
                  </a>
                </dd>
              </div>
            </dl>
          </section>
        )}
      </div>
    </article>
  );
}
