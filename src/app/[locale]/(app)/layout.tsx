import { redirect } from "next/navigation";
import { auth, hasRole } from "@/lib/auth";
import { AppShell } from "@/components/layout/app-shell";
import { AuthHintGate } from "@/components/layout/auth-hint-gate";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect("/logga-in");
  return (
    <AppShell userName={session.user.name} isAdmin={hasRole(session.user.role, "MODERATOR")}>
      {/* Klient-vakt: Router-cachen kan servera denna inloggade sidkropp ur
          klient-cachen efter utloggning utan att träffa serverns auth(). */}
      <AuthHintGate>{children}</AuthHintGate>
    </AppShell>
  );
}
