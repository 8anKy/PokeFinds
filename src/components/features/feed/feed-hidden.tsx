/**
 * Vad en besökare ser när nyhets- och evenemangsytan är dold (se
 * `src/lib/news-feed-gate.ts`).
 *
 * ⛔ SAMMA COPY SOM 404-SIDAN, med flit: för den som gissat sig till URL:en FINNS
 *    sidan inte, och det är sanningen just nu. Att i stället skriva "kommer snart"
 *    vore att marknadsföra något ofärdigt på en sida ingen skulle ha hittat.
 * ⛔ Sidan sätter `robots: noindex` själv — se anroparna.
 */
import { useTranslations } from "next-intl";
import { LinkButton } from "@/components/ui/button";

export function FeedHidden() {
  const t = useTranslations("NotFound");
  return (
    <div className="mx-auto flex max-w-3xl flex-col items-center gap-4 px-2.5 py-20 text-center sm:px-6">
      <p className="holo-text font-display text-6xl font-bold">404</p>
      <h1 className="font-display text-2xl font-bold text-ink">{t("title")}</h1>
      <p className="max-w-md text-sm text-ink-muted">{t("body")}</p>
      <div className="mt-2">
        <LinkButton href="/produkter">{t("explore")}</LinkButton>
      </div>
    </div>
  );
}
