import { describe, expect, it } from "vitest";
import {
  classifySignupRows,
  GRACE_HOURS,
  type SignupVerificationRow,
} from "@/lib/signup-verification-audit";

const NOW = new Date("2026-08-15T12:00:00Z");

function row(overrides: Partial<SignupVerificationRow> = {}): SignupVerificationRow {
  return {
    email: "a@gmail.com",
    // Utgången för länge sedan om inget annat sägs.
    expiresAt: new Date(NOW.getTime() - 10 * 24 * 3600_000),
    attempts: 0,
    createdAt: new Date(NOW.getTime() - 10 * 24 * 3600_000),
    ...overrides,
  };
}

describe("classifySignupRows", () => {
  it("rör aldrig en kod som fortfarande gäller", () => {
    const r = classifySignupRows(
      [row({ expiresAt: new Date(NOW.getTime() + 5 * 60_000) })],
      new Set(),
      NOW
    );
    expect(r.active).toBe(1);
    expect(r.purgeable).toEqual([]);
  });

  it("håller kvar nyss utgångna rader under karensen", () => {
    // Den som skrev fel adress ska hinna komma tillbaka nästa morgon och se ett
    // begripligt fel, inte "koden finns inte" på en rad vi hann ta bort.
    const justExpired = new Date(NOW.getTime() - (GRACE_HOURS - 1) * 3600_000);
    const r = classifySignupRows([row({ expiresAt: justExpired })], new Set(), NOW);
    expect(r.withinGrace).toBe(1);
    expect(r.purgeable).toEqual([]);
  });

  it("städar rader som gått ut för längre sedan än karensen", () => {
    const longGone = new Date(NOW.getTime() - (GRACE_HOURS + 1) * 3600_000);
    const r = classifySignupRows([row({ email: "x@gmail.com", expiresAt: longGone })], new Set(), NOW);
    expect(r.purgeable).toEqual(["x@gmail.com"]);
  });

  it("⛔ en adress som redan är användare är ingen avhoppare", () => {
    // Raderingen i register-routen är nycklad på adressen som FAKTISKT användes,
    // så den som rättade en felstavad adress lämnar kvar väntrumsraden för den
    // gamla. Räknas den som "gav upp" ser tratten sämre ut än den är.
    const r = classifySignupRows(
      [row({ email: "kund@gmail.com", attempts: 2 })],
      new Set(["kund@gmail.com"]),
      NOW
    );
    expect(r.buckets.alreadyUser).toBe(1);
    expect(r.buckets.gaveUpTyping).toBe(0);
    expect(r.purgeable).toEqual(["kund@gmail.com"]);
  });

  it("skiljer på varför de inte kom igenom", () => {
    const r = classifySignupRows(
      [
        row({ email: "aldrig@gmail.com", attempts: 0 }),
        row({ email: "gavupp@gmail.com", attempts: 3 }),
        row({ email: "last@hotmail.se", attempts: 5 }),
        row({ email: "last2@hotmail.se", attempts: 9 }),
      ],
      new Set(),
      NOW
    );
    expect(r.buckets.neverTried).toBe(1);
    expect(r.buckets.gaveUpTyping).toBe(1);
    expect(r.buckets.lockedOut).toBe(2);
  });

  it("rapporterar äldsta raden och vanligaste domänerna", () => {
    const r = classifySignupRows(
      [
        row({ email: "a@gmail.com", createdAt: new Date("2026-08-01T00:00:00Z") }),
        row({ email: "b@gmail.com" }),
        row({ email: "c@hotmail.se" }),
      ],
      new Set(),
      NOW
    );
    expect(r.oldest?.toISOString()).toBe("2026-08-01T00:00:00.000Z");
    expect(r.topDomains[0]).toBe("gmail.com (2)");
  });

  it("klarar en tom tabell", () => {
    const r = classifySignupRows([], new Set(), NOW);
    expect(r).toMatchObject({ total: 0, active: 0, withinGrace: 0, oldest: null, topDomains: [] });
    expect(r.purgeable).toEqual([]);
  });
});
