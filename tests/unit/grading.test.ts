/**
 * Tester för graderingens kvotlogik (FREE 3/mån, PREMIUM 15/mån) och plan→modell-val.
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
  freeMonthlyLimit,
  getGradingQuota,
  runGradingJob,
} from "@/services/grading";

beforeEach(() => {
  count.mockReset();
  create.mockReset();
  update.mockReset();
  process.env.GRADING_PROVIDER = "mock";
  delete process.env.GRADING_FREE_MONTHLY_LIMIT;
  delete process.env.GRADING_PREMIUM_MONTHLY_LIMIT;
});

const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

describe("freeMonthlyLimit", () => {
  it("läser GRADING_FREE_MONTHLY_LIMIT", () => {
    process.env.GRADING_FREE_MONTHLY_LIMIT = "7";
    expect(freeMonthlyLimit()).toBe(7);
  });

  it("faller tillbaka på 3 vid ogiltigt värde", () => {
    process.env.GRADING_FREE_MONTHLY_LIMIT = "noll";
    expect(freeMonthlyLimit()).toBe(3);
  });
});

describe("getGradingQuota", () => {
  it("PREMIUM = 15/mån default", async () => {
    count.mockResolvedValue(4);
    const q = await getGradingQuota("u1", "PREMIUM");
    expect(q).toEqual({ used: 4, limit: 15, remaining: 11, isPremium: true });
  });

  it("FREE = 3/mån default, räknar månadens jobb", async () => {
    count.mockResolvedValue(2);
    const q = await getGradingQuota("u1", "FREE");
    expect(q).toEqual({ used: 2, limit: 3, remaining: 1, isPremium: false });
  });

  it("räknar bara denna månads icke-misslyckade jobb", async () => {
    count.mockResolvedValue(0);
    await getGradingQuota("u1", "FREE");
    const where = count.mock.calls[0][0].where;
    expect(where.status).toEqual({ not: "FAILED" });
    const expected = new Date();
    expected.setUTCDate(1);
    expected.setUTCHours(0, 0, 0, 0);
    expect((where.createdAt.gte as Date).getTime()).toBe(expected.getTime());
  });
});

describe("runGradingJob", () => {
  it("blockerar FREE-användare som nått månadsgränsen (429)", async () => {
    count.mockResolvedValue(3);
    await expect(
      runGradingJob("u1", "FREE", PNG, PNG)
    ).rejects.toMatchObject({ status: 429 });
    expect(create).not.toHaveBeenCalled();
  });

  it("blockerar även PREMIUM vid månadsgränsen (429)", async () => {
    count.mockResolvedValue(15);
    await expect(
      runGradingJob("u1", "PREMIUM", PNG, PNG)
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
