/**
 * Klient-sидig engagemangs-spårning. Skjuter en händelse till /api/track utan att
 * blockera UI:t (sendBeacon när det finns, annars keepalive-fetch). Får ALDRIG
 * kasta — spårning är biprodukt, inte huvudflöde.
 */
/**
 * `paywall_open`/`upgrade_click` (2026-09-15): konverteringstratten. Nyckeln är
 * KÄLLAN ("free-restock-limit", "chart-max", "priser"…) i stället för en slug —
 * samma opersonliga händelsetabell, ingen userId. Läses i admin → Engagemang.
 */
/**
 * `share_card` (2026-10-01): delningskortet. Nyckeln är "<yta>:<utfall>" —
 * "scan:open" (förhandsvisningen öppnades), "scan:shared", "scan:saved".
 */
export type TrackType =
  | "product_view"
  | "list_click"
  | "search_click"
  | "paywall_open"
  | "upgrade_click"
  | "share_card";

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
