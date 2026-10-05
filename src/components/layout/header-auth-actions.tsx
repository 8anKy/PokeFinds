"use client";

import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { LinkButton } from "@/components/ui/button";
import { IconUser } from "@/components/ui/icons";
import { useAuthHint } from "@/lib/auth-hint";
import { AccountMenu } from "@/components/layout/account-menu";

/**
 * Header-knapparna som beror på inloggning. Läses från fo_auth-cookien (klient,
 * efter mount) i stället för useSession → ingen /api/auth/session-hämtning per
 * sidvisning (det brände Vercel Active CPU). SiteHeader/marketing-layouten slipper
 * server-`auth()` och kan ISR-cachas. Före mount (= SSR) visas en spacer.
 */
export function HeaderAuthActions() {
  const t = useTranslations("HeaderActions");
  const loggedIn = useAuthHint();

  if (loggedIn === null) {
    // Före mount: reservera ungefär samma bredd så headern inte hoppar vid hydrering.
    return <div className="h-9 w-32" aria-hidden />;
  }

  if (loggedIn) {
    return (
      <>
        {/* Desktop (≥sm-tall): kontomeny med avatar — samlar Bevakningar/
            AI-gradering/Min samling/Inställningar/Logga ut.
            Höjdgrindad precis som toppnavigeringen: en telefon på tvären är
            inte desktop (se tailwind.config-screens). */}
        <div className="hidden sm-tall:block">
          <AccountMenu />
        </div>
        {/* Telefon: headern scrollar bort och bottentabbarna är navet — behåll
            den enkla profilikonen som förr. */}
        <Link
          href="/installningar"
          aria-label={t("profile")}
          className="flex h-9 w-9 items-center justify-center rounded-full border border-surface-border text-ink-muted hover:border-holo-cyan/40 hover:text-holo-cyan sm-tall:hidden"
        >
          <IconUser size={18} />
        </Link>
      </>
    );
  }

  // Telefon: Discord bredvid loggan + nyhetsikonen delar raden med de här två,
  // så CTA:n kortas till "Gå med" under sm (vid 360 px bröt "Gå med gratis"
  // annars på två rader). nowrap så en smal skärm aldrig delar en knapptext.
  return (
    <>
      <LinkButton href="/logga-in" variant="ghost" size="sm" className="whitespace-nowrap px-2 sm:px-3">
        {t("login")}
      </LinkButton>
      <LinkButton href="/registrera" variant="primary" size="sm" className="whitespace-nowrap">
        <span className="sm:hidden">{t("joinShort")}</span>
        <span className="hidden sm:inline">{t("joinFree")}</span>
      </LinkButton>
    </>
  );
}
