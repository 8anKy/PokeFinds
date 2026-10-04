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
  it("rapportören räknas som CONFIRM tills hen flyttar sin röst — aldrig båda sidor", () => {
    const at = new Date("2026-10-05T12:00:00Z");
    expect(tallyVotes([], "author")).toEqual({ confirmCount: 1, disputeCount: 0, lastVote: null });
    expect(tallyVotes([{ kind: "CONFIRM", createdAt: at, userId: "friend" }], "author").confirmCount).toBe(2);
    const moved = tallyVotes([{ kind: "DISPUTE", createdAt: at, userId: "author" }], "author");
    expect(moved).toEqual({ confirmCount: 0, disputeCount: 1, lastVote: { kind: "DISPUTE", at: at.toISOString() } });
  });
  it("knapparna betyder motsatsen på en slutsåld rapport", () => {
    expect(voteLabelKey("SEEN", "CONFIRM")).toBe("voteStillThere");
    expect(voteLabelKey("SEEN", "DISPUTE")).toBe("voteGone");
    expect(voteLabelKey("SOLD_OUT", "CONFIRM")).toBe("voteStillSoldOut");
    expect(voteLabelKey("SOLD_OUT", "DISPUTE")).toBe("voteBackInStock");
    expect(voteLabelSv("SOLD_OUT", "DISPUTE")).toBe("finns igen");
  });
});
