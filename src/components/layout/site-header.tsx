import Link from "next/link";
import { auth } from "@/lib/auth";
import { LinkButton } from "@/components/ui/button";
import { HeaderNav } from "@/components/layout/header-nav";
import { BrandLogo } from "@/components/layout/brand-logo";
import { IconUser } from "@/components/ui/icons";

export async function SiteHeader() {
  const session = await auth();
  return (
    <header className="sticky top-0 z-40 border-b border-surface-border bg-surface/85 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6">
        <Link href="/" aria-label="Foilio — startsida">
          <BrandLogo />
        </Link>
        <HeaderNav />
        <div className="flex items-center gap-3">
          {session?.user ? (
            <>
              <LinkButton href="/dashboard" variant="primary" size="sm" className="hidden sm:inline-flex">
                Min översikt
              </LinkButton>
              <Link
                href="/installningar"
                aria-label="Profil"
                className="flex h-9 w-9 items-center justify-center rounded-full border border-surface-border text-ink-muted hover:border-holo-cyan/40 hover:text-holo-cyan"
              >
                <IconUser size={18} />
              </Link>
            </>
          ) : (
            <>
              <LinkButton href="/logga-in" variant="ghost" size="sm">
                Logga in
              </LinkButton>
              <LinkButton href="/registrera" variant="primary" size="sm">
                Gå med gratis
              </LinkButton>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
