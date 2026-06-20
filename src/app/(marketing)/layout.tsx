import { SiteHeader } from "@/components/layout/site-header";
import { SiteFooter } from "@/components/layout/site-footer";

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  // Ingen server-`auth()` här — det tvingade hela katalogen dynamisk. Den mobila
  // tab-baren (BottomTabs) renderar sin egen klarerings-spacer när man är inloggad.
  return (
    <div className="flex min-h-screen flex-col bg-surface-gradient">
      <SiteHeader />
      <main className="flex-1">{children}</main>
      <SiteFooter />
    </div>
  );
}
