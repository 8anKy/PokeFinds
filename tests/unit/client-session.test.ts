import { beforeEach, describe, expect, it, vi } from "vitest";

const getSession = vi.fn();
vi.mock("next-auth/react", () => ({ getSession: (...a: unknown[]) => getSession(...a) }));

describe("getSharedSession — en hämtning per sida, inte en per komponent", () => {
  beforeEach(() => {
    vi.resetModules();
    getSession.mockReset();
  });

  it("48 samtidiga anropare delar EN nätverkshämtning och får samma svar", async () => {
    let resolve!: (v: unknown) => void;
    getSession.mockReturnValue(new Promise((r) => (resolve = r)));
    const { getSharedSession } = await import("../../src/lib/client-session");
    const calls = Array.from({ length: 48 }, () => getSharedSession());
    expect(getSession).toHaveBeenCalledTimes(1);
    resolve({ user: { isPro: true } });
    const results = await Promise.all(calls);
    expect(results.every((s) => (s as { user: { isPro: boolean } }).user.isPro)).toBe(true);
  });

  it("svaret återanvänds inom TTL och hämtas om efter invalidering", async () => {
    getSession.mockResolvedValue({ user: { isPro: false } });
    const { getSharedSession, invalidateSharedSession } = await import("../../src/lib/client-session");
    await getSharedSession();
    await getSharedSession();
    expect(getSession).toHaveBeenCalledTimes(1);
    invalidateSharedSession();
    getSession.mockResolvedValue({ user: { isPro: true } });
    const fresh = (await getSharedSession()) as { user: { isPro: boolean } };
    expect(getSession).toHaveBeenCalledTimes(2);
    expect(fresh.user.isPro).toBe(true);
  });

  it("ett misslyckat anrop cachas inte — nästa anropare försöker igen", async () => {
    getSession.mockRejectedValueOnce(new Error("nät"));
    const { getSharedSession } = await import("../../src/lib/client-session");
    await expect(getSharedSession()).rejects.toThrow("nät");
    getSession.mockResolvedValue(null);
    expect(await getSharedSession()).toBeNull();
    expect(getSession).toHaveBeenCalledTimes(2);
  });
});
