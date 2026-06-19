import { SiteHeader } from "@/components/layout/site-header";
import { SiteFooter } from "@/components/layout/site-footer";
import { auth } from "@/lib/auth";

export default async function MarketingLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  return (
    <div className="flex min-h-screen flex-col bg-surface-gradient">
      <SiteHeader />
      {/* Bottom tab bar (logged-in, mobile) overlaps the footer — pad it clear */}
      <main className={session?.user ? "flex-1 pb-20 lg:pb-0" : "flex-1"}>{children}</main>
      <SiteFooter />
    </div>
  );
}
