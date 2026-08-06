import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { legalEntity } from "@/lib/legal-entity";

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
  // Säljarens identitet kommer från miljön, aldrig från repot — se lib/legal-entity.
  const entity = legalEntity();

  return (
    <article className="mx-auto max-w-3xl px-2.5 py-16 sm:px-6">
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
          {/* SKÄLIGT BRUK. Pro säljs som obegränsad skanning, och koden har ett
              tak (PREMIUM_FAIR_USE, se services/scanner) som skyddar mot
              skenande loopar och kapade konton. Marknadsför man "obegränsat"
              mot ett dolt tak MÅSTE taket stå i villkoren — annars är siffran
              ett villkor kunden aldrig fått se. */}
          <p className="mt-2">{t("s6FairUse")}</p>
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

        <section>
          <h2>{t("s10Title")}</h2>
          <p className="mt-2">{t("s10Body")}</p>
          <p className="mt-2">{t("s10Cancel")}</p>
          {/* Köp i native-appen går via Apple/Google, inte via oss. Sägs upp där. */}
          <p className="mt-2">{t("s10Apps")}</p>
        </section>

        <section>
          <h2>{t("s11Title")}</h2>
          {/* Distansavtalslagen 2 kap.: för digitalt innehåll/digital tjänst
              upphör ångerrätten när leveransen påbörjats — men BARA om kunden
              uttryckligen samtyckt till det OCH informerats om att rätten går
              förlorad. Samtycket samlas i kassan (consent_collection i
              billing/checkout), och den här texten är informationen. Faller den
              ena bort håller inte den andra heller. */}
          <p className="mt-2">{t("s11Body")}</p>
          <p className="mt-2">{t("s11Waiver")}</p>
        </section>

        <section>
          <h2>{t("s12Title")}</h2>
          {/* Lag (2015:671) om alternativ tvistlösning i konsumentförhållanden
              4 § — näringsidkaren SKA informera om ARN. */}
          <p className="mt-2">{t("s12Body")}</p>
        </section>

        {/* E-handelslagen 8 §. Renderas bara när uppgifterna är KOMPLETTA —
            se legalEntity(); ett halvt företagsblock ser ut att uppfylla kravet
            utan att göra det. Checkout vägrar dessutom sälja utan dem. */}
        {entity && (
          <section>
            <h2>{t("s13Title")}</h2>
            <p className="mt-2">{t("s13Intro")}</p>
            <dl className="mt-3 space-y-1">
              <div>
                <dt className="inline font-medium text-ink">{t("s13Name")}: </dt>
                <dd className="inline">{entity.name}</dd>
              </div>
              <div>
                <dt className="inline font-medium text-ink">{t("s13Address")}: </dt>
                <dd className="inline">{entity.addressLines.join(", ")}</dd>
              </div>
              <div>
                <dt className="inline font-medium text-ink">{t("s13Vat")}: </dt>
                <dd className="inline">{entity.vatNumber}</dd>
              </div>
              <div>
                <dt className="inline font-medium text-ink">{t("s13Email")}: </dt>
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
