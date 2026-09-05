import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Play-/App Store-skalet utan RevenueCat-nyckel får ALDRIG visa Stripe (2026-09-05).
 *
 * `/priser` är i appen hela paywallen. `purchasesAvailable()` är false både på webben
 * och i ett app-bygge som saknar `NEXT_PUBLIC_RC_*_KEY` — och webbgrenen är Stripe.
 * Så länge Android-nyckeln inte finns i Railway hade Play-bygget alltså visat en egen
 * checkout för digitala varor, vilket Google avvisar vid granskningen. Grinden
 * `storeShellWithoutPurchases()` skiljer de två fallen; testet vaktar att knappen
 * faktiskt använder den i webbgrenen.
 */
const ROOT = resolve(__dirname, "../..");

vi.mock("@capacitor/core", () => ({
  Capacitor: {
    isNativePlatform: () => (globalThis as { __native?: boolean }).__native ?? false,
    getPlatform: () => ((globalThis as { __native?: boolean }).__native ? "android" : "web"),
  },
}));
vi.mock("@revenuecat/purchases-capacitor", () => ({
  Purchases: {},
  LOG_LEVEL: { WARN: 2 },
  STOREKIT_VERSION: { STOREKIT_2: "STOREKIT_2" },
}));

const g = globalThis as { __native?: boolean };

describe("storeShellWithoutPurchases", () => {
  const originalKey = process.env.NEXT_PUBLIC_RC_ANDROID_KEY;

  beforeEach(() => {
    vi.resetModules();
  });
  afterEach(() => {
    g.__native = undefined;
    if (originalKey === undefined) delete process.env.NEXT_PUBLIC_RC_ANDROID_KEY;
    else process.env.NEXT_PUBLIC_RC_ANDROID_KEY = originalKey;
  });

  it("Android-skal utan nyckel: inga köp OCH skal-utan-köp (⇒ 'kommer snart', inte Stripe)", async () => {
    g.__native = true;
    delete process.env.NEXT_PUBLIC_RC_ANDROID_KEY;
    const m = await import("@/lib/purchases");
    expect(m.purchasesAvailable()).toBe(false);
    expect(m.storeShellWithoutPurchases()).toBe(true);
  });

  it("Android-skal MED nyckel: köp via butiken, grinden är av", async () => {
    g.__native = true;
    process.env.NEXT_PUBLIC_RC_ANDROID_KEY = "goog_test";
    const m = await import("@/lib/purchases");
    expect(m.purchasesAvailable()).toBe(true);
    expect(m.storeShellWithoutPurchases()).toBe(false);
  });

  it("webben: varken köp i butik eller skal-grind (Stripe-grenen får visas)", async () => {
    g.__native = false;
    delete process.env.NEXT_PUBLIC_RC_ANDROID_KEY;
    const m = await import("@/lib/purchases");
    expect(m.purchasesAvailable()).toBe(false);
    expect(m.storeShellWithoutPurchases()).toBe(false);
  });

  it("Uppgradera-knappen grindar webbgrenen på skal-utan-köp", () => {
    const src = readFileSync(
      resolve(ROOT, "src/components/features/upgrade-button.tsx"),
      "utf8",
    );
    expect(src).toContain("storeShellWithoutPurchases");
    // Webbgrenen (Stripe) får bara nås när INTE skal-utan-köp.
    expect(src).toMatch(/if \(!webCheckout \|\| storeShellNoIap\)/);
    // Stripe-portalen för befintliga webbkunder visas inte heller i skalet.
    expect(src).toMatch(/proSource === "stripe" && !native && !storeShellNoIap/);
  });
});
