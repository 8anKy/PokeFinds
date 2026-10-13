import { describe, expect, it } from "vitest";
import {
  MAX_TICKETS,
  TICKETS,
  computeTickets,
  giveawayConfig,
  giveawayPhase,
  normalizeHandle,
} from "@/lib/giveaway";
import { drawWinners } from "@/lib/giveaway-draw";
import en from "../../messages/en.json";
import sv from "../../messages/sv.json";

describe("computeTickets", () => {
  it("ger inget utan anmälan för kontot", () => {
    expect(computeTickets({ joined: false, scannedCards: 0, qualifiedInvites: 0, hasRestockAlert: false }).total).toBe(0);
  });

  it("kapar skanningar och inbjudningar", () => {
    const t = computeTickets({ joined: true, scannedCards: 500, qualifiedInvites: 40, hasRestockAlert: true });
    expect(t).toEqual({ account: 5, scans: 100, invites: 100, restock: 5, total: 210 });
    expect(t.total).toBe(MAX_TICKETS);
  });

  it("räknar en lott per kort och tio per vän", () => {
    const t = computeTickets({ joined: true, scannedCards: 7, qualifiedInvites: 2, hasRestockAlert: false });
    expect(t.total).toBe(TICKETS.account + 7 + 20);
  });
});

describe("giveawayPhase", () => {
  const cfg = giveawayConfig({
    GIVEAWAY_STARTS_AT: "2026-10-14T00:00:00+02:00",
    GIVEAWAY_CLOSES_AT: "2026-11-15T23:59:59+01:00",
  });
  it("väntar, pågår, är avslutad", () => {
    expect(giveawayPhase(cfg, new Date("2026-10-13T12:00:00Z"))).toBe("upcoming");
    expect(giveawayPhase(cfg, new Date("2026-10-20T12:00:00Z"))).toBe("open");
    expect(giveawayPhase(cfg, new Date("2026-11-16T00:00:00Z"))).toBe("closed");
  });
  it("env kan avsluta i förtid, ogiltigt värde faller tillbaka", () => {
    const early = giveawayConfig({ GIVEAWAY_CLOSES_AT: "2026-10-30T20:00:00+01:00" });
    expect(giveawayPhase(early, new Date("2026-11-01T00:00:00Z"))).toBe("closed");
    expect(giveawayConfig({ GIVEAWAY_CLOSES_AT: "inte ett datum" }).closesAt.toISOString()).toBe(
      "2026-11-15T22:59:59.000Z"
    );
  });
});

describe("normalizeHandle", () => {
  it.each([
    ["@Scoutr.se", "scoutr.se"],
    ["https://www.tiktok.com/@kort_samlare?lang=sv", "kort_samlare"],
    ["instagram.com/samlaren/", "samlaren"],
    ["  pokefan99 ", "pokefan99"],
  ])("%s → %s", (raw, want) => expect(normalizeHandle(raw)).toBe(want));
  it.each(["", "@", "a", "namn med mellanslag", "x".repeat(31)])("ogiltigt: %s", (raw) =>
    expect(normalizeHandle(raw)).toBeNull()
  );
});

describe("drawWinners", () => {
  const entries = [
    { id: "c", tickets: 10 },
    { id: "a", tickets: 1 },
    { id: "b", tickets: 0 },
    { id: "d", tickets: 50 },
  ];
  it("är deterministisk och oberoende av ordningen", () => {
    const one = drawWinners(entries, "seed", 3).map((w) => w.id);
    const two = drawWinners([...entries].reverse(), "seed", 3).map((w) => w.id);
    expect(one).toEqual(two);
  });
  it("drar ingen två gånger och aldrig någon utan lotter", () => {
    const ids = drawWinners(entries, "x", 10).map((w) => w.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).not.toContain("b");
    expect(ids).toHaveLength(3);
  });
  it("viktar efter lotter", () => {
    let d = 0;
    for (let i = 0; i < 2000; i++) if (drawWinners(entries, `s${i}`, 1)[0].id === "d") d++;
    // d har 50 av 61 lotter ≈ 82 %
    expect(d / 2000).toBeGreaterThan(0.77);
    expect(d / 2000).toBeLessThan(0.87);
  });
});

describe("copyn följer modellen", () => {
  it("båda språken har samma nycklar", () => {
    expect(Object.keys(en.Giveaway).sort()).toEqual(Object.keys(sv.Giveaway).sort());
    expect(en.Giveaway.rulesList).toHaveLength(sv.Giveaway.rulesList.length);
  });
  it("reglerna nämner taken", () => {
    const rules = sv.Giveaway.rulesList.join(" ");
    expect(rules).toContain(`max ${TICKETS.maxScans}`);
    expect(rules).toContain(`max ${TICKETS.maxInvites} vänner`);
  });
});
