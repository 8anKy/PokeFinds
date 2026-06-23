import Link from "next/link";
import { HeaderNav } from "@/components/layout/header-nav";
import { HeaderAuthActions } from "@/components/layout/header-auth-actions";
import { BrandLogo } from "@/components/layout/brand-logo";

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-surface-border bg-surface/85 pt-[env(safe-area-inset-top)] backdrop-blur-md">
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
