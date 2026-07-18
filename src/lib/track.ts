/**
 * Klient-sидig engagemangs-spårning. Skjuter en händelse till /api/track utan att
 * blockera UI:t (sendBeacon när det finns, annars keepalive-fetch). Får ALDRIG
 * kasta — spårning är biprodukt, inte huvudflöde.
 */
export type TrackType = "product_view" | "list_click" | "search_click";

export function track(type: TrackType, slug: string | null | undefined): void {
  if (!slug || typeof window === "undefined") return;
  try {
    const body = JSON.stringify({ type, slug });
    if (typeof navigator !== "undefined" && navigator.sendBeacon) {
      navigator.sendBeacon(
        "/api/track",
        new Blob([body], { type: "application/json" })
      );
      return;
    }
    void fetch("/api/track", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => {});
  } catch {
    // ignorera — spårning får aldrig störa
  }
}
