"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

const STORAGE_KEY = "pokefinds-cookie-consent";

export function CookieBanner() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    try {
      if (!window.localStorage.getItem(STORAGE_KEY)) {
        setVisible(true);
      }
    } catch {
      // localStorage otillgänglig (t.ex. privat läge) — visa inte bannern
    }
  }, []);

  function accept() {
    try {
      window.localStorage.setItem(STORAGE_KEY, "accepted");
    } catch {
      // ignorera
    }
    setVisible(false);
  }

  if (!visible) return null;

  return (
    <div
      role="dialog"
      aria-label="Information om cookies"
      className="fixed inset-x-0 bottom-0 z-50 border-t border-surface-border bg-surface-overlay/95 p-4 backdrop-blur-lg animate-fade-in"
    >
      <div className="mx-auto flex max-w-7xl flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-ink-muted">
          Vi använder endast nödvändiga cookies för inloggning och funktion. Inga
          spårningscookies från tredje part.{" "}
          <Link href="/integritetspolicy" className="text-holo-cyan underline-offset-2 hover:underline">
            Läs mer i vår integritetspolicy
          </Link>
          .
        </p>
        <Button size="sm" onClick={accept} className="shrink-0">
          Ok
        </Button>
      </div>
    </div>
  );
}
