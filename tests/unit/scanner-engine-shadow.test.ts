import { afterEach, describe, expect, it } from "vitest";
import { engineModeFor, engineShadowEnabled, shadowRecord } from "@/lib/scanner-engine-shadow";

describe("skannermotorns skuggläge", () => {
  afterEach(() => {
    delete process.env.SCANNER_ENGINE_URL;
    delete process.env.SCANNER_ENGINE_SECRET;
    delete process.env.SCANNER_ENGINE_PRIMARY;
  });

  it("motorläget: bara admin med spaken på admin, alla med all, ingen utan motor", () => {
    expect(engineModeFor("SUPERADMIN")).toBe(false); // ingen motor konfigurerad
    process.env.SCANNER_ENGINE_URL = "http://engine:8080";
    process.env.SCANNER_ENGINE_SECRET = "s";
    expect(engineModeFor("SUPERADMIN")).toBe(false); // spaken av
    process.env.SCANNER_ENGINE_PRIMARY = "admin";
    expect(engineModeFor("SUPERADMIN")).toBe(true);
    expect(engineModeFor("ADMIN")).toBe(true);
    expect(engineModeFor("USER")).toBe(false);
    expect(engineModeFor(undefined)).toBe(false);
    process.env.SCANNER_ENGINE_PRIMARY = "all";
    expect(engineModeFor("USER")).toBe(true);
  });

  it("är av utan både URL och hemlighet", () => {
    expect(engineShadowEnabled()).toBe(false);
    process.env.SCANNER_ENGINE_URL = "http://engine:8080";
    expect(engineShadowEnabled()).toBe(false);
    process.env.SCANNER_ENGINE_SECRET = "s";
    expect(engineShadowEnabled()).toBe(true);
  });

  it("bokför ettan, topp-5 och tiden", () => {
    const r = shadowRecord({
      best: "a",
      candidates: [1, 2, 3, 4, 5, 6].map((i) => ({ cardId: `c${i}`, inliers: 10 * i })),
      ms: 420,
      regionSwapFrom: "z",
    });
    expect(r).toEqual({ v: 1, best: "a", top: ["c1", "c2", "c3", "c4", "c5"], inliers: [10, 20, 30, 40, 50], ms: 420, swap: "z" });
  });

  it("ett fel blir en rad med err, aldrig ett påhittat kort", () => {
    expect(shadowRecord(null, "timeout")).toEqual({ v: 1, best: null, top: [], inliers: [], ms: null, err: "timeout" });
    expect(shadowRecord({ error: "bad-image" }).err).toBe("bad-image");
  });
});
