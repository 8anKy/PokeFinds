import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { LinkButton } from "@/components/ui/button";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { SOCIAL_CHANNELS } from "@/components/features/join-us-card";
import { IconChevronRight, IconExternalLink } from "@/components/ui/icons";

/**
 * "Mer" för en GÄST (2026-09-05). Förut: omdirigering till inloggningen utan ett
 * ord om varför. Nu: språk, om oss/villkor/integritet/cookies/kontakt, Discord —
 * och inloggning/registrering som en tydlig rad, inte som hela sidan.
 */
export async function GuestMore() {
  const t = await getTranslations("More");
  const legal: { href: string; label: string }[] = [
    { href: "/om", label: t("guestAbout") },
    { href: "/priser", label: t("guestPricing") },
    { href: "/villkor", label: t("guestTerms") },
    { href: "/integritetspolicy", label: t("guestPrivacy") },
    { href: "/cookies", label: t("guestCookies") },
    { href: "/kontakt", label: t("guestContact") },
  ];

  return (
    <div className="mx-auto max-w-md space-y-4">
      <header>
        <h1 className="font-display text-2xl font-bold text-ink">{t("h1")}</h1>
        <p className="mt-1 text-sm text-ink-muted">{t("guestSubtitle")}</p>
      </header>

      {/* Konto: två knappar, inte en vägg. */}
      <div className="rounded-2xl border border-holo-cyan/30 bg-holo-cyan/10 px-4 py-4">
        <p className="text-sm font-semibold text-ink">{t("guestAccountTitle")}</p>
        <p className="mt-1 text-xs text-ink-muted">{t("guestAccountBody")}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <LinkButton href="/registrera" size="sm">
            {t("guestRegister")}
          </LinkButton>
          <LinkButton href="/logga-in?callbackUrl=%2Fmer" size="sm" variant="outline">
            {t("guestLogin")}
          </LinkButton>
        </div>
      </div>

      {/* Språk */}
      <div className="flex items-center justify-between rounded-2xl border border-surface-border bg-surface-raised/40 px-4 py-3">
        <span className="text-sm font-medium text-ink">{t("guestLanguage")}</span>
        <LocaleSwitcher />
      </div>

      {/* Om Foilio + legal */}
      <div className="overflow-hidden rounded-2xl border border-surface-border bg-surface-raised/40">
        <p className="border-b border-surface-border px-4 py-3 text-sm font-semibold text-ink">
          {t("guestInfoTitle")}
        </p>
        <nav className="flex flex-col">
          {legal.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="flex items-center gap-3 border-b border-surface-border px-4 py-3 transition-colors last:border-b-0 hover:bg-surface-overlay/60 active:bg-surface-overlay"
            >
              <span className="flex-1 text-sm font-medium text-ink">{l.label}</span>
              <IconChevronRight size={18} className="shrink-0 text-ink-muted" />
            </Link>
          ))}
        </nav>
      </div>

      {/* Följ Foilio — samma lista som den inloggade sidan. */}
      <div className="overflow-hidden rounded-2xl border border-surface-border bg-surface-raised/40">
        <p className="border-b border-surface-border px-4 py-3 text-sm font-semibold text-ink">
          {t("followTitle")}
        </p>
        <nav className="flex flex-col">
          {SOCIAL_CHANNELS.map((c) => (
            <a
              key={c.label}
              href={c.href}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-3 border-b border-surface-border px-4 py-3 transition-colors last:border-b-0 hover:bg-surface-overlay/60 active:bg-surface-overlay"
            >
              <c.icon size={20} className="shrink-0 text-ink-muted" />
              <span className="flex-1 text-sm font-medium text-ink">{c.label}</span>
              <IconExternalLink size={16} className="shrink-0 text-ink-muted" />
            </a>
          ))}
        </nav>
      </div>
    </div>
  );
}
