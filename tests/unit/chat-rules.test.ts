import { describe, expect, it } from "vitest";
import {
  MESSAGE_MAX_CHARS,
  PREVIEW_CHARS,
  avatarInitial,
  conversationPath,
  dayLabelFor,
  isSameLocalDay,
  isUnread,
  mergeMessages,
  otherIdFromPairKey,
  pairKeyFor,
  previewOf,
  relativeLabelFor,
  threadPath,
  validateMessageBody,
} from "@/lib/chat-rules";

describe("pairKeyFor", () => {
  it("är symmetrisk — samma nyckel oavsett vem som startar", () => {
    expect(pairKeyFor("u2", "u1")).toBe("u1:u2");
    expect(pairKeyFor("u1", "u2")).toBe("u1:u2");
  });

  it("otherIdFromPairKey ger motparten, null för utomstående", () => {
    expect(otherIdFromPairKey("u1:u2", "u1")).toBe("u2");
    expect(otherIdFromPairKey("u1:u2", "u2")).toBe("u1");
    expect(otherIdFromPairKey("u1:u2", "u3")).toBeNull();
  });
});

describe("previewOf", () => {
  it("plattar radbrytningar och kapar med ellips", () => {
    expect(previewOf("hej\n\n  där  ")).toBe("hej där");
    const long = "a".repeat(200);
    const p = previewOf(long);
    expect(p.length).toBe(PREVIEW_CHARS);
    expect(p.endsWith("…")).toBe(true);
  });

  it("lämnar korta texter orörda", () => {
    expect(previewOf("Är kortet kvar?")).toBe("Är kortet kvar?");
  });
});

describe("validateMessageBody", () => {
  it("nekar tomt, blanksteg och icke-strängar", () => {
    expect(validateMessageBody("").ok).toBe(false);
    expect(validateMessageBody("   \n ").ok).toBe(false);
    expect(validateMessageBody(null).ok).toBe(false);
    expect(validateMessageBody(42).ok).toBe(false);
  });

  it("normaliserar CRLF, trimmar och slår ihop tomma rader", () => {
    const r = validateMessageBody("  hej\r\n\r\n\r\n\r\ndär \n");
    expect(r).toEqual({ ok: true, body: "hej\n\ndär" });
  });

  it("vaktar maxlängden EFTER trimning", () => {
    expect(validateMessageBody("x".repeat(MESSAGE_MAX_CHARS)).ok).toBe(true);
    expect(validateMessageBody("x".repeat(MESSAGE_MAX_CHARS + 1)).ok).toBe(false);
    expect(validateMessageBody("  " + "x".repeat(MESSAGE_MAX_CHARS) + "  ").ok).toBe(true);
  });
});

describe("isUnread", () => {
  const msg = { createdAt: "2026-09-03T10:00:00.000Z", senderId: "u2" };

  it("allt är oläst utan lastReadAt", () => {
    expect(isUnread(null, msg)).toBe(true);
    expect(isUnread(undefined, msg)).toBe(true);
  });

  it("jämför mot lastReadAt", () => {
    expect(isUnread("2026-09-03T09:59:59.000Z", msg)).toBe(true);
    expect(isUnread("2026-09-03T10:00:00.000Z", msg)).toBe(false);
    expect(isUnread(new Date("2026-09-03T11:00:00.000Z"), msg)).toBe(false);
  });

  it("egna meddelanden är aldrig olästa; raderat konto räknas som motpart", () => {
    expect(isUnread(null, msg, "u2")).toBe(false);
    expect(isUnread(null, { ...msg, senderId: null }, "u2")).toBe(true);
  });
});

describe("dagetiketter", () => {
  const now = new Date(2026, 8, 3, 15, 30); // lokal tid, 3 sep 2026

  it("idag / igår / datum", () => {
    expect(dayLabelFor(new Date(2026, 8, 3, 0, 5), now)).toEqual({ kind: "today" });
    expect(dayLabelFor(new Date(2026, 8, 2, 23, 55), now)).toEqual({ kind: "yesterday" });
    const old = new Date(2026, 7, 20, 12, 0);
    expect(dayLabelFor(old, now)).toEqual({ kind: "date", date: old });
  });

  it("isSameLocalDay går på kalenderdag, inte 24 h", () => {
    expect(isSameLocalDay(new Date(2026, 8, 3, 0, 0), new Date(2026, 8, 3, 23, 59))).toBe(true);
    expect(isSameLocalDay(new Date(2026, 8, 3, 23, 59), new Date(2026, 8, 4, 0, 0))).toBe(false);
  });
});

describe("relativeLabelFor", () => {
  const now = new Date("2026-09-03T12:00:00.000Z");

  it("nyss → minuter → timmar → dagar → datum", () => {
    expect(relativeLabelFor("2026-09-03T11:59:40.000Z", now)).toEqual({ kind: "now" });
    expect(relativeLabelFor("2026-09-03T11:45:00.000Z", now)).toEqual({ kind: "minutes", count: 15 });
    expect(relativeLabelFor("2026-09-03T09:00:00.000Z", now)).toEqual({ kind: "hours", count: 3 });
    expect(relativeLabelFor("2026-09-01T12:00:00.000Z", now)).toEqual({ kind: "days", count: 2 });
    const old = relativeLabelFor("2026-08-01T12:00:00.000Z", now);
    expect(old.kind).toBe("date");
  });
});

describe("mergeMessages", () => {
  const m = (id: string, t: string) => ({ id, createdAt: t });

  it("dedupar på id och sorterar på tid, sedan id", () => {
    const a = [m("m1", "2026-09-03T10:00:00.000Z"), m("m3", "2026-09-03T10:02:00.000Z")];
    const b = [
      m("m3", "2026-09-03T10:02:00.000Z"), // POST-svaret OCH strömmens kopia
      m("m2", "2026-09-03T10:01:00.000Z"),
      m("m0", "2026-09-03T10:00:00.000Z"), // samma sekund som m1 → id avgör
    ];
    expect(mergeMessages(a, b).map((x) => x.id)).toEqual(["m0", "m1", "m2", "m3"]);
  });

  it("senare version av samma id vinner", () => {
    const merged = mergeMessages(
      [{ ...m("m1", "2026-09-03T10:00:00.000Z"), body: "gammal" }],
      [{ ...m("m1", "2026-09-03T10:00:00.000Z"), body: "ny" }]
    );
    expect(merged).toHaveLength(1);
    expect(merged[0].body).toBe("ny");
  });
});

describe("små hjälpare", () => {
  it("avatarInitial: versal första bokstav, '?' när namn saknas", () => {
    expect(avatarInitial("ash ketchum")).toBe("A");
    expect(avatarInitial("  ")).toBe("?");
    expect(avatarInitial(null)).toBe("?");
  });

  it("vägar", () => {
    expect(conversationPath("c1")).toBe("/meddelanden/c1");
    expect(threadPath("p1")).toBe("/forum/t/p1");
  });
});
