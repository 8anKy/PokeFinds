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
        // Capacitor-appen). Vi rensar hinten och navigerar klient-sida i stället.
        await signOut({ redirect: false });
        setAuthHint(false);
        router.push("/produkter");
        router.refresh();
      }}
      className="flex w-full items-center justify-center gap-2 rounded-full border border-surface-border px-4 py-3 text-sm font-semibold text-fall transition-colors hover:bg-surface-overlay"
    >
      <IconLogout size={18} className="shrink-0" />
      Logga ut
    </button>
  );
}
