import { readdirSync, readFileSync, statSync } from "node:fs";
import { resolve, join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * ENTITLEMENT-GRINDAR FÅR ALDRIG LÄSA PLANEN UR SESSIONSTOKEN.
 *
 * `requireUser()` returnerar sessionens användare, och sessionstoken läser bara
 * om planen ur databasen var TOKEN_REFRESH_MS (30 min) — eller när klienten
 * råkar kalla `session.update()`. RevenueCat-webhooken skriver planTier=PREMIUM
 * i DATABASEN, så en route som grindar på token:en säger "gratis" i upp till en
 * halvtimme efter att kunden betalat.
 *
 * MÄTT I DRIFT 2026-08-09 (sandbox-köp via TestFlight): /priser visade "Din
 * nuvarande plan ✓" (den läser DB via /api/users/me) medan skannern i SAMMA
 * minut sa "GRATIS · 30 skanningar kvar" (den läste token:en). Skanner, bulk,
 * gradering, bevakningstak och set-bevakning var alla döda efter betalning,
 * utan att något felade. En Apple-granskare gör exakt det köpet och exakt det
 * testet — tyst fel här är ett avslag.
 *
 * Regeln: en route-fil som frågar `effectivePlanTier(user)` eller `isPro(user)`
 * MÅSTE också hämta användaren med `requireEntitledUser()` (färsk DB-läsning).
 *
 * ⛔ Undantaget är `/api/users/me`, som läser hela användarraden ur DB själv och
 * aldrig grindar något — den ÄR färsk källa, inte en konsument av en.
 */

const API_ROOT = resolve(process.cwd(), "src/app/api");

/** Rutter som med flit räknar isPro på en rad de själva hämtat ur databasen. */
const SELF_FRESH = new Set(["users/me/route.ts"]);

function routeFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) routeFiles(full, acc);
    else if (entry === "route.ts") acc.push(full);
  }
  return acc;
}

describe("entitlement-grindar läser färsk plan", () => {
  const files = routeFiles(API_ROOT);

  it("hittar rutter att granska (annars är testet meningslöst)", () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it("varje plan-grindad route använder requireEntitledUser", () => {
    const offenders: string[] = [];

    for (const file of files) {
      const rel = file.slice(API_ROOT.length + 1).replace(/\\/g, "/");
      if (SELF_FRESH.has(rel)) continue;
      const src = readFileSync(file, "utf8");

      // Grindar planen på sessionsobjektet?
      const gates = /effectivePlanTier\(\s*user\s*\)|isPro\(\s*user\s*\)/.test(src);
      if (!gates) continue;

      // ...då måste användaren komma från den färska vägen.
      if (!src.includes("requireEntitledUser()")) offenders.push(rel);
    }

    expect(
      offenders,
      `Dessa rutter grindar på planen men hämtar användaren med requireUser() ` +
        `(sessionstoken, upp till 30 min gammal). Byt till requireEntitledUser(): ` +
        offenders.join(", ")
    ).toEqual([]);
  });

  it("requireEntitledUser väljer ALLA fyra plan-fälten", () => {
    // Ett ovalt fält blir `undefined` i isPro() → vakten failar ÖPPET och en
    // betalande kund ses som gratisanvändare. Samma familj som stripeProUntil
    // (2026-08-06) och variantLabel (2026-07-28).
    const src = readFileSync(resolve(process.cwd(), "src/lib/auth.ts"), "utf8");
    const fn = src.slice(src.indexOf("export async function requireEntitledUser"));
    const select = fn.slice(fn.indexOf("select:"), fn.indexOf("}", fn.indexOf("select:")));
    for (const field of ["planTier", "role", "bonusProUntil", "stripeProUntil"]) {
      expect(select, `requireEntitledUser måste välja ${field}`).toContain(field);
    }
  });
});
