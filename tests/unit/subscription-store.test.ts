import { describe, expect, it } from "vitest";
import { latestStoreByUser, storeChannel } from "@/lib/subscription-store";

const row = (userId: string, iso: string, store: unknown, action = "user.plan.revenuecat") => ({
  userId,
  action,
  createdAt: new Date(iso),
  metadata: store === undefined ? {} : { store },
});

describe("intäkt per butik", () => {
  it("senaste raden MED en butik vinner, oavsett radordning", () => {
    const m = latestStoreByUser([
      row("a", "2026-10-01", "PLAY_STORE"),
      row("a", "2026-09-01", "APP_STORE"),
      row("a", "2026-10-05", null), // rad utan butik säger inget
    ]);
    expect(m.get("a")).toBe("PLAY_STORE");
  });
  it("Stripe-rader och rader utan butik ger ingen butik", () => {
    const m = latestStoreByUser([row("b", "2026-10-01", "APP_STORE", "user.plan.stripe"), row("c", "2026-10-01", undefined)]);
    expect(m.size).toBe(0);
  });
  it("okänd butik gissas aldrig till App Store", () => {
    expect(storeChannel("APP_STORE")).toBe("app_store");
    expect(storeChannel("PLAY_STORE")).toBe("play_store");
    expect(storeChannel(undefined)).toBe("store_unknown");
    expect(storeChannel("PROMOTIONAL")).toBe("store_unknown");
  });
});
