"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { signOut } from "next-auth/react";
import { Link, useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { setAuthHint } from "@/lib/auth-hint";
import {
  IconBell,
  IconChevronDown,
  IconDashboard,
  IconLogout,
  IconPackage,
  IconSettings,
  IconSparkle,
  IconUser,
} from "@/components/ui/icons";

/**
 * Profilen cachas i sessionStorage så avataren kan visa initialen på NÄSTA
 * sidladdning utan något API-anrop — headern ligger på varje sida, och ett
 * /api/users/me per sidvisning är exakt den sortens kostnad fo_auth-hinten
 * finns för att slippa. Färsk data hämtas först när menyn faktiskt ÖPPNAS.
 */
const PROFILE_CACHE_KEY = "fo_profile_v1";

interface CachedProfile {
  name: string | null;
  isPro: boolean;
}

function readCachedProfile(): CachedProfile | null {
  try {
    const raw = sessionStorage.getItem(PROFILE_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedProfile;
    return typeof parsed === "object" && parsed !== null ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Kontomenyn i desktop-headern: avatar + namn/PRO och genvägarna som förr låg
 * utspridda ("Min översikt"-knappen + profilikonen). Renderas BARA ≥sm-tall
 * (telefonen har bottentabbarna + /mer). All inloggningsläsning sker via
 * fo_auth-hinten hos föräldern — ingen server-auth() i chrome:n (ISR-regeln).
 */
export function AccountMenu() {
  const t = useTranslations("HeaderActions");
  const router = useRouter();
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [profile, setProfile] = useState<CachedProfile | null>(null);
  const [watchCount, setWatchCount] = useState<number | null>(null);
  const fetchedRef = useRef(false);

  // Initialen från förra hämtningen (samma flik) — annars generisk ikon.
  useEffect(() => {
    setProfile(readCachedProfile());
  }, []);

  useEffect(() => {
    if (!open || fetchedRef.current) return;
    fetchedRef.current = true;
    // Två små, egna frågor först vid ÖPPNING: profilen (namn/PRO) och
    // bevakningarnas antal (?ids=1 är id-listan, aldrig hela listan med bilder).
    void (async () => {
      try {
        const res = await fetch("/api/users/me");
        if (res.ok) {
          const data = (await res.json()) as { name?: string | null; isPro?: boolean };
          const next: CachedProfile = { name: data.name ?? null, isPro: !!data.isPro };
          setProfile(next);
          try {
            sessionStorage.setItem(PROFILE_CACHE_KEY, JSON.stringify(next));
          } catch {
            // sessionStorage kan vara avstängd — avataren visar ikonen i stället.
          }
        }
      } catch {
        // Nätverksfel: menyn fungerar ändå, bara utan namn.
      }
      try {
        const res = await fetch("/api/watchlist?ids=1");
        if (res.ok) {
          const data = (await res.json()) as { productIds?: string[] };
          setWatchCount(data.productIds?.length ?? 0);
        }
      } catch {
        // Utan svar visas ingen siffra — hellre inget än fel tal.
      }
    })();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const initial = profile?.name?.trim().charAt(0)?.toUpperCase() ?? null;

  const itemClass =
    "flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm text-ink transition-colors hover:bg-surface-border/50 focus-visible:bg-surface-border/50 focus-visible:outline-none";

  const links = [
    { href: "/dashboard", label: t("overview"), icon: <IconDashboard size={16} /> },
    { href: "/bevakningar", label: t("watches"), icon: <IconBell size={16} />, badge: watchCount },
    { href: "/gradera", label: t("grading"), icon: <IconSparkle size={16} /> },
    { href: "/samling", label: t("collection"), icon: <IconPackage size={16} /> },
    { href: "/installningar", label: t("settings"), icon: <IconSettings size={16} /> },
  ];

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t("accountMenu")}
        onClick={() => setOpen((v) => !v)}
        className="flex h-10 items-center gap-1 rounded-full border border-surface-border py-0.5 pl-0.5 pr-2 transition-colors hover:border-holo-cyan/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-holo-cyan"
      >
        <span className="grid h-8 w-8 place-items-center rounded-full border border-holo-cyan/50 bg-holo-cyan/10 text-sm font-semibold text-holo-cyan">
          {initial ?? <IconUser size={16} />}
        </span>
        <IconChevronDown
          size={14}
          className={cn("text-ink-muted transition-transform duration-200", open && "rotate-180")}
        />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 z-40 mt-2 w-60 animate-fade-in rounded-xl border border-surface-border bg-surface-overlay p-1.5 shadow-card"
        >
          <div className="flex items-center gap-2.5 px-3 pb-2.5 pt-2">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-holo-cyan/50 bg-holo-cyan/10 text-sm font-semibold text-holo-cyan">
              {initial ?? <IconUser size={16} />}
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold text-ink">
                {profile?.name ?? t("account")}
              </span>
              {profile?.isPro && (
                <span className="block text-[10px] font-bold tracking-[0.14em] text-holo-cyan">
                  {t("pro")}
                </span>
              )}
            </span>
          </div>

          <div className="hairline-t pt-1.5">
            {links.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                role="menuitem"
                onClick={() => setOpen(false)}
                className={itemClass}
              >
                <span aria-hidden className="text-ink-muted">{l.icon}</span>
                <span className="flex-1">{l.label}</span>
                {l.badge != null && l.badge > 0 && (
                  <span className="rounded-full bg-holo-cyan/15 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-holo-cyan">
                    {l.badge}
                  </span>
                )}
              </Link>
            ))}
          </div>

          <div className="hairline-t mt-1.5 pt-1.5">
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                try {
                  sessionStorage.removeItem(PROFILE_CACHE_KEY);
                } catch {
                  // Redan borta eller avstängd — utloggningen fortsätter ändå.
                }
                // Samma utloggningsväg som /mer: ingen redirect från next-auth
                // (full sidladdning i Capacitor-WebView:en hoppar till Safari) —
                // en enda klientnavigering efter att hinten släckts.
                void (async () => {
                  await signOut({ redirect: false });
                  setAuthHint(false);
                  router.replace("/produkter");
                })();
              }}
              className={cn(itemClass, "text-ink-muted hover:text-ink")}
            >
              <span aria-hidden><IconLogout size={16} /></span>
              {t("logout")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
