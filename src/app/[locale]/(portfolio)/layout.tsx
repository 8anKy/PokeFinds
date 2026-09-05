import type { ReactNode } from "react";
import { setRequestLocale } from "next-intl/server";
import { auth, hasRole } from "@/lib/auth";
import { AppShell } from "@/components/layout/app-shell";
import { AuthHintGate } from "@/components/layout/auth-hint-gate";
import { SiteHeader } from "@/components/layout/site-header";
import { SiteFooter } from "@/components/layout/site-footer";

/**
 * /samling bor i en EGEN routegrupp sedan 2026-09-05, av samma skäl som /mer:
 * `(app)`-layouten skickar varje gäst till inloggningen, men "Portfölj" i appens
 * tabbar ska visa vad portföljen GÖR (värde, graf, set, sålt) och två knappar —
 * inte en naken inloggningsvägg (Android-QA 09-01 fynd 6, ägaren 09-05).
 * Inloggad ⇒ exakt samma skal som (app); gäst ⇒ webbens chrome.
 */
export default async function PortfolioLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: { locale: string };
}) {
  setRequestLocale(params.locale);
  const session = await auth();
  if (session?.user) {
    return (
      <AppShell userName={session.user.name} isAdmin={hasRole(session.user.role, "MODERATOR")}>
        <AuthHintGate>{children}</AuthHintGate>
      </AppShell>
    );
  }
  return (
    <div className="flex min-h-[calc(100dvh_-_4rem_-_env(safe-area-inset-top))] flex-col bg-surface lg:min-h-screen">
      <SiteHeader />
      <main className="flex-1 px-2.5 py-6 sm:px-6">{children}</main>
      <SiteFooter />
    </div>
  );
}
