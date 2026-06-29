"use client";

import { signOut } from "next-auth/react";
import { useRouter } from "next/navigation";
import { setAuthHint } from "@/lib/auth-hint";
import { IconLogout } from "@/components/ui/icons";

export function LogoutButton() {
  const router = useRouter();
  return (
    <button
      onClick={async () => {
        // redirect:false → ingen hård navigering (den skickar ut till Safari i
        // Capacitor-appen). EN enda navigering (replace, ingen refresh): refresh()
        // re-hämtade den nu utloggade /mer-sidan → server-redirect till /logga-in
        // SAMTIDIGT som push:en ville till /produkter = kapplöpning/flimmer i WebView:en.
        await signOut({ redirect: false });
        setAuthHint(false);
        router.replace("/produkter");
      }}
      className="flex w-full items-center justify-center gap-2 rounded-full border border-surface-border px-4 py-3 text-sm font-semibold text-fall transition-colors hover:bg-surface-overlay"
    >
      <IconLogout size={18} className="shrink-0" />
      Logga ut
    </button>
  );
}
