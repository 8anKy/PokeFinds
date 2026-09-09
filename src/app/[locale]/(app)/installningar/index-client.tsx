"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { IconSearch } from "@/components/ui/icons";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { RestockPausedBanner } from "@/components/features/restock-paused-banner";
import type { SettingsUser } from "./settings-user";
import { SettingsLinkRow, SettingsSection } from "./settings-ui";
import { PlanRow } from "./sections";

/**
 * Inställningarnas REGISTER (2026-09-09, ägarens val av riktning B).
 *
 * Förut låg arton reglage staplade på en enda sida. Nu säger första skärmen vad
 * som är PÅ — resten bor på fem undersidor i samma grupperade form.
 *
 * ⛔ SAMMANFATTNINGARNA RÄKNAS UR SAMMA DATA SOM UNDERSIDAN VISAR. En handskriven
 * text ("E-post och veckobrev på") hade blivit fel den dag en spak byter default
 * eller döljs, och en rad som ljuger om sitt eget innehåll är värre än ingen rad.
 *
 * ⛔ SÖKET ÄR HELA POÄNGEN med uppdelningen: den som delar upp en lång sida i fem
 * måste ge tillbaka ett sätt att hitta utan att gissa vilken av de fem. Träffarna
 * är de ENSKILDA inställningarna, inte sidorna — man söker på "veckobrev", inte
 * på "notiser".
 */
export function SettingsIndex({ user }: { user: SettingsUser }) {
  const t = useTranslations("Settings");
  const [query, setQuery] = useState("");

  /** Slår ihop det som är påslaget till en rad; inget påslaget → ett ord. */
  const join = (parts: string[]) => (parts.length ? parts.join(" · ") : t("summaryNone"));

  const notif = user.notificationSettings;
  const notifSummary = join(
    [
      notif.email && t("notifEmail"),
      notif.weekly && t("notifWeekly"),
      notif.news && t("notifNews"),
      user.isPro && notif.allRestocks && t("notifAll"),
      notif.push && t("notifPush"),
    ].filter((s): s is string => typeof s === "string")
  );

  const visibilitySummary = join(
    [
      user.isPublicCollection && t("publicCollection"),
      user.communityV2 && user.allowPurchaseRequests && t("allowPurchaseRequests"),
    ].filter((s): s is string => typeof s === "string")
  );

  const connectionsSummary = join(
    [
      user.discordEnabled && user.discordUsername && t("discordTitle"),
      user.traderaUserId && t("traderaTitle"),
    ].filter((s): s is string => typeof s === "string")
  );

  const pages = [
    {
      href: "/installningar/profil",
      label: t("profileTitle"),
      summary: `${user.name} · ${user.email}`,
      // Träffar när man söker på det som FAKTISKT bor på sidan.
      terms: [t("nameLabel"), t("emailLabel"), t("languageTitle")],
    },
    {
      href: "/installningar/notiser",
      label: t("notifTitle"),
      summary: notifSummary,
      terms: [t("notifEmail"), t("notifWeekly"), t("notifNews"), t("notifAll"), t("notifPush")],
    },
    {
      href: "/installningar/synlighet",
      label: t("visibilityTitle"),
      summary: visibilitySummary,
      terms: [t("publicCollection"), t("allowPurchaseRequests")],
    },
    {
      href: "/installningar/kopplingar",
      label: t("connectionsTitle"),
      summary: connectionsSummary,
      terms: [t("discordTitle"), t("traderaTitle"), t("traderaShowOnProfile")],
    },
    {
      href: "/installningar/konto",
      label: t("gdprTitle"),
      summary: t("accountSummary"),
      terms: [t("exportData"), t("deleteAccount")],
    },
  ];

  const q = query.trim().toLowerCase();
  const hits = useMemo(() => {
    if (!q) return [];
    return pages.flatMap((p) =>
      p.terms
        .filter((term) => term.toLowerCase().includes(q))
        .map((term) => ({ href: p.href, term, page: p.label }))
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  return (
    <div className="space-y-[26px]">
      <RestockPausedBanner />

      <label className="flex h-11 items-center gap-2.5 rounded-full border border-surface-border bg-surface-overlay px-3.5">
        <IconSearch size={18} className="shrink-0 text-ink-faint" />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("searchPlaceholder")}
          aria-label={t("searchPlaceholder")}
          className="min-w-0 flex-1 bg-transparent text-[15px] text-ink outline-none placeholder:text-ink-faint"
        />
      </label>

      {q ? (
        hits.length > 0 ? (
          <SettingsSection>
            {hits.map((hit) => (
              <SettingsLinkRow
                key={`${hit.href}-${hit.term}`}
                href={hit.href}
                label={hit.term}
                hint={hit.page}
              />
            ))}
          </SettingsSection>
        ) : (
          <p className="px-1.5 text-[13px] text-ink-faint">{t("searchEmpty", { query: query.trim() })}</p>
        )
      ) : (
        <>
          <SettingsSection>
            {pages.map((p) => (
              <SettingsLinkRow key={p.href} href={p.href} label={p.label} hint={p.summary} />
            ))}
          </SettingsSection>

          {/* Två val som INTE förtjänar en egen sida: språket byts på plats, och
              planen är en rad som öppnar paywall-arket. */}
          <SettingsSection>
            <div className="flex items-center justify-between border-b border-surface-border px-4 py-3 last:border-b-0">
              <span className="text-[15px] font-medium tracking-[-0.005em] text-ink">
                {t("languageTitle")}
              </span>
              <LocaleSwitcher />
            </div>
          </SettingsSection>

          <PlanRow user={user} />
        </>
      )}
    </div>
  );
}
