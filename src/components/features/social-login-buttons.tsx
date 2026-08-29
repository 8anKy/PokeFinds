"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/input";
import { IconAppleLogo, IconGoogle } from "@/components/ui/brand-icons";
import { socialLogin, socialProviderEnabled } from "@/lib/social-login";
import type { OAuthProvider } from "@/lib/oauth-id-token";

/**
 * "Fortsätt med Google / Apple" på inloggning och registrering. Renderar
 * ingenting alls när ingen provider är konfigurerad (webb utan nycklar) — då
 * finns inte ens skiljelinjen, så formuläret ser ut som förut.
 *
 * ⛔ Apple visas ALLTID när Google visas i appen — App Store-riktlinje 4.8:
 * erbjuds tredjepartsinloggning i appen måste Sign in with Apple finnas där.
 * Ordningen (Apple först på iOS) är också Apples önskemål.
 */
export function SocialLoginButtons({ next }: { next: string }) {
  const t = useTranslations("Auth.social");
  const [busy, setBusy] = useState<OAuthProvider | null>(null);
  const [error, setError] = useState<string | null>(null);

  const providers = (["apple", "google"] as const).filter((p) => socialProviderEnabled[p]);
  if (providers.length === 0) return null;

  async function start(provider: OAuthProvider) {
    setError(null);
    setBusy(provider);
    try {
      const outcome = await socialLogin(provider, next);
      if (outcome === "redirecting") return; // sidan byts — behåll laddningen
      if (outcome === "failed") setError(t("error"));
    } catch {
      setError(t("error"));
    }
    setBusy(null);
  }

  return (
    <div className="mt-6">
      <div className="flex items-center gap-3 text-xs uppercase tracking-wide text-ink-faint">
        <span className="h-px flex-1 bg-surface-border" />
        {t("or")}
        <span className="h-px flex-1 bg-surface-border" />
      </div>
      <div className="mt-4 space-y-2.5">
        {providers.map((provider) => (
          <Button
            key={provider}
            type="button"
            variant="secondary"
            size="lg"
            className="w-full"
            loading={busy === provider}
            disabled={busy !== null}
            onClick={() => void start(provider)}
          >
            {busy !== provider &&
              (provider === "google" ? <IconGoogle size={18} /> : <IconAppleLogo size={18} />)}
            {t(provider)}
          </Button>
        ))}
      </div>
      <FieldError message={error} />
    </div>
  );
}
