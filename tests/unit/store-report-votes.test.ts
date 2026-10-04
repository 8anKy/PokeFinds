import { describe, expect, it } from "vitest";
import { tallyVotes, voteLabelKey, voteLabelSv } from "@/lib/store-report-votes";

describe("röster på butiksrapporter", () => {
  it("räknar båda sorterna och tar den SENASTE rösten", () => {
    const t = tallyVotes([
      { kind: "CONFIRM", createdAt: new Date("2026-10-05T10:00:00Z") },
      { kind: "DISPUTE", createdAt: new Date("2026-10-05T11:00:00Z") },
      { kind: "CONFIRM", createdAt: new Date("2026-10-05T10:30:00Z") },
    ]);
    expect(t).toEqual({ confirmCount: 2, disputeCount: 1, lastVote: { kind: "DISPUTE", at: "2026-10-05T11:00:00.000Z" } });
    expect(tallyVotes([])).toEqual({ confirmCount: 0, disputeCount: 0, lastVote: null });
  });
  it("knapparna betyder motsatsen på en slutsåld rapport", () => {
    expect(voteLabelKey("SEEN", "CONFIRM")).toBe("voteStillThere");
    expect(voteLabelKey("SEEN", "DISPUTE")).toBe("voteGone");
    expect(voteLabelKey("SOLD_OUT", "CONFIRM")).toBe("voteStillSoldOut");
    expect(voteLabelKey("SOLD_OUT", "DISPUTE")).toBe("voteBackInStock");
    expect(voteLabelSv("SOLD_OUT", "DISPUTE")).toBe("finns igen");
  });
});
