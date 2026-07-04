import type { ReactNode } from "react";
import { AuthBrand } from "@/components/layout/auth-brand";
import { AuthShell } from "@/components/layout/auth-shell";

// ponytail: auth-sidorna cachades statiskt (s-maxage=1år + Vary: RSC). WebView:ens
// HTTP-cache respekterar inte Vary: RSC → serverade RSC-varianten (text/x-component)
// som ett dokument = råtext-skärmen i appen. force-dynamic → no-store, ingen cache.
// Gäller alla (auth)-sidor (login/registrera/…) via layout-segmentet. Billigt: låg trafik.
export const dynamic = "force-dynamic";

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
