"use client";

import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { LinkButton } from "@/components/ui/button";
import { IconUser } from "@/components/ui/icons";
import { useAuthHint } from "@/lib/auth-hint";

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
        <LinkButton href="/dashboard" variant="primary" size="sm" className="hidden sm:inline-flex">
          {t("overview")}
        </LinkButton>
        <Link
          href="/installningar"
          aria-label={t("profile")}
          className="flex h-9 w-9 items-center justify-center rounded-full border border-surface-border text-ink-muted hover:border-holo-cyan/40 hover:text-holo-cyan"
        >
          <IconUser size={18} />
        </Link>
      </>
    );
  }

  return (
    <>
      <LinkButton href="/logga-in" variant="ghost" size="sm">
        {t("login")}
      </LinkButton>
      <LinkButton href="/registrera" variant="primary" size="sm">
        {t("joinFree")}
      </LinkButton>
    </>
  );
}
