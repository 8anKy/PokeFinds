"use client";

import { useEffect } from "react";

/**
 * Registrerar service workern (/sw.js) så appen blir installerbar och
 * offline-tålig. Endast i produktion — i dev stör en SW HMR/cache.
 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // registreringsfel ska aldrig krascha appen
    });
  }, []);
  return null;
}
