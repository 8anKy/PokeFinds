/**
 * Tester för skannerns månadskvot (FREE 30 / PREMIUM 100). Prisma mockas.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const count = vi.fn();
const create = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    scannerJob: {
      count: (...a: unknown[]) => count(...a),
      create: (...a: unknown[]) => create(...a),
    },
  },
}));

import { getScannerQuota, recordScanUsage, runScannerJob } from "@/services/scanner";

beforeEach(() => {
  count.mockReset();
  create.mockReset();
  process.env.OCR_PROVIDER = "mock";
  delete process.env.SCANNER_FREE_MONTHLY_LIMIT;
  delete process.env.SCANNER_PREMIUM_MONTHLY_LIMIT;
});

const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

describe("getScannerQuota", () => {
  it("FREE = 30/månad default", async () => {
    count.mockResolvedValue(3);
    expect(await getScannerQuota("u1", "FREE")).toEqual({ used: 3, limit: 30, remaining: 27 });
  });

  it("PREMIUM = 100/månad default", async () => {
    count.mockResolvedValue(10);
    expect(await getScannerQuota("u1", "PREMIUM")).toEqual({ used: 10, limit: 100, remaining: 90 });
  });

  it("räknar bara denna månads icke-misslyckade jobb", async () => {
    count.mockResolvedValue(0);
    await getScannerQuota("u1", "FREE");
    const where = count.mock.calls[0][0].where;
    expect(where.status).toEqual({ not: "FAILED" });
    const expected = new Date();
    expected.setUTCDate(1);
    expected.setUTCHours(0, 0, 0, 0);
    expect((where.createdAt.gte as Date).getTime()).toBe(expected.getTime());
  });
});

describe("recordScanUsage", () => {
  it("varje genomförd skanning räknas (COMPLETED)", async () => {
    create.mockResolvedValue({});
    await recordScanUsage("u1");
    expect(create.mock.calls[0][0].data.status).toBe("COMPLETED");
  });
});

describe("runScannerJob", () => {
  it("blockerar vid månadsgränsen (429) innan jobbet skapas", async () => {
    count.mockResolvedValue(30);
    await expect(runScannerJob("u1", "FREE", PNG)).rejects.toMatchObject({ status: 429 });
  });
});
