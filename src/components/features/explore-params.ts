"use client";

import { useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { useRouter } from "@/i18n/navigation";

/**
 * Desktop-katalogens filternavigering: varje kontroll skriver sin URL-parameter
 * direkt (router.push → force-dynamic-sidan renderar om med nya träffar). Samma
 * svenska parametrar som GET-formuläret, så länkar/bakåtknappen fungerar precis
 * som förr. `scroll: false` — filtren sitter bredvid resultatet och ett hopp till
 * sidtoppen på varje kryss hade känts som en sidladdning.
 */
export function useExploreParams() {
  const router = useRouter();
  const sp = useSearchParams();

  const apply = useCallback(
    (updates: Record<string, string | null>) => {
      const next = new URLSearchParams(sp?.toString() ?? "");
      for (const [key, value] of Object.entries(updates)) {
        if (value === null || value === "") next.delete(key);
        else next.set(key, value);
      }
      // Filterbyte = ny träffmängd → gammal sidparameter pekar mitt i ingenting.
      next.delete("sida");
      const qs = next.toString();
      router.push(qs ? `/produkter?${qs}` : "/produkter", { scroll: false });
    },
    [router, sp]
  );

  /** Kommaseparerat flerval (kategori/butik): slå av/på ETT värde. */
  const toggleCsv = useCallback(
    (key: string, value: string) => {
      const current = (sp?.get(key) ?? "").split(",").map((v) => v.trim()).filter(Boolean);
      const next = current.includes(value)
        ? current.filter((v) => v !== value)
        : [...current, value];
      apply({ [key]: next.length > 0 ? next.join(",") : null });
    },
    [sp, apply]
  );

  const getCsv = useCallback(
    (key: string): string[] =>
      (sp?.get(key) ?? "").split(",").map((v) => v.trim()).filter(Boolean),
    [sp]
  );

  return { sp, apply, toggleCsv, getCsv };
}
