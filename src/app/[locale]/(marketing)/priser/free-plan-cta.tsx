"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { LinkButton } from "@/components/ui/button";
import { hasAuthHint } from "@/lib/auth-hint";

/**
 * Free-kortets CTA. Sidan ISR-cachas (ingen server-auth) → plan läses klient-sida.
 * Inloggad på gratis = "din nuvarande plan"; inloggad Pro = ingen CTA (irrelevant);
 * utloggad = "skapa gratiskonto". Undviker att be en inloggad användare registrera sig.
 */
export function FreePlanCta() {
  const t = useTranslations("Pricing");
  const tu = useTranslations("Upgrade");
  const [loggedIn, setLoggedIn] = useState(false);
  const [isPro, setIsPro] = useState(false);

  useEffect(() => {
    const logged = hasAuthHint();
    setLoggedIn(logged);
    if (logged) {
      fetch("/api/users/me")
        .then((r) => r.json())
        .then((me) => setIsPro(me?.planTier === "PREMIUM"))
        .catch(() => undefined);
    }
  }, []);

  if (loggedIn) {
    if (isPro) return null; // Pro-användare: gratis-CTA irrelevant.
    return (
      <div className="mt-8 w-full rounded-xl border border-surface-border bg-surface px-4 py-3 text-center">
        <p className="text-sm font-semibold text-ink">{tu("currentPlan")}</p>
      </div>
    );
  }

  return (
    <LinkButton href="/registrera" variant="secondary" className="mt-8 w-full">
      {t("freeCta")}
    </LinkButton>
  );
}
