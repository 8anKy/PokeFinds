import { getTranslations } from "next-intl/server";
import { LinkButton } from "@/components/ui/button";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { FoilPanel, FollowTiles, MenuRow, Section, type MenuLink } from "./more-ui";

/**
 * "Mer" för en GÄST (2026-09-05). Förut: omdirigering till inloggningen utan ett
 * ord om varför. Nu: språk, om oss/villkor/integritet/cookies/kontakt, Discord —
 * och inloggning/registrering som en tydlig rad, inte som hela sidan.
 *
 * 2026-09-09: samma skal som den inloggade sidan (more-ui.tsx). Foliekortet står
 * överst här också, men TOMT — det visar vad ett konto ÄR i stället för att
 * beskriva det: samma kort, ditt namn saknas, planen står "Gäst". Det är den
 * enda platsen på sidan som ber om något.
 *
 * ⛔ Kortet är INTE en länk här (till skillnad från den inloggades): det bär två
 * knappar, och en länk runt två knappar gör hela kortet till en tredje, otydlig
 * träffyta.
 */
export async function GuestMore() {
  const t = await getTranslations("More");
  // Dokumentrader utan ikon med flit — sex olika glyfer för sex texter hade
  // blivit samma dekorbrus som färgerna på den gamla sidan.
  const info: MenuLink[] = [
    { href: "/om", label: t("guestAbout") },
    { href: "/priser", label: t("guestPricing") },
    { href: "/villkor", label: t("guestTerms") },
    { href: "/integritetspolicy", label: t("guestPrivacy") },
    { href: "/cookies", label: t("guestCookies") },
    { href: "/kontakt", label: t("guestContact") },
  ];

  return (
    <div className="mx-auto max-w-md space-y-[26px]">
      <FoilPanel>
        <span className="flex items-start justify-between">
          <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-faint">
            {t("cardRole")}
          </span>
          <span className="rounded-full border border-ink/20 px-2.5 py-[3px] text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-muted">
            {t("guestChip")}
          </span>
        </span>
        <span className="mt-[26px] block font-display text-[27px] font-bold leading-8 tracking-[-0.03em] text-ink">
          {t("guestCardTitle")}
        </span>
        <span className="mt-1.5 block text-[13px] leading-[18px] text-ink-muted">
          {t("guestAccountBody")}
        </span>
        <span className="mt-5 flex gap-2 border-t border-ink/10 pt-4">
          <LinkButton href="/registrera" size="sm">
            {t("guestRegister")}
          </LinkButton>
          <LinkButton href="/logga-in?callbackUrl=%2Fmer" size="sm" variant="outline">
            {t("guestLogin")}
          </LinkButton>
        </span>
      </FoilPanel>

      {/* Språk står ensamt: det är sidans enda inställning för den utan konto. */}
      <div className="flex items-center justify-between rounded-[14px] border border-surface-border px-4 py-3">
        <span className="text-[15px] font-medium tracking-[-0.005em] text-ink">
          {t("guestLanguage")}
        </span>
        <LocaleSwitcher />
      </div>

      <Section title={t("guestInfoTitle")}>
        {info.map((l) => (
          <MenuRow key={l.href} link={l} />
        ))}
      </Section>

      <FollowTiles title={t("followTitle")} />
    </div>
  );
}
