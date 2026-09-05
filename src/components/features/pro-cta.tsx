"use client";

import type { ReactNode } from "react";
import { useRouter } from "@/i18n/navigation";
import { Button, type ButtonSize, type ButtonVariant } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { openPaywallOrNavigate } from "@/lib/paywall";

/**
 * "Uppgradera"-knapp som öppnar paywall-arket på plats (fallback: `/priser`).
 * Ersätter `<LinkButton href="/priser">` överallt där knappen är en PROMPT —
 * navigationsposter (Mer-tabben, sidfoten, headern) länkar fortfarande till sidan.
 */
export function ProCta({
  children,
  variant = "primary",
  size = "md",
  className,
  source,
}: {
  children: ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
  source?: string;
}) {
  const router = useRouter();
  return (
    <Button
      variant={variant}
      size={size}
      className={className}
      onClick={() => openPaywallOrNavigate(router, { source })}
    >
      {children}
    </Button>
  );
}

/** Textlänk-varianten ("Få Pro →", "Se vad Pro innehåller") — samma beteende. */
export function ProTextLink({
  children,
  className,
  title,
  source,
}: {
  children: ReactNode;
  className?: string;
  title?: string;
  source?: string;
}) {
  const router = useRouter();
  return (
    <button
      type="button"
      title={title}
      onClick={() => openPaywallOrNavigate(router, { source })}
      className={cn("inline-flex items-center gap-1 text-left", className)}
    >
      {children}
    </button>
  );
}
