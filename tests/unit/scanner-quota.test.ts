/**
 * Tester för skannerns dygnskvot (FREE 10 / PREMIUM 100). Prisma mockas.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const count = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: { scannerJob: { count: (...a: unknown[]) => count(...a) } },
}));

import { getScannerQuota, runScannerJob } from "@/services/scanner";

beforeEach(() => {
  count.mockReset();
  process.env.OCR_PROVIDER = "mock";
  delete process.env.SCANNER_FREE_DAILY_LIMIT;
  delete process.env.SCANNER_PREMIUM_DAILY_LIMIT;
});

const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

describe("getScannerQuota", () => {
  it("FREE = 10/dygn default", async () => {
    count.mockResolvedValue(3);
    expect(await getScannerQuota("u1", "FREE")).toEqual({ used: 3, limit: 10, remaining: 7 });
  });

  it("PREMIUM = 100/dygn default", async () => {
    count.mockResolvedValue(10);
    expect(await getScannerQuota("u1", "PREMIUM")).toEqual({ used: 10, limit: 100, remaining: 90 });
  });
});

describe("runScannerJob", () => {
  it("blockerar vid dygnsgränsen (429) innan jobbet skapas", async () => {
    count.mockResolvedValue(10);
    await expect(runScannerJob("u1", "FREE", PNG)).rejects.toMatchObject({ status: 429 });
  });
});
