/**
 * Paywall-registret: arket när värden finns, prissidan när den inte gör det.
 *
 * ⛔ Fallbacken är inte kosmetik. Alla Pro-låsta ytor anropar `openPaywallOrNavigate`
 * i stället för `router.push("/priser")`; om värden av någon anledning inte hunnit
 * registrera sig (SSR, en route utan rot-layout, ett test) måste låset ändå leda
 * någonstans — en tyst no-op hade gjort varje "Uppgradera" till en död knapp.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { openPaywall, openPaywallOrNavigate, registerPaywallOpen } from "@/lib/paywall";

describe("openPaywallOrNavigate", () => {
  afterEach(() => registerPaywallOpen(null));

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
