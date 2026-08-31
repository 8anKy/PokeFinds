import { describe, expect, it } from "vitest";
import { decideRecycle, recycleConfigFromEnv } from "@/lib/memory-recycle";

const MB = 1048576;
const cfg = recycleConfigFromEnv({});
const quiet = Date.UTC(2026, 7, 29, 4, 20); // 04:20 UTC
const busy = Date.UTC(2026, 7, 29, 13, 20);

describe("decideRecycle", () => {
  it("startar om nattligt över taket (450 MB) i det tysta fönstret", () => {
    expect(decideRecycle(600 * MB, quiet, 7200, null, cfg)).toBe("nightly");
  });
  it("gör inget under taket, utanför fönstret eller för tidigt efter boot", () => {
    expect(decideRecycle(400 * MB, quiet, 7200, null, cfg)).toBe("none");
    expect(decideRecycle(600 * MB, busy, 7200, null, cfg)).toBe("none");
    expect(decideRecycle(600 * MB, quiet, 600, null, cfg)).toBe("none");
  });
  it("nödomstart när som helst över nödtaket (1 GB), men aldrig tätare än 3 h", () => {
    expect(decideRecycle(900 * MB, busy, 7200, null, cfg)).toBe("none");
    expect(decideRecycle(1100 * MB, busy, 7200, null, cfg)).toBe("emergency");
    expect(decideRecycle(3500 * MB, busy, 7200, busy - 3600 * 1000, cfg)).toBe("none");
    expect(decideRecycle(3500 * MB, busy, 7200, busy - 4 * 3600 * 1000, cfg)).toBe("emergency");
  });
  it("MEMORY_RECYCLE_MB=0 stänger av allt, även nöd", () => {
    const off = recycleConfigFromEnv({ MEMORY_RECYCLE_MB: "0" });
    expect(decideRecycle(9000 * MB, quiet, 7200, null, off)).toBe("none");
  });
});
