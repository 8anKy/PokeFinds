"use client";

import { useEffect, useState, type ReactNode } from "react";
import { getSharedSession } from "@/lib/client-session";
import { hasAuthHint, onAuthHintChange } from "@/lib/auth-hint";

/**
 * Rollen läses KLIENT-sida, on-demand, och bara när fo_auth-cookien finns.
 *
 * Varför inte server-`auth()`: chrome:n (header/footer) delas av de ISR-cachade
 * publika sidorna — ett enda `auth()` där gör HELA appen dynamisk igen (se
 * "Caching/ISR" i CLAUDE.md). Cookie-grinden gör dessutom att utloggade besökare
 * aldrig anropar /api/auth/session. Samma mönster som produktsidans admin-knapp.
 *
 * Detta är UI-gömma, INTE behörighet: servern (middleware + API + sidan) avgör
 * alltid den riktiga åtkomsten. Att dölja en länk skyddar ingenting.
 *
 * Senast kända svar hålls i modulminnet så en REMONTERING (headern byts ut vid
 * varje flikbyte) startar med rätt värde i stället för att admin-länkarna dyker
 * upp en runda senare. Servern skriver aldrig här (bara klienteffekten), och
 * första hydreringen ser alltid `false` = samma som SSR. Nollas vid login/logout.
 */
let lastKnownAdmin = false;
let subscribed = false;

function subscribeOnce(): void {
  if (subscribed || typeof window === "undefined") return;
  subscribed = true;
  onAuthHintChange(() => {
    lastKnownAdmin = false;
  });
}

export function useIsAdmin(): boolean {
  const [isAdmin, setIsAdmin] = useState(() => typeof window !== "undefined" && lastKnownAdmin);
  useEffect(() => {
    subscribeOnce();
    if (!hasAuthHint()) return;
    void getSharedSession().then((s) => {
      const role = s?.user?.role;
      const ok = role === "ADMIN" || role === "SUPERADMIN";
      lastKnownAdmin = ok;
      setIsAdmin(ok);
    });
  }, []);
  return isAdmin;
}

/** Renderar barnen bara för ADMIN/SUPERADMIN. Inget renderas före sessionen lästs. */
export function AdminOnly({ children }: { children: ReactNode }) {
  return useIsAdmin() ? <>{children}</> : null;
}
