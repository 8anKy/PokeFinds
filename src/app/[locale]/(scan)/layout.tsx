import type { ReactNode } from "react";

/**
 * (scan) — skannern ligger UTANFÖR (app)-gruppen sedan gästskanningen
 * (2026-08-29): (app)-layouten redirectar utloggade till /logga-in på servern,
 * och en gäst i appen ska kunna öppna skannern utan konto. Vem som får skanna
 * avgörs i stället av sidans klientgrind (SkannaPage) och av API-routerna
 * (resolveScanActor) — servern litar aldrig på klienten.
 *
 * ⛔ Ren genomsläppning, precis som skanna/layout.tsx: skannern är
 * `fixed inset-0 z-[60]` och en extra DOM-nod är en visuell ändring.
 * Ingen AppShell: skalet syns ändå aldrig under helskärmsskannern.
 */
export default function ScanGroupLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
