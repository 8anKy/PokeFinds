"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useRouter, usePathname } from "@/i18n/navigation";
import { hasAuthHint, onAuthHintChange } from "@/lib/auth-hint";

/**
 * Klient-vakt runt de skyddade (app)-sidorna. Servern (layoutens auth()) gör den
 * riktiga behörighetskollen, MEN Next.js Router-cache kan servera en redan hämtad
 * INLOGGAD sidkropp (Portfölj/Inställningar) ur klient-cachen efter utloggning utan
 * att träffa servern → sidan ser inloggad ut fast man loggat ut. Chrome:t (header/
 * tabbar) byter rätt via useAuthHint, men själva sidkroppen ligger kvar cachad.
 *
 * Vakten läser fo_auth-hinten SYNKRONT vid mount (inte i en effekt) så den stale
 * kroppen aldrig hinner målas, och skickar utloggade till login — precis som /skanna
 * redan gör. En inaktuell hint är ofarlig: serverns nästa hämtning omdirigerar ändå.
 */
export function AuthHintGate({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  // Lazy init: läs cookien synkront på klienten (undviker en blank/stale bildruta).
  // På servern (document undefined) → false = rendera children: servern har redan
  // auth()-gejtat, så här är användaren garanterat inloggad → ingen hydrerings-diff.
  const [loggedOut, setLoggedOut] = useState(
    () => typeof document !== "undefined" && !hasAuthHint()
  );

  useEffect(() => {
    const sync = () => setLoggedOut(!hasAuthHint());
    sync();
    return onAuthHintChange(sync);
  }, []);

  useEffect(() => {
    if (loggedOut) {
      router.replace(`/logga-in?callbackUrl=${encodeURIComponent(pathname)}`);
    }
  }, [loggedOut, router, pathname]);

  if (loggedOut) return null;
  return <>{children}</>;
}
