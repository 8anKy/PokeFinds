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

import { getScannerQuota, isIntroScan, parseGuessedNumber, recordScanUsage, runScannerJob } from "@/services/scanner";

beforeEach(() => {
  count.mockReset();
  create.mockReset();
  process.env.OCR_PROVIDER = "mock";
  delete process.env.SCANNER_FREE_MONTHLY_LIMIT;
  delete process.env.SCANNER_PREMIUM_MONTHLY_LIMIT;
  delete process.env.SCANNER_INTRO_SONNET_SCANS;
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

describe("isIntroScan", () => {
  it("första skanningen (0 tidigare) = Sonnet", async () => {
    count.mockResolvedValue(0);
    expect(await isIntroScan("u1")).toBe(true);
  });

  it("efter första (≥1 tidigare) = Haiku", async () => {
    count.mockResolvedValue(1);
    expect(await isIntroScan("u1")).toBe(false);
  });

  it("respekterar SCANNER_INTRO_SONNET_SCANS", async () => {
    process.env.SCANNER_INTRO_SONNET_SCANS = "3";
    count.mockResolvedValue(2);
    expect(await isIntroScan("u1")).toBe(true);
    count.mockResolvedValue(3);
    expect(await isIntroScan("u1")).toBe(false);
  });
});

describe("runScannerJob", () => {
  it("blockerar vid månadsgränsen (429) innan jobbet skapas", async () => {
    count.mockResolvedValue(30);
    await expect(runScannerJob("u1", "FREE", PNG)).rejects.toMatchObject({ status: 429 });
  });
});

describe("parseGuessedNumber (nummer-tolkning för matchning)", () => {
  it("läser full N/T", () => {
    expect(parseGuessedNumber("143/195")).toEqual({ num: 143, total: 195 });
  });
  it("läser naket nummer utan total (buggen som gömde rätt Altaria)", () => {
    expect(parseGuessedNumber("143")).toEqual({ num: 143, total: null });
  });
  it("plockar numret ur brus", () => {
    expect(parseGuessedNumber("no. 25")).toEqual({ num: 25, total: null });
  });
  it("null när inget nummer finns", () => {
    expect(parseGuessedNumber("Altaria")).toBeNull();
    expect(parseGuessedNumber(null)).toBeNull();
  });
});
