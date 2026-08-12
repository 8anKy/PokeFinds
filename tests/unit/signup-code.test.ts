import { describe, expect, it } from "vitest";
import {
  evaluateSignupCode,
  generateSignupCode,
  hashSignupCode,
  SIGNUP_CODE_MAX_ATTEMPTS,
  SIGNUP_CODE_TTL_MS,
} from "@/lib/signup-code";

const NOW = new Date("2026-08-12T12:00:00Z");

function row(overrides: Partial<{ codeHash: string; expiresAt: Date; attempts: number }> = {}) {
  return {
    codeHash: hashSignupCode("123456"),
    expiresAt: new Date(NOW.getTime() + SIGNUP_CODE_TTL_MS),
    attempts: 0,
    ...overrides,
  };
}

describe("generateSignupCode", () => {
  it("ger alltid exakt 6 siffror, även med ledande nollor", () => {
    for (let i = 0; i < 200; i++) {
      expect(generateSignupCode()).toMatch(/^\d{6}$/);
    }
  });
});

describe("evaluateSignupCode", () => {
  it("godkänner rätt kod inom fönstret", () => {
    expect(evaluateSignupCode(row(), "123456", NOW)).toBe("ok");
  });

  it("avvisar fel kod som 'wrong'", () => {
    expect(evaluateSignupCode(row(), "654321", NOW)).toBe("wrong");
  });

  it("saknad rad = 'missing' (ingen kod är utfärdad)", () => {
    expect(evaluateSignupCode(null, "123456", NOW)).toBe("missing");
  });

  it("utgången kod = 'expired' ÄVEN när gissningen är rätt", () => {
    const expired = row({ expiresAt: new Date(NOW.getTime() - 1) });
    expect(evaluateSignupCode(expired, "123456", NOW)).toBe("expired");
  });

  it("exakt utgångsögonblick räknas som utgånget", () => {
    const atLimit = row({ expiresAt: NOW });
    expect(evaluateSignupCode(atLimit, "123456", NOW)).toBe("expired");
  });

  it("för många försök = 'locked' ÄVEN när gissningen är rätt — annars vore låsningen ingen låsning", () => {
    const locked = row({ attempts: SIGNUP_CODE_MAX_ATTEMPTS });
    expect(evaluateSignupCode(locked, "123456", NOW)).toBe("locked");
  });

  it("försök UNDER taket prövas fortfarande", () => {
    const nearLimit = row({ attempts: SIGNUP_CODE_MAX_ATTEMPTS - 1 });
    expect(evaluateSignupCode(nearLimit, "123456", NOW)).toBe("ok");
  });

  it("kod med ledande nollor round-trippar genom hash + dom", () => {
    const zeroPadded = row({ codeHash: hashSignupCode("004217") });
    expect(evaluateSignupCode(zeroPadded, "004217", NOW)).toBe("ok");
    expect(evaluateSignupCode(zeroPadded, "4217", NOW)).toBe("wrong");
  });
});
