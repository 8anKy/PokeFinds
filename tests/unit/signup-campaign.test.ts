import { describe, it, expect } from "vitest";
import {
  campaignIsOpen,
  signupBonusUntil,
  DEFAULT_SIGNUP_BONUS_MONTHS,
} from "@/lib/signup-campaign";

const now = new Date("2026-08-20T12:00:00Z");

describe("campaignIsOpen", () => {
  it("är STÄNGD utan konfiguration — koden ska kunna deployas inert", () => {
    expect(campaignIsOpen({}, now)).toBe(false);
    expect(campaignIsOpen({ until: null }, now)).toBe(false);
    expect(campaignIsOpen({ until: "" }, now)).toBe(false);
    expect(campaignIsOpen({ until: "   " }, now)).toBe(false);
  });

  it("är stängd vid skräpvärde i stället för att gissa", () => {
    expect(campaignIsOpen({ until: "snart" }, now)).toBe(false);
    expect(campaignIsOpen({ until: "26/8" }, now)).toBe(false);
  });

  it("är öppen fram till och med sista dagen", () => {
    expect(campaignIsOpen({ until: "2026-08-26" }, now)).toBe(true);
    // Sista dagen räknas HELT — den som registrerar sig 23:58 hinner med.
    expect(campaignIsOpen({ until: "2026-08-20" }, new Date("2026-08-20T23:58:00Z"))).toBe(true);
  });

  it("är stängd dagen efter", () => {
    expect(campaignIsOpen({ until: "2026-08-19" }, now)).toBe(false);
  });
});

describe("signupBonusUntil", () => {
  it("ger null när kampanjen är stängd", () => {
    expect(signupBonusUntil({}, now)).toBeNull();
    expect(signupBonusUntil({ until: "2026-08-19" }, now)).toBeNull();
  });

  it("räknar från REGISTRERINGEN, inte från kampanjens slut", () => {
    // Den som kommer sista dagen ska få lika lång period som den som kom först —
    // annars är det samma erbjudande med olika värde beroende på tur.
    const tidig = signupBonusUntil({ until: "2026-08-26" }, new Date("2026-08-20T12:00:00Z"));
    const sen = signupBonusUntil({ until: "2026-08-26" }, new Date("2026-08-26T12:00:00Z"));
    expect(tidig?.toISOString()).toBe("2026-10-20T12:00:00.000Z");
    expect(sen?.toISOString()).toBe("2026-10-26T12:00:00.000Z");
  });

  it("ger två månader som standard", () => {
    expect(DEFAULT_SIGNUP_BONUS_MONTHS).toBe(2);
    const until = signupBonusUntil({ until: "2026-08-26" }, now);
    expect(until?.toISOString()).toBe("2026-10-20T12:00:00.000Z");
  });

  it("respekterar ett annat antal månader", () => {
    expect(signupBonusUntil({ until: "2026-08-26", months: "1" }, now)?.toISOString()).toBe(
      "2026-09-20T12:00:00.000Z"
    );
    expect(signupBonusUntil({ until: "2026-08-26", months: 3 }, now)?.toISOString()).toBe(
      "2026-11-20T12:00:00.000Z"
    );
  });

  it("faller tillbaka på två månader vid trasigt månadsvärde", () => {
    // ⛔ Ett tyst 0 hade sett påslaget ut men gett en gåva som gick ut direkt.
    for (const bad of ["", "noll", "0", "-3", null]) {
      const until = signupBonusUntil({ until: "2026-08-26", months: bad }, now);
      expect(until?.toISOString()).toBe("2026-10-20T12:00:00.000Z");
    }
  });

  it("taksätter orimliga värden", () => {
    const until = signupBonusUntil({ until: "2026-08-26", months: "999" }, now);
    expect(until?.toISOString()).toBe("2028-08-20T12:00:00.000Z"); // 24 månader
  });
});
