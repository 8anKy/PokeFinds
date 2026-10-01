import { describe, it, expect } from "vitest";
import {
  INVITE_CODE_LENGTH,
  generateInviteCode,
  inviteCodeFromPath,
  inviteLinkLabel,
  normalizeInviteCode,
} from "@/lib/invite-link";

describe("personlig inbjudningslänk", () => {
  it("genererar koder utan förväxlingsbara tecken", () => {
    for (let i = 0; i < 500; i++) {
      const code = generateInviteCode();
      expect(code).toHaveLength(INVITE_CODE_LENGTH);
      expect(code).toMatch(/^[a-z2-9]+$/);
      expect(code).not.toMatch(/[01ilo]/);
      expect(normalizeInviteCode(code)).toBe(code);
    }
  });

  it("tål versaler men aldrig skräp", () => {
    expect(normalizeInviteCode(" K7M2PQX ")).toBe("k7m2pqx");
    expect(normalizeInviteCode("k7m2-pqx")).toBeNull();
    expect(normalizeInviteCode("abc")).toBeNull();
    expect(normalizeInviteCode("a".repeat(13))).toBeNull();
    expect(normalizeInviteCode(null)).toBeNull();
  });

  it("läser koden ur /i/<kod>, inget annat", () => {
    expect(inviteCodeFromPath("/i/k7m2pqx")).toBe("k7m2pqx");
    expect(inviteCodeFromPath("/i/k7m2pqx/")).toBe("k7m2pqx");
    expect(inviteCodeFromPath("/i/")).toBeNull();
    expect(inviteCodeFromPath("/i/k7m2pqx/mer")).toBeNull();
    expect(inviteCodeFromPath("/info")).toBeNull();
  });

  it("trycks utan protokoll på apex", () => {
    expect(inviteLinkLabel("k7m2pqx")).toBe("foilio.se/i/k7m2pqx");
  });
});
