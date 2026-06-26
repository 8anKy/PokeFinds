import { redirect } from "next/navigation";
import { auth, hasRole } from "@/lib/auth";
import { AppShell } from "@/components/layout/app-shell";
import { PushManager } from "@/components/push-manager";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect("/logga-in");
  return (
    <AppShell userName={session.user.name} isAdmin={hasRole(session.user.role, "MODERATOR")}>
      <PushManager />
      {children}
    </AppShell>
  );
}
