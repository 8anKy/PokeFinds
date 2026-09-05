import { Link } from "@/i18n/navigation";
import { HeaderNav } from "@/components/layout/header-nav";
import { HeaderAuthActions } from "@/components/layout/header-auth-actions";
import { BrandLogo } from "@/components/layout/brand-logo";
import { AppStoreBadge } from "@/components/layout/app-store-badge";
import { DiscordLink } from "@/components/layout/discord-link";
import { SiteHeaderGate } from "@/components/layout/site-header-gate";

export function SiteHeader() {
  // Mobil: headern scrollar bort (bottom-tabs är navet) → blockerar inte innehåll.
  // Desktop: sticky som vanligt.
  // UNDERSIDOR (lib/subpage-routes.ts) visar inget logotyphuvud alls på mobil —
  // där bär `SubpageHeader`/produktvyns bakåtcirkel raden (ägarbeslut 2026-09-05).
  return (
    <SiteHeaderGate>
    <header className="hairline-b z-40 bg-surface/85 backdrop-blur-md lg:sticky lg:top-0">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-2.5 sm:px-6">
        {/* Logon var AVSIKTLIGT oklickbar så länge "/" var marknadsförings-sidan —
            i appen ledde den till en pitch i stället för något användbart. Nu när
            startsidan ÄR Utforska försvann det skälet, så logon får bete sig som
            användare förväntar sig. Pekar på /produkter, inte "/", så klicket inte
            kostar en onödig omdirigering. */}
        <Link href="/produkter" aria-label="Foilio">
          <BrandLogo />
        </Link>
        <HeaderNav />
        <div className="flex items-center gap-2 sm:gap-3">
          {/* Discord ligger FÖRE App Store-brickan och visas i ALLA storlekar:
              brickan är webb-only (appanvändaren har redan appen), communityn
              gäller alla. Se discord-link.tsx. */}
          <DiscordLink />
          {/* App Store-brickan: desktop-headern är sticky → alltid i bild.
              Mobilen har sin egen bricka ovanför sökfältet (headern scrollar
              bort där); i native-appen döljer komponenten sig själv. */}
          <div className="hidden lg:block">
            <AppStoreBadge />
          </div>
          <HeaderAuthActions />
        </div>
      </div>
    </header>
    </SiteHeaderGate>
  );
}
