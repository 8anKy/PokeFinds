import { describe, expect, it } from "vitest";
import { feedModeQuery, freshBucket, FRESH_BUCKET_MS, VISIBLE_GROUP_SLUGS } from "@/lib/community-feed-modes";
import { buildFeedWhere } from "@/services/community";

describe("flödets tre lägen", () => {
  it("varje läge har sin fråga; Allt använder det förrenderade flödet", () => {
    expect(feedModeQuery("all", false)).toBeNull();
    expect(feedModeQuery("stores", false)).toBe("reports=1");
    expect(feedModeQuery("stores", true)).toBe("reports=1&fresh=1");
    expect(feedModeQuery("market", true)).toBe("group=kop-salj-byt");
    expect(VISIBLE_GROUP_SLUGS).toEqual(["allmant", "kop-salj-byt"]);
  });

  it("färska fynd = Finns-rapporter inom 12 h räknat från 10-minutersfacket", () => {
    const now = Date.parse("2026-10-05T12:07:00Z");
    const bucket = freshBucket(now);
    expect(bucket * FRESH_BUCKET_MS).toBe(Date.parse("2026-10-05T12:00:00Z"));
    const where = buildFeedWhere({ freshBucket: bucket });
    const report = (where.storeReport as { is: Record<string, unknown> }).is;
    expect(report.observation).toBe("SEEN");
    expect((report.observedAt as { gte: Date }).gte.toISOString()).toBe("2026-10-05T00:00:00.000Z");
  });
});
