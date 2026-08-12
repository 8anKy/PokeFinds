import { redirect } from "next/navigation";
import { auth, hasRole } from "@/lib/auth";
import { AppShell } from "@/components/layout/app-shell";
import { AuthHintGate } from "@/components/layout/auth-hint-gate";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect("/logga-in");
  return (
    <AppShell userName={session.user.name} isAdmin={hasRole(session.user.role, "MODERATOR")}>
      {/* VerifyEmailBanner togs bort 2026-08-12 (ägarbeslut): nya konton föds
          verifierade (kod-steget i registreringen), så bannern kunde bara visas
          för de två legacy-kontona. Deras väg till verifiering är /verifiera:s
          resend-formulär — /api/auth/resend-verification lever kvar. */}
      {/* Klient-vakt: Router-cachen kan servera denna inloggade sidkropp ur
          klient-cachen efter utloggning utan att träffa serverns auth(). */}
      <AuthHintGate>{children}</AuthHintGate>
    </AppShell>
  );
}
