import { redirect } from "next/navigation";
import { auth, hasRole } from "@/lib/auth";
import { AdminNav } from "./admin-nav";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user || !hasRole(session.user.role, "MODERATOR")) {
    redirect("/dashboard");
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-ink">Adminpanel</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Hantera användare, datakällor, moderering och butiker.
        </p>
      </div>
      <AdminNav />
      {children}
    </div>
  );
}
