import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Urvalet för de graderade svepen: nivåerna i ordning, svansens reserverade andel,
 * och att ett id aldrig tas två gånger. Prisma mockas — varje findMany svarar ur
 * en lista per nivå (känd på `where`-formen).
 */
const calls: { where: unknown; take: number }[] = [];
let pools: Record<string, string[]> = {};

function tierOf(where: { AND: Record<string, unknown>[] }): string {
  const w = where.AND[1];
  if ("OR" in w && !("viewCount" in w)) return "watched";
  if ("viewCount" in w) return "hot";
  if ("lowestPriceOre" in w) return "valuable";
  return "tail";
}

vi.mock("@/lib/db", () => ({
  prisma: {
    product: {
      findMany: async (args: { where: { AND: Record<string, unknown>[] }; take: number }) => {
        calls.push({ where: args.where, take: args.take });
        const excluded = (args.where.AND[2] as { id?: { notIn: string[] } }).id?.notIn ?? [];
        return (pools[tierOf(args.where)] ?? [])
          .filter((id) => !excluded.includes(id))
          .slice(0, args.take)
          .map((id) => ({ id }));
      },
    },
  },
}));

const { selectGradedSweepIds, inIdOrder, TAIL_SHARE } = await import("@/jobs/graded-sweep-select");

const range = (p: string, n: number) => Array.from({ length: n }, (_, i) => `${p}${i}`);

describe("selectGradedSweepIds", () => {
  beforeEach(() => {
    calls.length = 0;
    pools = {};
    vi.spyOn(console, "log").mockImplementation(() => undefined);
  });

  it("takes tiers in order: watched/owned → hot → valuable → tail", async () => {
    pools = { watched: ["w0"], hot: ["h0", "h1"], valuable: range("v", 50), tail: range("t", 50) };
    const ids = await selectGradedSweepIds({ baseWhere: {}, field: "ebaySoldCheckedAt", budget: 20, tag: "t" });
    expect(ids.slice(0, 3)).toEqual(["w0", "h0", "h1"]);
    expect(ids).toHaveLength(20);
    // Svansen får sin reserverade andel även när de värdefulla räcker till allt.
    expect(ids.filter((id) => id.startsWith("t"))).toHaveLength(Math.floor(20 * TAIL_SHARE));
  });

  it("the tail fills whatever the valuable tier leaves", async () => {
    pools = { valuable: range("v", 3), tail: range("t", 50) };
    const ids = await selectGradedSweepIds({ baseWhere: {}, field: "gradedAskCheckedAt", budget: 10, tag: "t" });
    expect(ids).toEqual([...range("v", 3), ...range("t", 7)]);
  });

  it("never selects an id twice", async () => {
    pools = { watched: ["a"], hot: ["a", "b"], valuable: ["a", "b", "c"], tail: ["a", "b", "c", "d"] };
    const ids = await selectGradedSweepIds({ baseWhere: {}, field: "ebaySoldCheckedAt", budget: 10, tag: "t" });
    expect(ids).toEqual(["a", "b", "c", "d"]);
  });
});

describe("inIdOrder", () => {
  it("returns rows in the selection's order and drops missing ids", () => {
    expect(inIdOrder(["c", "a", "x"], [{ id: "a" }, { id: "c" }])).toEqual([{ id: "c" }, { id: "a" }]);
  });
});
