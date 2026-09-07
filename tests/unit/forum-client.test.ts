import { beforeEach, describe, expect, it } from "vitest";
import {
  applyPostToggles,
  mergeComments,
  recallOwnComments,
  recallPostToggle,
  rememberOwnComment,
  rememberPostToggle,
} from "@/lib/forum-client";
import type { CommentDto } from "@/services/community";

function comment(id: string, createdAt: string): CommentDto {
  return {
    id,
    content: id,
    createdAt,
    user: { id: "u1", name: "Ash", avatarUrl: null, reputationScore: 0 },
  };
}

/**
 * Vakten för "svaret/hjärtat försvann när man gick ut ur tråden och in igen":
 * trådsidan är ISR (300 s) och `/api/community/me` cachas 30 s i klienten, så
 * fliken måste minnas det den själv skrivit — utan en enda extra läsning.
 */
describe("forum-client", () => {
  beforeEach(() => {
    // Kartorna är modulglobala; nolla dem genom att skriva över det testen rör.
    for (const id of ["p1", "p2"]) rememberPostToggle(id, { liked: undefined, saved: undefined });
  });

  it("minns egna svar per tråd och håller isär trådarna", () => {
    rememberOwnComment("p1", comment("c1", "2026-09-07T10:00:00.000Z"));
    expect(recallOwnComments("p1").map((c) => c.id)).toEqual(["c1"]);
    expect(recallOwnComments("p2")).toEqual([]);
  });

  it("minns aldrig en optimistisk rad — den byts mot serverns", () => {
    rememberOwnComment("p2", comment("temp-123", "2026-09-07T10:00:00.000Z"));
    expect(recallOwnComments("p2")).toEqual([]);
  });

  it("slår ihop utan dubbletter och i tidsordning; serverns rad vinner", () => {
    const own = [comment("c2", "2026-09-07T10:01:00.000Z")];
    const server = [
      comment("c1", "2026-09-07T10:00:00.000Z"),
      { ...comment("c2", "2026-09-07T10:01:00.000Z"), content: "från servern" },
    ];
    const merged = mergeComments(own, server);
    expect(merged.map((c) => c.id)).toEqual(["c1", "c2"]);
    expect(merged[1].content).toBe("från servern");
  });

  it("lägger egna växlingar ovanpå serverns svar — åt båda hållen", () => {
    rememberPostToggle("p1", { liked: true, likeCount: 4 });
    rememberPostToggle("p2", { saved: false });
    const state = applyPostToggles({ likedIds: [], savedIds: ["p2"] });
    expect(state.likedIds).toEqual(["p1"]);
    expect(state.savedIds).toEqual([]);
    expect(recallPostToggle("p1").likeCount).toBe(4);
  });
});
