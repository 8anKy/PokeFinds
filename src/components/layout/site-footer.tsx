import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { BrandLogo } from "@/components/layout/brand-logo";

export async function SiteFooter() {
  const t = await getTranslations("Footer");
  return (
    <footer className="hidden border-t border-surface-border bg-surface-raised/50 lg:block">
      <div className="mx-auto grid max-w-7xl gap-8 px-4 py-12 sm:grid-cols-2 sm:px-6 lg:grid-cols-4">
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
            <li><Link href="/marknad" className="transition-colors duration-150 hover:text-ink">{t("marketTrends")}</Link></li>
            <li><Link href="/skanna" className="transition-colors duration-150 hover:text-ink">{t("scanCards")}</Link></li>
            <li><Link href="/priser" className="transition-colors duration-150 hover:text-ink">{t("pricingPro")}</Link></li>
          </ul>
        </div>
        <div>
          <p className="text-sm font-semibold text-ink">{t("communityHeading")}</p>
          <ul className="mt-3 space-y-2 text-sm text-ink-muted">
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
      <div className="border-t border-surface-border px-4 py-4 text-center text-xs text-ink-faint">
        {t("copyright", { year: String(new Date().getFullYear()) })}
      </div>
    </footer>
  );
}
