/**
 * Tester för mapPool — bunden samtidighet över DB-skrivningar i batch-jobben.
 * Verifierar att ALLA items körs, att samtidigheten aldrig överskrids, och att
 * tom lista/concurrency > längd hanteras.
 */
import { describe, expect, it } from "vitest";
import { mapPool } from "../../src/lib/concurrency";

describe("mapPool", () => {
  it("kör varje item exakt en gång och respekterar gränsen", async () => {
    const items = Array.from({ length: 50 }, (_, i) => i);
    const seen: number[] = [];
    let active = 0;
    let maxActive = 0;

    await mapPool(items, 8, async (n) => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 1));
      seen.push(n);
      active--;
    });

    expect(seen.sort((a, b) => a - b)).toEqual(items);
    expect(maxActive).toBeLessThanOrEqual(8);
    expect(maxActive).toBeGreaterThan(1); // faktiskt parallellt
  });

  it("hanterar tom lista och concurrency större än längden", async () => {
    let calls = 0;
    await mapPool([], 4, async () => { calls++; });
    expect(calls).toBe(0);
    await mapPool([1, 2], 10, async () => { calls++; });
    expect(calls).toBe(2);
  });
});
