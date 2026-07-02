import type { ReactNode } from "react";
import { AuthBrand } from "@/components/layout/auth-brand";
import { AuthShell } from "@/components/layout/auth-shell";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <AuthShell>
      <AuthBrand />
      <div className="card-surface w-full max-w-md p-6 shadow-card sm:p-8">{children}</div>
      <p className="mt-8 text-center text-xs text-ink-faint">
        © Foilio · Sveriges marknadsplats för Pokémon TCG
      </p>
    </AuthShell>
  );
}
