import type { ReactNode } from "react";
import type { Role } from "@prisma/client";
import { setRequestLocale } from "next-intl/server";
import { hasRole } from "@/lib/auth";
import { readSessionLite } from "@/lib/session-lite";
import { AppShell } from "@/components/layout/app-shell";
import { AuthHintGate } from "@/components/layout/auth-hint-gate";
import { SiteHeader } from "@/components/layout/site-header";
import { SiteFooter } from "@/components/layout/site-footer";

/**
 * /mer bor i en EGEN routegrupp sedan 2026-09-05: `(app)`-layouten skickar varje
 * gäst till inloggningen, men "Mer" i appens tabbar ska ge språk, om oss, villkor
 * och Discord även utan konto (Android-QA 09-01 fynd 6). Inloggad ⇒ exakt samma
 * skal som (app); gäst ⇒ webbens chrome. Undersidorna (/mer/utmarkelser,
 * /mer/bjud-in) kräver fortfarande konto — de skickar själva till inloggningen.
 *
 * ⛔ Sessionen läses ur COOKIEN (`readSessionLite`), inte med `auth()`: vid appstart är
 * token > 30 min gammal och `auth()` hade väntat på att Neon vaknade innan skalet
 * ritades (Mer-fliken p99 2–3 s, 2026-09-28). Skalet behöver bara namn och roll.
 */
export default async function MerLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: { locale: string };
}) {
  setRequestLocale(params.locale);
  const session = await readSessionLite();
  if (session) {
    return (
      <AppShell userName={session.name ?? ""} isAdmin={hasRole(session.role as Role, "MODERATOR")}>
        <AuthHintGate>{children}</AuthHintGate>
      </AppShell>
    );
  }
  return (
    <div className="flex min-h-[calc(100dvh_-_var(--bottom-tabs-space)_-_env(safe-area-inset-top))] flex-col bg-surface lg:min-h-screen">
      <SiteHeader />
      <main className="flex-1 px-2.5 py-6 sm:px-6">{children}</main>
      <SiteFooter />
    </div>
  );
}
