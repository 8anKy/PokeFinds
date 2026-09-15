"use client";
/**
 * SISTA FELGRÄNSEN — ersätter Nexts svarta "Application error"-sida med något
 * som går att ta sig ur: ett kort besked och en "Ladda om"-knapp. Delarna som
 * kan gå sönder för sig (graf, karusell) har egna gränser (ui/error-boundary.tsx);
 * den här fångar resten. Ingen i18n-hook: felet kan ha slagit ut providern.
 */
import { useEffect } from "react";

export default function LocaleError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("[route-error]", error);
  }, [error]);
  return (
    <div className="flex min-h-[60dvh] flex-col items-center justify-center gap-4 px-6 text-center">
      <p className="font-display text-lg font-semibold text-ink">Något gick fel</p>
      <p className="max-w-xs text-sm text-ink-muted">Sidan kunde inte visas. Ladda om så försöker vi igen.</p>
      <button
        type="button"
        onClick={() => reset()}
        className="rounded-lg bg-holo-cyan px-5 py-2.5 text-sm font-semibold text-surface"
      >
        Ladda om
      </button>
    </div>
  );
}
