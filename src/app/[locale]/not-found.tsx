import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { LinkButton } from "@/components/ui/button";

/**
 * 404-sidan saknade egen titel (2026-08-17) och ärvde därför rot-layoutens
 * `Meta.title` ORDAGRANT — varje död länk såg i fliken, historiken och
 * bokmärkena ut som sajtens startsida. Rot-layoutens
 * `template: "%s | Foilio"` gör detta till "Sidan kunde inte hittas | Foilio".
 *
 * ⚠️ Raden når `<title>` men INTE `og:title`. Rot-layouten sätter
 * `openGraph.title` EXPLICIT, och Nexts merge kopierar bara de nycklar barnet
 * självt anger — `openGraph` ärvs alltså ned orörd och en DELAD 404-länk visar
 * fortfarande startsidans rubrik. Att bara lägga till `openGraph: { title }`
 * här vore värre än problemet: merge:n är GRUND per toppfält, så raden hade
 * nollat delningsbild/siteName/og:locale för sidan. Rätt fix kräver
 * `baseOpenGraph()` — inte gjort, 404:an delas sällan med avsikt.
 *
 * ⛔ INGET `robots: { index: false }` här. Sidan levereras med HTTP 404 och Next
 * lägger själv in noindex på not-found-renderingar — en till vore ren brus, och
 * brus i robots-metadata är det man senare felsöker i tron att det betyder något.
 *
 * Copyn följer språket sedan 2026-09-05 (NotFound-namnrymden) — förut var den
 * hårdkodad svenska och en besökare på /en/ fick en svensk 404.
 */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("NotFound");
  // Samma ordalydelse som sidans egen <h1>, med flit: fliken och rubriken är två
  // vyer av samma sida, och två olika formuleringar läser som två olika fel.
  return { title: t("title") };
}

export default function NotFound() {
  const t = useTranslations("NotFound");
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-surface px-4 text-center">
      <p className="holo-text font-display text-7xl font-bold">404</p>
      <h1 className="mt-4 font-display text-2xl font-bold text-ink">{t("title")}</h1>
      <p className="mt-2 max-w-md text-ink-muted">{t("body")}</p>
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <LinkButton href="/">{t("home")}</LinkButton>
        <LinkButton href="/produkter" variant="outline">
          {t("explore")}
        </LinkButton>
      </div>
      <Link href="/marknad" className="mt-6 text-sm text-ink-muted hover:text-ink">
        {t("market")}
      </Link>
    </div>
  );
}
