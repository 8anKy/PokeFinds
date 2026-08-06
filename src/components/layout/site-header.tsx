import { Link } from "@/i18n/navigation";
import { HeaderNav } from "@/components/layout/header-nav";
import { HeaderAuthActions } from "@/components/layout/header-auth-actions";
import { BrandLogo } from "@/components/layout/brand-logo";

export function SiteHeader() {
  // Mobil: headern scrollar bort (bottom-tabs är navet) → blockerar inte innehåll.
  // Desktop: sticky som vanligt.
  return (
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
        <div className="flex items-center gap-3">
          <HeaderAuthActions />
        </div>
      </div>
    </header>
  );
}
