"use client";

import { SessionProvider } from "next-auth/react";
import { ToastProvider } from "@/components/ui/toast";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    // session={null} → SessionProvider auto-hämtar ALDRIG /api/auth/session (det
    // skedde per sidvisning, även för utloggade, och brände Vercel Active CPU).
    // Inloggnings-status läses i stället via fo_auth-cookie (auth-hint.ts); kod som
    // behöver riktig session hämtar den on-demand (getSession/update).
    <SessionProvider session={null} refetchOnWindowFocus={false}>
      <ToastProvider>{children}</ToastProvider>
    </SessionProvider>
  );
}
