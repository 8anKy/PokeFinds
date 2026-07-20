"use client";

import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { useEffect, useState } from "react";
import { usePathname } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { isEmailLandingRoute } from "@/lib/auth-routes";
import {
  IconSearch,
  IconPackage,
  IconCamera,
  IconMessage,
  IconMenu,
  type IconProps,
} from "@/components/ui/icons";

const TABS: { href: string; key: string; icon: (p: IconProps) => JSX.Element }[] = [
  { href: "/produkter", key: "explore", icon: IconSearch },
  { href: "/samling", key: "portfolio", icon: IconPackage },
  { href: "/skanna", key: "scan", icon: IconCamera },
  { href: "/community", key: "community", icon: IconMessage },
  { href: "/mer", key: "more", icon: IconMenu },
];

export function BottomTabs() {
  const tNav = useTranslations("Nav");
  const pathname = usePathname();
  // Tab-baren visas alltid (in- som utloggad) — den är appens primära navigering.
  // Skyddade tabbar (Portfölj/Skanna) skickar utloggade till login via middleware.

  // iOS-tangentbordet flyttar position:fixed-element när det öppnas → göm tab-baren
  // medan tangentbordet är uppe. visualViewport krymper när tangentbordet visas
  // (mer pålitligt än focus-event i WebView:en).
  const [keyboard, setKeyboard] = useState(false);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const onResize = () => setKeyboard(window.innerHeight - vv.height > 120);
    vv.addEventListener("resize", onResize);
    onResize();
    return () => vv.removeEventListener("resize", onResize);
  }, []);

  if (keyboard) return null;
  // Återställ lösenord / verifiera e-post nås via e-postlänk i Safari (inte appen)
  // → visa ingen app-navigering, den lockar bara användaren att browsa webben.
  if (isEmailLandingRoute(pathname)) return null;
  // Auth/onboarding: VISA tab-baren (så man kan tabba vidare även från login) men
  // UTAN klarerings-spacern — den fixerade login-sidan (h-[100dvh]) scrollar annars.
  const noSpacer = ["/logga-in", "/registrera", "/glomt-losenord", "/aterstall-losenord", "/verifiera", "/onboarding"];
  const hideSpacer = noSpacer.some((p) => pathname === p || pathname?.startsWith(`${p}/`));
  return (
    <>
      {/* Klarering: fixed nav överlappar sidans botten — denna spacer ger
          scroll-utrymme så sista innehållet inte göms (ersätter layoutens pb-20). */}
      {!hideSpacer && <div aria-hidden className="h-16 lg:hidden" />}
      <nav
        aria-label="Huvudnavigering"
        className="hairline-t fixed inset-x-0 bottom-0 z-40 bg-surface/95 pb-[env(safe-area-inset-bottom)] shadow-[0_-8px_24px_-16px_rgba(0,0,0,0.7)] backdrop-blur-md lg:hidden"
      >
      <ul className="mx-auto flex max-w-md items-stretch">
        {TABS.map((t) => {
          const active = pathname === t.href || pathname?.startsWith(`${t.href}/`);
          return (
            <li key={t.href} className="flex-1">
              <Link
                href={t.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "group flex flex-col items-center gap-0.5 py-1.5 text-[11px] font-medium transition-colors duration-150",
                  active ? "text-holo-cyan" : "text-ink-muted hover:text-ink"
                )}
              >
                {/* Pill bakom ikonen: tonas in på aktiv tab, ger tryckyta-känsla
                    vid tap (group-active). Ikonen gör en liten "pop" vid aktivering. */}
                <span
                  className={cn(
                    "flex h-7 w-12 items-center justify-center rounded-full transition-colors duration-300 ease-out-soft",
                    active ? "bg-holo-cyan/10" : "bg-transparent group-active:bg-ink/5"
                  )}
                >
                  <t.icon
                    size={22}
                    className={cn(
                      "shrink-0 transition-transform duration-150 group-active:scale-90",
                      active && "animate-tab-pop"
                    )}
                  />
                </span>
                {tNav(t.key)}
              </Link>
            </li>
          );
        })}
      </ul>
      </nav>
    </>
  );
}
