/**
 * Tester för Tradera-kontokopplingens FetchToken-parsning (XML → token + expiry).
 */
import { describe, expect, it, vi, afterEach } from "vitest";
import { buildTraderaLoginUrl, fetchTraderaToken } from "@/lib/tradera-auth";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("buildTraderaLoginUrl", () => {
  it("bygger token-login-URL med appId, pkey och skey", () => {
    const url = buildTraderaLoginUrl("77FA15BA-E13C-4D83-B6DC-E7F9FFB6601F");
    expect(url).toContain("https://api.tradera.com/token-login?");
    expect(url).toContain("skey=77FA15BA-E13C-4D83-B6DC-E7F9FFB6601F");
  });
});

describe("fetchTraderaToken", () => {
  it("tolkar AuthToken och HardExpirationTime ur FetchToken-svaret", async () => {
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<FetchTokenResult xmlns="http://api.tradera.com">
  <AuthToken>ABC123LONGTOKEN</AuthToken>
  <HardExpirationTime>2027-07-16T19:20:30.45</HardExpirationTime>
</FetchTokenResult>`;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, text: () => Promise.resolve(xml) })
    );

    const result = await fetchTraderaToken("12345", "skey-value");
    expect(result.token).toBe("ABC123LONGTOKEN");
    expect(result.expiresAt.toISOString()).toBe(new Date("2027-07-16T19:20:30.45").toISOString());
  });

  it("kastar fel när svaret saknar token (t.ex. fel skey)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, text: () => Promise.resolve("<soap:Fault>...</soap:Fault>") })
    );

    await expect(fetchTraderaToken("12345", "wrong-skey")).rejects.toThrow();
  });
});
