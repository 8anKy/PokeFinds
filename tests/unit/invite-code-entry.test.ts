import { describe, expect, it } from "vitest";
import { codeEntryRefusal, INVITE_CODE_ENTRY_DAYS } from "@/services/invites";

const day = 86_400_000;
const now = new Date("2026-11-01T12:00:00Z");
const me = { id: "erik", createdAt: new Date(now.getTime() - 2 * day) };
const anna = { id: "anna", createdAt: new Date(now.getTime() - 30 * day) };
const base = { now, me, alreadyInvited: false, inviter: anna, inviterWasInvitedByMe: false };

describe("codeEntryRefusal", () => {
  it("släpper igenom en väns kod de första dagarna", () => {
    expect(codeEntryRefusal(base)).toBeNull();
  });
  it("en inbjudan per konto", () => {
    expect(codeEntryRefusal({ ...base, alreadyInvited: true })).toBe("already");
  });
  it("bara de första dagarna", () => {
    const old = { ...me, createdAt: new Date(now.getTime() - (INVITE_CODE_ENTRY_DAYS + 1) * day) };
    expect(codeEntryRefusal({ ...base, me: old })).toBe("too-late");
  });
  it("okänd kod och egen kod", () => {
    expect(codeEntryRefusal({ ...base, inviter: null })).toBe("unknown");
    expect(codeEntryRefusal({ ...base, inviter: { ...me } })).toBe("own");
  });
  it("aldrig i en ring, och inbjudaren måste ha funnits före kontot", () => {
    expect(codeEntryRefusal({ ...base, inviterWasInvitedByMe: true })).toBe("not-allowed");
    const newer = { id: "bea", createdAt: new Date(now.getTime() - day) };
    expect(codeEntryRefusal({ ...base, inviter: newer })).toBe("not-allowed");
  });
});
