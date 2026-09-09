import { describe, expect, it } from "vitest";
import { hidesBottomTabs } from "@/lib/immersive-routes";

describe("hidesBottomTabs", () => {
  it("döljer flikarna inne i ett samtal och en tråd", () => {
    expect(hidesBottomTabs("/meddelanden/abc123")).toBe(true);
    expect(hidesBottomTabs("/forum/t/abc123")).toBe(true);
    expect(hidesBottomTabs("/forum/t/abc123/")).toBe(true);
    expect(hidesBottomTabs("/meddelanden/abc123?fokus=1")).toBe(true);
  });

  it("behåller flikarna på listorna och de andra forumytorna", () => {
    for (const p of ["/meddelanden", "/meddelanden/", "/forum", "/forum/t", "/forum/g/handel", "/forum/ny", "/forum/sparade"]) {
      expect(hidesBottomTabs(p), p).toBe(false);
    }
    expect(hidesBottomTabs(null)).toBe(false);
  });
});
