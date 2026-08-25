/**
 * Vaktar att en hemlighetsrotation INTE dödar avregistreringslänkar som redan
 * ligger i folks inkorgar. Tokens har med flit ingen utgångstid, så utan
 * `UNSUBSCRIBE_SECRET_PREVIOUS` hade rotationen 2026-08-25 (NEXTAUTH_SECRET körde
 * `.env.example`-platshållaren i prod) tystat avanmälan för varje veckobrev som
 * någonsin skickats — tyst, och upptäckt först av någon som försökte säga nej.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createUnsubscribeToken,
  verifyUnsubscribeToken,
} from "@/lib/unsubscribe-token";

const ENV = ["UNSUBSCRIBE_SECRET", "UNSUBSCRIBE_SECRET_PREVIOUS", "NEXTAUTH_SECRET"] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV) saved[k] = process.env[k];
  for (const k of ENV) delete process.env[k];
});
afterEach(() => {
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("rotation av avregistreringshemligheten", () => {
  it("en token signerad med den GAMLA hemligheten verifierar via PREVIOUS", () => {
    process.env.UNSUBSCRIBE_SECRET = "gammal-hemlighet";
    const old = createUnsubscribeToken("cku123", "weekly");

    // Rotationen: ny hemlighet, den gamla flyttad till PREVIOUS.
    process.env.UNSUBSCRIBE_SECRET = "ny-hemlighet";
    process.env.UNSUBSCRIBE_SECRET_PREVIOUS = "gammal-hemlighet";

    expect(verifyUnsubscribeToken(old)).toEqual({ userId: "cku123", type: "weekly" });
  });

  it("nya tokens signeras med den NYA hemligheten, aldrig med PREVIOUS", () => {
    process.env.UNSUBSCRIBE_SECRET = "ny-hemlighet";
    process.env.UNSUBSCRIBE_SECRET_PREVIOUS = "gammal-hemlighet";
    const fresh = createUnsubscribeToken("cku123", "weekly");

    // Tas PREVIOUS bort ska den färska token fortfarande hålla.
    delete process.env.UNSUBSCRIBE_SECRET_PREVIOUS;
    expect(verifyUnsubscribeToken(fresh)).toEqual({ userId: "cku123", type: "weekly" });
  });

  it("utan PREVIOUS är den gamla token död (det är hela poängen med att sätta den)", () => {
    process.env.UNSUBSCRIBE_SECRET = "gammal-hemlighet";
    const old = createUnsubscribeToken("cku123", "weekly");
    process.env.UNSUBSCRIBE_SECRET = "ny-hemlighet";
    expect(verifyUnsubscribeToken(old)).toBeNull();
  });

  it("faller fortfarande tillbaka på NEXTAUTH_SECRET när egen variabel saknas", () => {
    process.env.NEXTAUTH_SECRET = "nextauth-hemlighet";
    const t = createUnsubscribeToken("cku123", "weekly");
    expect(verifyUnsubscribeToken(t)).toEqual({ userId: "cku123", type: "weekly" });
  });

  it("en förfalskad signatur nekas oavsett hur många nycklar som prövas", () => {
    process.env.UNSUBSCRIBE_SECRET = "ny-hemlighet";
    process.env.UNSUBSCRIBE_SECRET_PREVIOUS = "gammal-hemlighet";
    expect(verifyUnsubscribeToken("weekly.cku123.foppa")).toBeNull();
    expect(verifyUnsubscribeToken("weekly.cku123.")).toBeNull();
    expect(verifyUnsubscribeToken(null)).toBeNull();
  });

  it("utan någon hemlighet alls verifierar ingenting", () => {
    expect(verifyUnsubscribeToken("weekly.cku123.abc")).toBeNull();
  });
});
