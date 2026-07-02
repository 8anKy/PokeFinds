/**
 * Test för Tradera token-login-URL:en (Option 3 — token i retur-URL:en).
 */
import { describe, expect, it } from "vitest";
import { buildTraderaLoginUrl } from "@/lib/tradera-auth";

describe("buildTraderaLoginUrl", () => {
  it("bygger token-login-URL med appId och pkey (skey behövs ej för Option 3)", () => {
    const url = new URL(buildTraderaLoginUrl());
    expect(url.origin + url.pathname).toBe("https://api.tradera.com/token-login");
    expect(url.searchParams.has("appId")).toBe(true);
    expect(url.searchParams.has("pkey")).toBe(true);
    expect(url.searchParams.has("skey")).toBe(false);
  });
});
