/**
 * Paywall-registret: arket när värden finns, prissidan när den inte gör det.
 *
 * ⛔ Fallbacken är inte kosmetik. Alla Pro-låsta ytor anropar `openPaywallOrNavigate`
 * i stället för `router.push("/priser")`; om värden av någon anledning inte hunnit
 * registrera sig (SSR, en route utan rot-layout, ett test) måste låset ändå leda
 * någonstans — en tyst no-op hade gjort varje "Uppgradera" till en död knapp.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Tratten (2026-09-15): varje prompt räknas på sin källa via lib/track, och
// UpgradeButton läser samma källa tillbaka vid klicket.
const trackMock = vi.fn();
vi.mock("@/lib/track", () => ({ track: (...a: unknown[]) => trackMock(...a) }));

import { lastPaywallSource, openPaywall, openPaywallOrNavigate, registerPaywallOpen } from "@/lib/paywall";
import { foldPaywallFunnel } from "@/services/paywall-funnel";

describe("openPaywallOrNavigate", () => {
  beforeEach(() => trackMock.mockReset());
  afterEach(() => registerPaywallOpen(null));

  it("räknar varje prompt på sin källa — även fallbacken till /priser — och minns källan för klicket", () => {
    const push = vi.fn();
    openPaywallOrNavigate({ push }, { source: "free-restock-limit" });
    expect(trackMock).toHaveBeenCalledWith("paywall_open", "free-restock-limit");
    expect(lastPaywallSource()).toBe("free-restock-limit");
    openPaywallOrNavigate({ push });
    expect(trackMock).toHaveBeenLastCalledWith("paywall_open", "unknown");
  });

  it("utan registrerad värd → navigerar till /priser", () => {
    const push = vi.fn();
    expect(openPaywall()).toBe(false);
    openPaywallOrNavigate({ push });
    expect(push).toHaveBeenCalledWith("/priser");
  });

  it("med värd → öppnar arket och navigerar INTE", () => {
    const open = vi.fn();
    const push = vi.fn();
    registerPaywallOpen(open);
    openPaywallOrNavigate({ push }, { source: "chart-max" });
    expect(open).toHaveBeenCalledWith({ source: "chart-max" });
    expect(push).not.toHaveBeenCalled();
  });

  it("avregistrering återställer fallbacken", () => {
    registerPaywallOpen(vi.fn());
    registerPaywallOpen(null);
    const push = vi.fn();
    openPaywallOrNavigate({ push });
    expect(push).toHaveBeenCalledWith("/priser");
  });
});

describe("foldPaywallFunnel", () => {
  it("summerar öppningar och klick per källa, flest öppningar först, okänd källa = 'unknown'", () => {
    const rows = foldPaywallFunnel([
      { entityId: "priser", eventType: "paywall_open", count: 10 },
      { entityId: "priser", eventType: "upgrade_click", count: 2 },
      { entityId: "free-restock-limit", eventType: "paywall_open", count: 25 },
      { entityId: null, eventType: "paywall_open", count: 1 },
      { entityId: "priser", eventType: "product_view", count: 99 }, // främmande typ ignoreras
    ]);
    expect(rows.map((r) => r.source)).toEqual(["free-restock-limit", "priser", "unknown"]);
    expect(rows[1]).toEqual({ source: "priser", opens: 10, upgradeClicks: 2 });
    expect(rows[0].upgradeClicks).toBe(0);
  });
});
