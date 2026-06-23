import Link from "next/link";
import { HeaderNav } from "@/components/layout/header-nav";
import { HeaderAuthActions } from "@/components/layout/header-auth-actions";
import { BrandLogo } from "@/components/layout/brand-logo";

export function SiteHeader() {
  return (
    {/* Mobil: scrollar bort (bottom-tabs är navet) → blockerar inte innehåll.
        Desktop: sticky som vanligt. */}
    <header className="z-40 border-b border-surface-border bg-surface/85 backdrop-blur-md lg:sticky lg:top-0">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6">
        <Link href="/" aria-label="Foilio — startsida">
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
