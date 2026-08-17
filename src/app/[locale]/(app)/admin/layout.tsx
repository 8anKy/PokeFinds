import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth, hasRole } from "@/lib/auth";
import { AdminNav } from "./admin-nav";

/**
 * Adminens sidor hade INGEN egen titel (2026-08-17) och ärvde därför rot-layoutens
 * `Meta.title` ORDAGRANT — varje adminvy påstod alltså att den var startsidan i
 * allt som läser `<title>`: webbläsarflik, historik, bokmärken, delade länkar och
 * appens fönsternamn. Samma rotorsak som (auth)-grinden, fast utan SEO-effekten
 * (sidorna är bakom `auth()` och kan aldrig crawlas).
 *
 * Grinden sitter på LAYOUTEN, inte per sida: ett ställe täcker alla adminvyer och
 * en ny vy ärver titeln automatiskt i stället för att någon ska minnas den. En sida
 * som vill vara mer specifik skriver över den själv — `anvandare/[id]` gör redan
 * det ("Användare · Admin"). Rot-layoutens `template: "%s | Foilio"` gör detta till
 * "Admin | Foilio".
 */
export const metadata: Metadata = { title: "Admin" };

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
