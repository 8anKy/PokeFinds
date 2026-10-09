import { describe, expect, it } from "vitest";
import { hasUnseen, latestByOthers, latestPublished, nextSeen, sectionOf } from "@/lib/unseen";

describe("sectionOf", () => {
  it("community och nyheter, även under /en", () => {
    expect(sectionOf("/forum")).toBe("community");
    expect(sectionOf("/forum/t/abc")).toBe("community");
    expect(sectionOf("/community")).toBe("community");
    expect(sectionOf("/en/forum")).toBe("community");
    expect(sectionOf("/nyheter/nagot")).toBe("news");
    expect(sectionOf("/en/evenemang")).toBe("news");
  });

  it("inget annat — och inget prefix som bara liknar", () => {
    expect(sectionOf("/produkter")).toBeNull();
    expect(sectionOf("/forumet")).toBeNull();
    expect(sectionOf("/en")).toBeNull();
    expect(sectionOf(null)).toBeNull();
  });
});

describe("latestByOthers", () => {
  const rows = [
    { createdAt: new Date("2026-10-09T12:00:00Z"), userId: "me" },
    { createdAt: new Date("2026-10-09T11:00:00Z"), userId: "noah" },
  ];
  it("hoppar över mina egna inlägg", () => {
    expect(latestByOthers(rows, "me")).toBe("2026-10-09T11:00:00.000Z");
  });
  it("utloggad ser senaste inlägget", () => {
    expect(latestByOthers(rows, null)).toBe("2026-10-09T12:00:00.000Z");
  });
  it("bara egna ⇒ inget", () => {
    expect(latestByOthers([rows[0]], "me")).toBeNull();
  });
});

describe("latestPublished", () => {
  it("tar den senaste giltiga tiden", () => {
    expect(
      latestPublished([{ publishedAt: "2026-10-01T00:00:00Z" }, { publishedAt: "2026-10-05T00:00:00Z" }, { publishedAt: "trasig" }])
    ).toBe("2026-10-05T00:00:00.000Z");
    expect(latestPublished([])).toBeNull();
  });
});

describe("hasUnseen / nextSeen", () => {
  const at = "2026-10-09T12:00:00.000Z";
  it("ny enhet ser pricken när något finns", () => {
    expect(hasUnseen(at, 0)).toBe(true);
    expect(hasUnseen(null, 0)).toBe(false);
  });
  it("släcks när sektionen öppnats", () => {
    expect(hasUnseen(at, nextSeen(Date.parse(at) - 5_000, at))).toBe(false);
  });
  it("en klocka som går efter lämnar inte pricken tänd", () => {
    const slowClock = Date.parse(at) - 60 * 60_000;
    expect(nextSeen(slowClock, at)).toBe(Date.parse(at));
  });
  it("ett senare inlägg tänder den igen", () => {
    const seen = nextSeen(Date.parse(at), at);
    expect(hasUnseen("2026-10-09T12:05:00.000Z", seen)).toBe(true);
  });
});
