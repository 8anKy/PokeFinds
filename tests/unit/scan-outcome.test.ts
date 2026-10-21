/**
 * En misslyckad skanning räknas inte mot kvoten (ägarbeslut 2026-10-21) — och
 * servern räknar på SAMMA regel som skannersidan ritar raden.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MIN_MATCH_CONF, scanCountsAgainstQuota, scanOutcome } from "@/lib/scan-outcome";

const c = (cardId: string) => ({ cardId });

describe("scanOutcome", () => {
  it("ingen kandidat ⇒ ingen träff, räknas inte", () => {
    const r = { candidates: [], confidence: 0.9 };
    expect(scanOutcome(r)).toBe("nomatch");
    expect(scanCountsAgainstQuota(r)).toBe(false);
  });

  it("kandidater under konfidensgolvet ⇒ ingen träff, räknas inte (räknades förut)", () => {
    const r = { candidates: [c("a"), c("b")], confidence: MIN_MATCH_CONF - 0.01 };
    expect(scanOutcome(r)).toBe("nomatch");
    expect(scanCountsAgainstQuota(r)).toBe(false);
  });

  it("oavgjort mellan olika kort ⇒ valsteget, räknas inte", () => {
    const r = { candidates: [c("a"), c("b")], confidence: 0.9, tied: true };
    expect(scanOutcome(r)).toBe("choose");
    expect(scanCountsAgainstQuota(r)).toBe(false);
  });

  it("oavgjort mellan tryckningar av SAMMA kort är en träff", () => {
    const r = { candidates: [c("a"), c("a")], confidence: 0.9, tied: true };
    expect(scanOutcome(r)).toBe("matched");
    expect(scanCountsAgainstQuota(r)).toBe(true);
  });

  it("säker träff räknas", () => {
    expect(scanCountsAgainstQuota({ candidates: [c("a")], confidence: MIN_MATCH_CONF })).toBe(true);
  });
});

describe("identify-rutten bokför på regeln", () => {
  const route = readFileSync("src/app/api/scanner/identify/route.ts", "utf8");
  it("matched kommer ur scanCountsAgainstQuota, inte ur antalet kandidater", () => {
    expect(route).toMatch(/const matched = scanCountsAgainstQuota\(result\)/);
    expect(route).not.toMatch(/result\.candidates\.length > 0,/);
  });
});
