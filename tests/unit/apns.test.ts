/** Tester för native push-sändaren (src/lib/apns.ts) — guard-vägen utan APNs-env. */
import { describe, expect, it } from "vitest";
import { sendPush } from "@/lib/apns";

describe("sendPush", () => {
  it("no-op utan tokens", async () => {
    expect(await sendPush([], { title: "x", body: "y" })).toEqual({ invalidTokens: [] });
  });

  it("no-op när APNs-env saknas (ingen provider konfigurerad) — kastar inte", async () => {
    // Inga APNS_KEY/KEY_ID/TEAM_ID i testmiljön → ingen provider → tyst no-op.
    expect(await sendPush(["device-token"], { title: "x", body: "y", url: "/p" })).toEqual({
      invalidTokens: [],
    });
  });
});
