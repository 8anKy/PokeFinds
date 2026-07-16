import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Account, Profile, User } from "next-auth";

/**
 * Google-inloggningens signIn-callback (#12): kontolänkning via e-post.
 * - Befintlig användare → länka + bocka av e-postverifieringen (Google har bevisat adressen).
 * - Ny användare → skapa med unikt namn (lower(name) är unikt index) + slumpad hash.
 * - Credentials-flödet passerar orört.
 */

const findUnique = vi.fn();
const findFirst = vi.fn();
const update = vi.fn(async () => ({}));
const create = vi.fn(async () => ({}));

vi.mock("@/lib/db", () => ({
  prisma: { user: { findUnique, findFirst, update, create } },
}));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: vi.fn(), peekRateLimit: vi.fn(), clearRateLimit: vi.fn() }));

// jose mockas så id-token-testerna styr verifieringsutfallet (ingen nätverks-JWKS).
const jwtVerifyMock = vi.fn();
vi.mock("jose", () => ({
  createRemoteJWKSet: vi.fn(() => ({})),
  jwtVerify: (...a: unknown[]) => jwtVerifyMock(...a),
}));

// Client id måste finnas INNAN modulen laddas — annars registreras varken
// GoogleProvider eller google-idtoken-providern.
process.env.GOOGLE_CLIENT_ID = "test-client-id";
const { authOptions } = await import("@/lib/auth");
const signIn = authOptions.callbacks!.signIn!;
const idTokenProvider = authOptions.providers.find((p) => p.options?.id === "google-idtoken") as {
  options: { authorize: (c: Record<string, string> | undefined) => Promise<unknown> };
};
const authorize = (c: Record<string, string> | undefined) => idTokenProvider.options.authorize(c);

const googleAccount = { provider: "google", type: "oauth", providerAccountId: "g-123" } as Account;
const asUser = (email: string | null) => ({ id: "google-id", email }) as unknown as User;

beforeEach(() => {
  findUnique.mockReset();
  findFirst.mockReset();
  update.mockClear();
  create.mockClear();
});

describe("Google signIn-callback", () => {
  it("credentials-inloggning passerar orört (ingen DB-access)", async () => {
    const ok = await signIn({
      user: asUser("x@y.se"),
      account: { provider: "credentials", type: "credentials" } as Account,
    } as Parameters<typeof signIn>[0]);
    expect(ok).toBe(true);
    expect(findUnique).not.toHaveBeenCalled();
  });

  it("befintlig användare länkas och e-postverifieringen bockas av", async () => {
    findUnique.mockResolvedValue({ id: "u1", emailVerifiedAt: null });
    const ok = await signIn({
      user: asUser("Milos@Foilio.SE"),
      account: googleAccount,
      profile: { name: "Milos" } as Profile,
    } as Parameters<typeof signIn>[0]);
    expect(ok).toBe(true);
    // E-posten normaliseras till gemener innan uppslag.
    expect(findUnique).toHaveBeenCalledWith({ where: { email: "milos@foilio.se" } });
    expect(update).toHaveBeenCalledWith({
      where: { id: "u1" },
      data: expect.objectContaining({ emailVerifiedAt: expect.any(Date), verificationToken: null }),
    });
    expect(create).not.toHaveBeenCalled();
  });

  it("redan verifierad befintlig användare rörs inte", async () => {
    findUnique.mockResolvedValue({ id: "u1", emailVerifiedAt: new Date() });
    const ok = await signIn({
      user: asUser("a@b.se"),
      account: googleAccount,
    } as Parameters<typeof signIn>[0]);
    expect(ok).toBe(true);
    expect(update).not.toHaveBeenCalled();
  });

  it("ny användare skapas färdigverifierad med namn från Google-profilen", async () => {
    findUnique.mockResolvedValue(null);
    findFirst.mockResolvedValue(null); // namnet ledigt
    const ok = await signIn({
      user: asUser("ny@person.se"),
      account: googleAccount,
      profile: { name: "Ny Person" } as Profile,
    } as Parameters<typeof signIn>[0]);
    expect(ok).toBe(true);
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        name: "Ny Person",
        email: "ny@person.se",
        emailVerifiedAt: expect.any(Date),
        passwordHash: expect.any(String),
      }),
    });
  });

  it("namnkrock → suffix (lower(name) är ett unikt index)", async () => {
    findUnique.mockResolvedValue(null);
    findFirst.mockResolvedValueOnce({ id: "annan" }).mockResolvedValue(null);
    await signIn({
      user: asUser("ny@person.se"),
      account: googleAccount,
      profile: { name: "Milos" } as Profile,
    } as Parameters<typeof signIn>[0]);
    const created = (create.mock.calls as unknown as [[{ data: { name: string } }]])[0][0];
    expect(created.data.name).toMatch(/^Milos\d{4}$/);
  });

  it("utan e-post från Google → avvisa", async () => {
    const ok = await signIn({
      user: asUser(null),
      account: googleAccount,
    } as Parameters<typeof signIn>[0]);
    expect(ok).toBe(false);
    expect(create).not.toHaveBeenCalled();
  });
});

describe("google-idtoken-providern (appens nativa flöde)", () => {
  // OBS måsvingarna: utan dem returnerar arrowen mocken, och vitest kör
  // beforeEach-RETURVÄRDET som cleanup-hook → mocken anropas efter testet.
  beforeEach(() => {
    jwtVerifyMock.mockReset();
  });

  const dbUser = {
    id: "u1", email: "app@person.se", name: "AppPerson",
    role: "USER", planTier: "FREE", onboardingCompleted: true, emailVerifiedAt: new Date(),
  };

  it("giltig token → verifieras mot vårt client id och ger vår användare", async () => {
    jwtVerifyMock.mockResolvedValue({
      payload: { email: "App@Person.se", email_verified: true, name: "AppPerson" },
    });
    findUnique.mockResolvedValue(dbUser);
    const res = (await authorize({ idToken: "tok" })) as { id: string } | null;
    expect(res?.id).toBe("u1");
    // Audience MÅSTE vara vårt webbklient-id — annars godtas tokens utfärdade åt andra appar.
    expect(jwtVerifyMock).toHaveBeenCalledWith(
      "tok",
      expect.anything(),
      expect.objectContaining({ audience: "test-client-id" })
    );
  });

  it("overifierad e-post i tokenen → avvisa", async () => {
    jwtVerifyMock.mockResolvedValue({ payload: { email: "x@y.se", email_verified: false } });
    expect(await authorize({ idToken: "tok" })).toBeNull();
    expect(findUnique).not.toHaveBeenCalled();
  });

  it("ogiltig signatur/audience (jwtVerify kastar) → avvisa, aldrig krascha", async () => {
    jwtVerifyMock.mockImplementation(() => {
      throw new Error("bad signature");
    });
    expect(await authorize({ idToken: "tok" })).toBeNull();
  });

  it("utan idToken → avvisa", async () => {
    expect(await authorize(undefined)).toBeNull();
    expect(jwtVerifyMock).not.toHaveBeenCalled();
  });
});
