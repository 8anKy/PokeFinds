import Link from "next/link";
import { auth } from "@/lib/auth";
import { LinkButton } from "@/components/ui/button";
import { HeaderNav } from "@/components/layout/header-nav";

export async function SiteHeader() {
  const session = await auth();
  return (
    <header className="sticky top-0 z-40 border-b border-surface-border bg-surface/85 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2">
          <span className="text-xl font-bold tracking-tight">
            Poke<span className="holo-text">Finds</span>
          </span>
        </Link>
        <HeaderNav />
        <div className="flex items-center gap-3">
          {session?.user ? (
            <LinkButton href="/dashboard" variant="primary" size="sm">
              Min översikt
            </LinkButton>
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
