import { setRequestLocale } from "next-intl/server";
import { SiteHeader } from "@/components/layout/site-header";
import { SiteFooter } from "@/components/layout/site-footer";

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
    <div className="flex min-h-screen flex-col bg-surface-gradient">
      <SiteHeader />
      <main className="flex-1">{children}</main>
      <SiteFooter />
    </div>
  );
}
