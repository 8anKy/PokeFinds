"use client";

import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { usePathname } from "@/i18n/navigation";
import { signOut } from "next-auth/react";
import { setAuthHint } from "@/lib/auth-hint";
import { cn } from "@/lib/utils";
import { useCommunityV2 } from "@/lib/use-community-v2";
import {
  IconSearch,
  IconBell,
  IconPackage,
  IconShield,
  IconMessage,
  IconMail,
  IconSettings,
  IconWrench,
  IconUser,
  type IconProps,
} from "@/components/ui/icons";
import { BrandLogo } from "@/components/layout/brand-logo";
import { SiteHeader } from "@/components/layout/site-header";

/**
 * ⛔ SIDOMENYNS ETIKETTER MÅSTE ÖVERSÄTTAS SOM ALLT ANNAT. De stod hårdkodade
 * på svenska medan resten av skalet följde locale:n, så en engelsk besökare fick
 * en svensk sidomeny bredvid en engelsk sida (rapporterat 2026-08-11). Nycklarna
 * återanvänds med flit från Nav/HeaderActions/More — samma etikett ska heta
 * samma sak i toppnavigeringen, kontomenyn, mobilens /mer och här.
 *
 * Översikt (/dashboard), Skanna kort (/skanna) och Marknad (/marknad) är
 * BORTTAGNA ur menyn (ägarbeslut 2026-08-11). Sidorna finns kvar och nås via
 * URL respektive mobilens bottentabbar — det här är bara navigationen.
 */
const NAV: {
  href: string;
  ns: "Nav" | "HeaderActions";
  key: string;
  icon: (p: IconProps) => JSX.Element;
}[] = [
  { href: "/produkter", ns: "Nav", key: "explore", icon: IconSearch },
  { href: "/bevakningar", ns: "HeaderActions", key: "watches", icon: IconBell },
  { href: "/samling", ns: "HeaderActions", key: "collection", icon: IconPackage },
  { href: "/gradera", ns: "HeaderActions", key: "grading", icon: IconShield },
  { href: "/community", ns: "Nav", key: "community", icon: IconMessage },
  { href: "/installningar", ns: "HeaderActions", key: "settings", icon: IconSettings },
];

/**
 * DESKTOP: dessa inloggade sidor behåller TOPP-NAVIGERINGEN i stället för
 * sidomenyn (ägarbeslut 2026-08-11). Portfölj är en av huvudflikarna i headern —
 * att klicka på den fick hela huvudnavigeringen att försvinna och ersättas av ett
 * annat skal, dvs man tappade vägen tillbaka till Utforska/Community/Priser.
 * ⚠️ MOBILEN ÄR OFÖRÄNDRAD i båda lägena: där renderar skalet redan SiteHeader
 * och navet är bottentabbarna. Skillnaden syns bara ≥lg.
 */
const HEADER_LAYOUT_PREFIXES = ["/samling"];

export function AppShell({
  children,
  userName,
  isAdmin,
}: {
  children: React.ReactNode;
  userName: string;
  isAdmin?: boolean;
}) {
  const pathname = usePathname();
  const tNav = useTranslations("Nav");
  const tAccount = useTranslations("HeaderActions");
  const tMore = useTranslations("More");
  // Forum + Meddelanden (community v2) visas bara för den grinden släpper in —
  // se lib/community-v2-gate.ts. Övriga ser Community ("snart här") som förut.
  const communityV2 = useCommunityV2();
  const navItems = communityV2
    ? NAV.flatMap((item) =>
        item.key === "community"
          ? [
              { ...item, href: "/forum", key: "forum" },
              { href: "/meddelanden", ns: "Nav" as const, key: "messages", icon: IconMail },
            ]
          : [item]
      )
    : NAV;

  const label = (ns: "Nav" | "HeaderActions", key: string) =>
    ns === "Nav" ? tNav(key) : tAccount(key);

  // ⛔ HÖJDEN MÅSTE DRA AV ALLT SOM LIGGER UTANFÖR SKALET. Tre poster, och
  // MISSAS EN ENDA går sidan att scrolla precis så mycket fast allt syns:
  //   1. `BottomTabs` klarerings-spacer (h-16) — SYSKON i rot-layouten.
  //   2. `body { padding-top: env(safe-area-inset-top) }` (globals.css) —
  //      statusfältets höjd, ~44-59 px på en telefon med urklipp.
  //   3. 100dvh, inte 100vh: på mobilwebb är 100vh den STORA viewporten
  //      (adressfältet bortdolt) och alltså högre än den synliga ytan.
  // ⚠️ Post 2 är NOLL på desktop, så felet syns aldrig i en webbläsare på
  // datorn — det måste verifieras på en riktig telefon. Desktop har varken
  // tab-bar eller urklipp och kör därför ren min-h-screen.
  const shellHeight = "min-h-[calc(100dvh_-_4rem_-_env(safe-area-inset-top))] lg:min-h-screen";

  const headerLayout = HEADER_LAYOUT_PREFIXES.some(
    (p) => pathname === p || pathname?.startsWith(`${p}/`)
  );

  if (headerLayout) {
    return (
      <div className={cn("flex flex-col", shellHeight)}>
        <SiteHeader />
        {/* max-w-7xl = samma spalt som headern och de publika sidorna
            (/produkter, /marknad, /sets) — annars ligger innehållet inte i linje
            med logotypen och flikarna ovanför. Mobilens padding är oförändrad. */}
        <main className="mx-auto w-full max-w-7xl flex-1 px-2.5 py-6 sm:px-6 lg:py-10">
          {children}
        </main>
      </div>
    );
  }

  const nav = (
    <nav className="flex flex-col gap-1 p-3">
      {navItems.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          className={cn(
            "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-all duration-150",
            pathname?.startsWith(item.href)
              ? "bg-holo-cyan/10 text-holo-cyan"
              : "text-ink-muted hover:bg-surface-overlay/60 hover:text-ink hover:translate-x-0.5"
          )}
        >
          <item.icon size={18} className="shrink-0" />
          {label(item.ns, item.key)}
        </Link>
      ))}
      {isAdmin && (
        <Link
          href="/admin"
          className={cn(
            "mt-2 flex items-center gap-3 rounded-lg border border-holo-violet/30 px-3 py-2 text-sm",
            pathname?.startsWith("/admin")
              ? "bg-surface-overlay text-holo-violet"
              : "text-holo-violet/80 hover:bg-surface-overlay/50"
          )}
        >
          <IconWrench size={18} className="shrink-0" />
          {tMore("admin")}
        </Link>
      )}
    </nav>
  );

  return (
    <div className={cn("flex", shellHeight)}>
      {/* Desktop sidebar */}
      <aside className="hidden w-60 shrink-0 border-r border-surface-border bg-surface-raised/40 lg:block">
        <div className="flex h-16 items-center border-b border-surface-border px-5">
          <BrandLogo markSize={26} textClass="text-lg" />
        </div>
        {nav}
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobil: SAMMA header som (marketing)-tabbarna (Utforska/Community) så
            headern inte byter utseende/position när man tabbar mellan grupperna. */}
        <div className="lg:hidden">
          <SiteHeader />
        </div>
        {/* Desktop-topbar (sidomeny finns → egen topbar med hälsning/logga ut) */}
        <header className="z-40 hidden h-16 items-center justify-between border-b border-surface-border bg-surface/85 px-4 backdrop-blur-md lg:sticky lg:top-0 lg:flex">
          <div className="flex items-center gap-3" />
          <div className="flex items-center gap-3">
            <span className="hidden text-sm text-ink-muted sm:inline">
              {tAccount("greeting", { name: userName })}
            </span>
            <button
              onClick={() => {
                setAuthHint(false);
                void signOut({ callbackUrl: "/" });
              }}
              className="hidden rounded-lg px-3 py-1.5 text-sm text-ink-muted hover:bg-surface-overlay hover:text-ink sm:inline-block"
            >
              {tAccount("logout")}
            </button>
            <Link
              href="/installningar"
              aria-label={tAccount("profile")}
              className="flex h-9 w-9 items-center justify-center rounded-full border border-surface-border text-ink-muted hover:border-holo-cyan/40 hover:text-holo-cyan"
            >
              <IconUser size={18} />
            </Link>
          </div>
        </header>

        <main className="flex-1 px-2.5 py-6 sm:px-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}
