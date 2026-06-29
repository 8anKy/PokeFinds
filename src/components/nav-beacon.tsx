"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

// TILLFÄLLIG: rapporterar varje sidladdning/navigering till /api/_debug så vi kan
// se reload-loopens URL-sekvens i WebView:en. TA BORT när loopen är löst.
export function NavBeacon() {
  const pathname = usePathname();
  useEffect(() => {
    try {
      void fetch("/api/navlog", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          path: pathname,
          ua: typeof navigator !== "undefined" ? navigator.userAgent.slice(0, 40) : "",
        }),
        keepalive: true,
      }).catch(() => {});
    } catch {
      // tyst
    }
  }, [pathname]);
  return null;
}
