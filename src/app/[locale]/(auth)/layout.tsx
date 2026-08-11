import type { ReactNode } from "react";
import type { Metadata } from "next";
import { AuthBrand } from "@/components/layout/auth-brand";
import { AuthShell } from "@/components/layout/auth-shell";

// ponytail: auth-sidorna cachades statiskt (s-maxage=1år + Vary: RSC). WebView:ens
// HTTP-cache respekterar inte Vary: RSC → serverade RSC-varianten (text/x-component)
// som ett dokument = råtext-skärmen i appen. force-dynamic → no-store, ingen cache.
// Gäller alla (auth)-sidor (login/registrera/…) via layout-segmentet. Billigt: låg trafik.
export const dynamic = "force-dynamic";

/**
 * ⛔ INLOGGNINGSSIDAN FÅR INTE INDEXERAS (2026-08-11). Sidorna i (auth) är
 * `"use client"` och kan därför inte exportera egen `metadata` — de ärvde
 * rot-layoutens `Meta.title`/`Meta.description` ORDAGRANT och blev därmed
 * omöjliga att skilja från startsidan. Följden mättes i produktion: en
 * inkognitosökning på "www.foilio.se" gav `/logga-in` som ÖVERSTA träff, med
 * sajtens flaggskeppsrubrik. Roten var att `/` var en 307 (se
 * (marketing)/page.tsx) så det inte fanns någon startsida att ranka i stället —
 * men en inloggningsruta ska inte vara ett sökresultat oavsett.
 *
 * Grinden sitter på LAYOUTEN, inte per sida: den täcker logga-in, registrera,
 * glomt-losenord, aterstall-losenord, verifiera och onboarding på en gång, och
 * en ny (auth)-sida ärver den automatiskt i stället för att någon ska minnas
 * att lägga till den.
 *
 * `follow: true` med flit — vi vill inte indexera sidorna, men länkarna härifrån
 * pekar in i katalogen och ska fortsatt följas.
 */
export const metadata: Metadata = {
  robots: { index: false, follow: true },
};

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
