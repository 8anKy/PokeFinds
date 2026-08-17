import type { Metadata } from "next";
import { alternatesFor } from "@/lib/canonical";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { IconDiscord } from "@/components/ui/brand-icons";
import { landingInviteUrl } from "@/lib/discord-invites";

/**
 * Landningssidan för Foilios Discord-server.
 *
 * ⛔ VARFÖR SIDAN FINNS (2026-08-17, ägarbeslut). Målet var "ligg överst när någon
 * söker på pokemon tcg sverige discord". Det målet går INTE att nå med metadata:
 * en `discord.gg/<kod>`-inbjudan är en tunn sida vi inte äger och inte kan
 * optimera, och en utgående länk från vår sajt hjälper aldrig mottagarens
 * rankning. Frågan vinns av en sida vars TEXT handlar om servern — den här.
 *
 * ⛔ COPYN LOVAR BARA SÅDANT SOM FAKTISKT KÖRS. "Oftast inom en minut" är samma
 * mätta siffra som restock-tipset använder (~45–60 s Shopify/Webhallen, ~2 min för
 * de långsammare) — inte "direkt", som varje butiksnyhetsbrev redan skriver.
 * "Över 40 butiker" i stället för ett exakt tal: siffran växer med varje ny
 * adapter och en sida ingen minns att uppdatera blir en osann sida.
 *
 * ⛔ INGEN DB, INGEN `auth()`. Sidan är helstatisk och ligger i (marketing) —
 * hade den läst sessionen för att dölja "gå med"-knappen för befintliga medlemmar
 * hade HELA appen blivit dynamisk (se Caching/ISR i CLAUDE.md). Vi kan ändå inte
 * veta vem som redan är med utan att fråga Discord.
 *
 * Inbjudningslänken går via `landingInviteUrl()` och inte `DISCORD_URL`: Discord
 * räknar användningar per kod, så en egen kod är enda sättet att se om sökandet
 * faktiskt levererar medlemmar. Se lib/discord-invites.ts.
 */

export async function generateMetadata({
  params,
}: {
  params: { locale: string };
}): Promise<Metadata> {
  const t = await getTranslations({ locale: params.locale, namespace: "Discord" });
  return {
    title: t("metaTitle"),
    description: t("metaDescription"),
    alternates: alternatesFor(params.locale, "/discord"),
  };
}

export default async function DiscordPage({
  params,
}: {
  params: { locale: string };
}) {
  setRequestLocale(params.locale);
  const t = await getTranslations("Discord");
  const insideItems = [1, 2, 3, 4] as const;
  const invite = landingInviteUrl();

  return (
    <article className="mx-auto max-w-3xl px-2.5 py-16 sm:px-6">
      <h1 className="font-display text-3xl font-bold text-ink">{t("h1")}</h1>
      <p className="mt-2 text-sm text-ink-faint">{t("subtitle")}</p>

      <p className="mt-8 text-sm leading-relaxed text-ink-muted">{t("intro")}</p>

      <div className="card-surface mt-8 flex flex-col items-start gap-4 p-6">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-holo-cyan/10 text-holo-cyan">
          <IconDiscord size={20} />
        </div>
        <a
          href={invite}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex h-12 items-center justify-center gap-2 rounded-lg bg-holo-cyan px-6 text-base font-semibold text-surface transition-all duration-200 ease-out hover:bg-holo-cyan/90 hover:shadow-glow active:scale-[0.97] active:bg-holo-cyan/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-holo-cyan focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
        >
          <IconDiscord size={18} />
          {t("cta")}
        </a>
        <p className="text-xs text-ink-faint">{t("ctaNote")}</p>
      </div>

      <div className="mt-10 space-y-8 text-sm leading-relaxed text-ink-muted [&_h2]:font-display [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-ink">
        <section>
          <h2>{t("insideTitle")}</h2>
          <ul className="mt-2 list-disc space-y-2 pl-5">
            {insideItems.map((n) => (
              <li key={n}>
                <strong>{t(`inside${n}Lead`)}</strong>: {t(`inside${n}Text`)}
              </li>
            ))}
          </ul>
        </section>

        <section>
          <h2>{t("whoTitle")}</h2>
          <p className="mt-2">{t("whoBody")}</p>
        </section>

        <section>
          <h2>{t("rulesTitle")}</h2>
          <p className="mt-2">{t("rulesBody")}</p>
        </section>

        <section>
          <h2>{t("alsoTitle")}</h2>
          <p className="mt-2">
            {t.rich("alsoBody", {
              catalog: (chunks) => (
                <Link href="/produkter" className="text-holo-cyan hover:underline">
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
