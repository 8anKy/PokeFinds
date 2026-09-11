import { setRequestLocale } from "next-intl/server";
import { SiteHeader } from "@/components/layout/site-header";
import { SiteFooter } from "@/components/layout/site-footer";
import { SignupCampaignBanner } from "@/components/features/signup-campaign-banner";
import { RouteSwipeSnapshotCapture } from "@/components/layout/route-swipe-snapshot";

export default function MarketingLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: { locale: string };
}) {
  // setRequestLocale → footerns getTranslations funkar under statisk rendering (ISR).
  setRequestLocale(params.locale);
  // Ingen server-`auth()` här — det tvingade hela katalogen dynamisk. Den mobila
  // tab-baren (BottomTabs) renderar sin egen klarerings-spacer när man är inloggad.
  return (
    // Se app-shell.tsx: tab-barens spacer är ett SYSKON i rot-layouten, så
    // min-h-screen gör dokumentet 64px högre än viewporten och varje sida
    // scrollbar fast allt syns. 100dvh av samma skäl som där.
    <div
      data-marketing-shell
      data-route-swipe-shell
      data-product-overlay-background
      className="flex min-h-[calc(100dvh_-_var(--bottom-tabs-space)_-_env(safe-area-inset-top))] flex-col bg-surface lg:min-h-screen"
    >
      {/* Behåller den redan målade föregående sidan som kostnadsfri visuell
          bakgrund på SwipeBack-rutter. Se komponenten för Neon-vakten. */}
      <RouteSwipeSnapshotCapture />
      {/* Kampanjremsan är en KLIENTkomponent och gör inte layouten dynamisk —
          den läser ett inbakat datum + fo_auth-hinten, aldrig auth() eller cookies()
          på servern. Se Caching/ISR i CLAUDE.md. */}
      <SignupCampaignBanner />
      <SiteHeader />
      <main className="flex-1">{children}</main>
      <SiteFooter />
    </div>
  );
}
