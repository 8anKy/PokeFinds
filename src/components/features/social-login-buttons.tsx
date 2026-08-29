"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/input";
import { IconAppleLogo, IconGoogle } from "@/components/ui/brand-icons";
import { socialLogin, socialProviderEnabled } from "@/lib/social-login";
import type { OAuthProvider } from "@/lib/oauth-id-token";

/**
 * "– eller logga in med –" + IKONKNAPPAR under e-postformuläret (ägarens
 * referens 2026-08-29). Ikon utan text: två rader "Fortsätt med …" kostade
 * ~110 px och tvingade registreringen att scrolla på mobil. Hela frasen finns
 * kvar som aria-label/title. Renderar ingenting när ingen provider är
 * konfigurerad — då finns inte linjen heller.
 *
 * ⛔ Apple visas ALLTID när Google visas i appen — App Store-riktlinje 4.8.
 */
export function SocialLoginButtons({ next, mode }: { next: string; mode: "login" | "register" }) {
  const t = useTranslations("Auth.social");
  const router = useRouter();
  const [busy, setBusy] = useState<OAuthProvider | null>(null);
  const [error, setError] = useState<string | null>(null);

  const providers = (["apple", "google"] as const).filter((p) => socialProviderEnabled[p]);
  if (providers.length === 0) return null;

  async function start(provider: OAuthProvider) {
    setError(null);
    setBusy(provider);
    try {
      const outcome = await socialLogin(provider, next);
      if (outcome.kind === "redirecting") return; // sidan byts — behåll laddningen
      if (outcome.kind === "signed-in") {
        router.push(outcome.target);
        router.refresh();
        return;
      }
      if (outcome.kind === "failed") setError(t("error"));
    } catch {
      setError(t("error"));
    }
    setBusy(null);
  }

  return (
    <div className="mt-5">
      <p className="text-center text-xs text-ink-muted">
        {mode === "login" ? t("orLogin") : t("orRegister")}
      </p>
      <div className="mt-3 grid grid-cols-2 gap-3">
        {providers.map((provider) => (
          <Button
            key={provider}
            type="button"
            variant="secondary"
            size="lg"
            className="w-full"
            aria-label={t(provider)}
            title={t(provider)}
            loading={busy === provider}
            disabled={busy !== null}
            onClick={() => void start(provider)}
          >
            {busy !== provider &&
              (provider === "google" ? <IconGoogle size={22} /> : <IconAppleLogo size={22} />)}
          </Button>
        ))}
      </div>
      <FieldError message={error} />
    </div>
  );
}
