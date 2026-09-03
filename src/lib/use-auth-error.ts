"use client";

import { useTranslations } from "next-intl";

/**
 * Kroppen ett auth-API svarar med vid fel. `code` är den stabila nyckeln,
 * `error` den svenska reserven — se `src/lib/auth-errors.ts`.
 */
export interface AuthErrorPayload {
  error?: string;
  code?: string;
  field?: string;
}

/**
 * Översätter ett auth-felsvar till användarens språk.
 *
 * ⛔ ORDNINGEN ÄR HELA POÄNGEN: koden först, serverns text bara som reserv.
 * Servern vet inte vilket språk läsaren har, så dess `error` är ALLTID svensk —
 * visas den i den engelska appen står ett svenskt felmeddelande mitt i ett
 * engelskt formulär (uppmätt i Android-appen 2026-09-03). Reserven finns kvar
 * för koder som en äldre klient inte känner till: en obegriplig mening är
 * fortfarande bättre än en tom felruta.
 */
export function useAuthErrorMessage() {
  const t = useTranslations("Auth");
  return (data: AuthErrorPayload | null | undefined): string => {
    const key = data?.code ? `serverErrors.${data.code}` : null;
    if (key && t.has(key)) return t(key);
    return data?.error ?? t("genericError");
  };
}
