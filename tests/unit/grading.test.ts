/**
 * Tester för graderingens kvotlogik (FREE 5/dygn) och plan→modell-val.
 * Prisma och adaptern mockas via GRADING_PROVIDER=mock.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const count = vi.fn();
const create = vi.fn();
const update = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    gradingJob: {
      count: (...a: unknown[]) => count(...a),
      create: (...a: unknown[]) => create(...a),
      update: (...a: unknown[]) => update(...a),
    },
  },
}));

import {
  freeDailyLimit,
  getGradingQuota,
  runGradingJob,
} from "@/services/grading";

beforeEach(() => {
  count.mockReset();
  create.mockReset();
  update.mockReset();
  process.env.GRADING_PROVIDER = "mock";
  process.env.GRADING_FREE_DAILY_LIMIT = "5";
});

const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

describe("freeDailyLimit", () => {
  it("läser GRADING_FREE_DAILY_LIMIT", () => {
    process.env.GRADING_FREE_DAILY_LIMIT = "3";
    expect(freeDailyLimit()).toBe(3);
  });

  it("faller tillbaka på 5 vid ogiltigt värde", () => {
    process.env.GRADING_FREE_DAILY_LIMIT = "noll";
    expect(freeDailyLimit()).toBe(5);
  });
});

describe("getGradingQuota", () => {
  it("PREMIUM är obegränsad", async () => {
    const q = await getGradingQuota("u1", "PREMIUM");
    expect(q).toEqual({ used: 0, limit: null, remaining: null });
    expect(count).not.toHaveBeenCalled();
  });

  it("FREE räknar dagens jobb och returnerar återstående", async () => {
    count.mockResolvedValue(2);
    const q = await getGradingQuota("u1", "FREE");
    expect(q).toEqual({ used: 2, limit: 5, remaining: 3 });
  });
});

describe("runGradingJob", () => {
  it("blockerar FREE-användare som nått dygnsgränsen (429)", async () => {
    count.mockResolvedValue(5);
    await expect(
      runGradingJob("u1", "FREE", PNG, PNG)
    ).rejects.toMatchObject({ status: 429 });
    expect(create).not.toHaveBeenCalled();
  });

  it("kör graderingen och markerar jobbet COMPLETED under gränsen", async () => {
    count.mockResolvedValue(0);
    create.mockResolvedValue({ id: "j1", status: "RUNNING" });
    update.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
      Promise.resolve({ id: "j1", ...data })
    );

    const { job } = await runGradingJob("u1", "FREE", PNG, PNG);

    expect(create).toHaveBeenCalledOnce();
    expect(job.status).toBe("COMPLETED");
    expect(typeof job.overallGrade).toBe("number");
  });
});
