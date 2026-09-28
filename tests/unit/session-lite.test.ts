/**
 * SESSIONEN UR COOKIEN (2026-09-28): Mer-fliken ritas utan databas. `auth()` läser om
 * användaren ur Neon när token är > 30 min gammal — vid appstart nästan alltid — och
 * fliken stod blank tills databasen vaknat (p99 2–3 s).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { encode } from "next-auth/jwt";

const jar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: () => ({ get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined) }),
}));
const auth = vi.fn();
vi.mock("@/lib/auth", () => ({ auth: () => auth() }));

import { readSessionLite } from "@/lib/session-lite";

const SECRET = "test-secret-for-session-lite";

describe("readSessionLite", () => {
  beforeEach(() => {
    jar.clear();
    auth.mockReset();
    process.env.NEXTAUTH_SECRET = SECRET;
  });

  it("ingen cookie ⇒ gäst, och ingen auth()", async () => {
    expect(await readSessionLite()).toBeNull();
    expect(auth).not.toHaveBeenCalled();
  });

  it("giltig cookie ⇒ namn, roll och Pro ur token — utan auth() (ingen DB)", async () => {
    const token = await encode({
      token: {
        id: "u1",
        name: "Milos",
        email: "m@x.se",
        role: "ADMIN",
        planTier: "PREMIUM",
        bonusProUntil: null,
        stripeProUntil: null,
        onboardingCompleted: true,
        refreshedAt: 0,
      },
      secret: SECRET,
    });
    jar.set("__Secure-next-auth.session-token", token);
    expect(await readSessionLite()).toEqual({ id: "u1", name: "Milos", role: "ADMIN", email: "m@x.se", isPro: true });
    expect(auth).not.toHaveBeenCalled();
  });

  it("oläsbar/chunkad cookie ⇒ den långsamma vägen svarar", async () => {
    jar.set("next-auth.session-token.0", "del-1");
    auth.mockResolvedValue({ user: { id: "u2", name: null, role: "USER", email: null, isPro: false } });
    expect(await readSessionLite()).toMatchObject({ id: "u2", role: "USER", isPro: false });
    jar.clear();
    jar.set("next-auth.session-token", "skräp");
    auth.mockResolvedValue(null);
    expect(await readSessionLite()).toBeNull();
    expect(auth).toHaveBeenCalledTimes(2);
  });
});
