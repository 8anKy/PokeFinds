"use client";

import Link from "next/link";
import { useSession } from "next-auth/react";
import { LinkButton } from "@/components/ui/button";
import { IconUser } from "@/components/ui/icons";

/**
 * Header-knapparna som beror på inloggning. Läses klient-sida (useSession) så att
 * SiteHeader/marketing-layouten slipper server-`auth()` — det tvingade annars hela
 * den publika katalogen att renderas dynamiskt per request (brände Vercel Active
 * CPU + Neon-läsningar). Under laddning visas inget → ingen layout-flicker av vikt.
 */
export function HeaderAuthActions() {
  const { data: session, status } = useSession();

  if (status === "loading") {
    // Reservera ungefär samma bredd så headern inte hoppar vid hydrering.
    return <div className="h-9 w-32" aria-hidden />;
  }

  if (session?.user) {
    return (
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
    );
  }

  return (
    <>
      <LinkButton href="/logga-in" variant="ghost" size="sm">
        Logga in
      </LinkButton>
      <LinkButton href="/registrera" variant="primary" size="sm">
        Gå med gratis
      </LinkButton>
    </>
  );
}
