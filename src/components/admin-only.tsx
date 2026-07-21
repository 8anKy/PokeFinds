"use client";

import { useEffect, useState, type ReactNode } from "react";
import { getSession } from "next-auth/react";
import { hasAuthHint } from "@/lib/auth-hint";

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
 */
export function useIsAdmin(): boolean {
  const [isAdmin, setIsAdmin] = useState(false);
  useEffect(() => {
    if (!hasAuthHint()) return;
    void getSession().then((s) => {
      const role = s?.user?.role;
      setIsAdmin(role === "ADMIN" || role === "SUPERADMIN");
    });
  }, []);
  return isAdmin;
}

/** Renderar barnen bara för ADMIN/SUPERADMIN. Inget renderas före sessionen lästs. */
export function AdminOnly({ children }: { children: ReactNode }) {
  return useIsAdmin() ? <>{children}</> : null;
}
