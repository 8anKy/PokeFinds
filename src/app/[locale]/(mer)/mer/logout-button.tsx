"use client";

import { useTranslations } from "next-intl";
import { signOut } from "next-auth/react";
import { useRouter } from "@/i18n/navigation";
import { setAuthHint } from "@/lib/auth-hint";

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
      // Fristående, dämpad knapp längst ned (2026-09-09): sidan är nu sektionerad
      // och en röd rad inne i ett kort läste som en meny­post man kunde råka
      // trycka på. Ingen ikon — knappen står ensam och behöver ingen.
      className="flex h-12 w-full items-center justify-center rounded-[14px] border border-surface-border text-sm font-medium text-ink-muted transition-colors hover:bg-surface-overlay/60 hover:text-ink active:bg-surface-overlay"
    >
      {t("logout")}
    </button>
  );
}
