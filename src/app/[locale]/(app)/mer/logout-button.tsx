"use client";

import { useTranslations } from "next-intl";
import { signOut } from "next-auth/react";
import { useRouter } from "@/i18n/navigation";
import { setAuthHint } from "@/lib/auth-hint";
import { IconLogout } from "@/components/ui/icons";

export function LogoutButton() {
  const t = useTranslations("More");
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
      // Menyrad-stil (inte fristående knapp): som sista rad i kortet ryms hela
      // Mer-sidan utan scroll även med invite-kortet + adminraden på en mobil.
      className="flex w-full items-center gap-3 border-t border-surface-border px-4 py-3 text-sm font-medium text-fall transition-colors hover:bg-surface-overlay/60"
    >
      <IconLogout size={20} className="shrink-0" />
      {t("logout")}
    </button>
  );
}
