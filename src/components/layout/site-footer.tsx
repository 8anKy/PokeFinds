import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { BrandLogo } from "@/components/layout/brand-logo";
import { AdminOnly } from "@/components/admin-only";
import { REDDIT_URL } from "@/lib/social-links";

export async function SiteFooter() {
  const t = await getTranslations("Footer");
  return (
    <footer className="hidden border-t border-surface-border bg-surface-raised/50 lg:block">
      <div className="mx-auto grid max-w-7xl gap-8 px-2.5 py-12 sm:grid-cols-2 sm:px-6 lg:grid-cols-4">
        <div>
          <BrandLogo markSize={26} textClass="text-lg" />
          <p className="mt-2 text-sm text-ink-muted">
            {t("tagline")}
          </p>
        </div>
        <div>
          <p className="text-sm font-semibold text-ink">{t("serviceHeading")}</p>
          <ul className="mt-3 space-y-2 text-sm text-ink-muted">
            <li><Link href="/produkter" className="transition-colors duration-150 hover:text-ink">{t("exploreProducts")}</Link></li>
            {/* ⛔ /sets är den ENDA crawlbara vägen in i katalogen (2026-08-17).
                /produkter är force-dynamic och /produkter?… är blockerad i
                robots.txt av kostnadsskäl, så pagineringen går inte att följa:
                Googlebot ser bara sida 1. Set-sidorna är däremot statiska och
                listar sina produkter — men INGENTING länkade till /sets utom
                set-sidornas egen brödsmula, dvs en sluten cirkel. Upptäckten av
                ~20k produktsidor vilade därmed helt på XML-sitemapen.
                Länken här är den enda som bryter cirkeln — ta inte bort den. */}
            <li><Link href="/sets" className="transition-colors duration-150 hover:text-ink">{t("allSets")}</Link></li>
            {/* Marknad = admin-only, se HeaderNav. */}
            <AdminOnly>
              <li><Link href="/marknad" className="transition-colors duration-150 hover:text-ink">{t("marketTrends")}</Link></li>
            </AdminOnly>
            <li><Link href="/skanna" className="transition-colors duration-150 hover:text-ink">{t("scanCards")}</Link></li>
            <li><Link href="/priser" className="transition-colors duration-150 hover:text-ink">{t("pricingPro")}</Link></li>
          </ul>
        </div>
        <div>
          <p className="text-sm font-semibold text-ink">{t("communityHeading")}</p>
          <ul className="mt-3 space-y-2 text-sm text-ink-muted">
            {/* Intern länk till /discord — landningssidan är byggd för att fångas
                upp på sökningar om svenska Pokémon TCG-Discords, och en sida utan
                en enda intern länk är föräldralös: sitemapen räcker för att bli
                crawlad, men inte för att räknas som en sida sajten själv står för.
                ⛔ Headerns Discord-ikon pekar med flit RAKT på inbjudan (den som
                redan är inne i appen vill inte läsa en presentation först) — den
                här länken är för besökaren som ännu inte vet vad servern är. */}
            <li><Link href="/discord" className="transition-colors duration-150 hover:text-ink">{t("discord")}</Link></li>
            {/* Subredditen. ⛔ Extern URL, alltså <a> och inte <Link> — next-intl
                hade prefixat den med locale. Raden är inte pynt: Reddit publicerar
                ingen sitemap och robots.txt saknar Sitemap-direktiv, så länkar
                från sidor som redan kryps är hela vägen Google har att upptäcka en
                ny subreddit. ⛔ Ingen rel="me"/"nofollow" behövs — det är vår egen
                community, och den strukturerade identitetskopplingen görs i
                site-schema.tsx (sameAs). */}
            <li><a href={REDDIT_URL} target="_blank" rel="noopener noreferrer" className="transition-colors duration-150 hover:text-ink">{t("reddit")}</a></li>
            <li><Link href="/community" className="transition-colors duration-150 hover:text-ink">{t("feed")}</Link></li>
            <li><Link href="/community?kategori=PULLS" className="transition-colors duration-150 hover:text-ink">{t("pulls")}</Link></li>
            <li><Link href="/community?kategori=TRADES" className="transition-colors duration-150 hover:text-ink">{t("trades")}</Link></li>
          </ul>
        </div>
        <div>
          <p className="text-sm font-semibold text-ink">{t("aboutLegalHeading")}</p>
          <ul className="mt-3 space-y-2 text-sm text-ink-muted">
            <li><Link href="/om" className="transition-colors duration-150 hover:text-ink">{t("aboutFoilio")}</Link></li>
            <li><Link href="/kontakt" className="transition-colors duration-150 hover:text-ink">{t("contact")}</Link></li>
            <li><Link href="/villkor" className="transition-colors duration-150 hover:text-ink">{t("terms")}</Link></li>
            <li><Link href="/integritetspolicy" className="transition-colors duration-150 hover:text-ink">{t("privacy")}</Link></li>
            <li><Link href="/cookies" className="transition-colors duration-150 hover:text-ink">{t("cookies")}</Link></li>
          </ul>
        </div>
      </div>
      <div className="border-t border-surface-border px-2.5 py-4 text-center text-xs text-ink-faint">
        {t("copyright", { year: String(new Date().getFullYear()) })}
      </div>
    </footer>
  );
}
