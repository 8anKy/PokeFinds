/**
 * Pro-planernas tal (src/lib/pro-plans.ts) är PUBLICERADE som fri text — villkoren,
 * prissidan, Pro-kortet, Mer, inställningarna, skannerns tak och checkoutens samtycke.
 * Ändras ett tal ska det här testet tvinga någon att läsa varje mening.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  PRO_ANNUAL_UPFRONT_ORE,
  PRO_COMMIT_MONTHLY_ORE,
  PRO_COMMIT_MONTHS,
  PRO_COMMIT_TOTAL_ORE,
  PRO_MONTHLY_ORE,
  PRO_TRIAL_DAYS,
  TRIAL_REMINDER_DAYS_BEFORE,
  formatKr,
} from "@/lib/pro-plans";

const sv = JSON.parse(readFileSync("messages/sv.json", "utf8"));
const en = JSON.parse(readFileSync("messages/en.json", "utf8"));
const month = formatKr(PRO_MONTHLY_ORE);
const commit = formatKr(PRO_COMMIT_MONTHLY_ORE);
const total = formatKr(PRO_COMMIT_TOTAL_ORE);
const upfront = formatKr(PRO_ANNUAL_UPFRONT_ORE);

describe("Pro-planernas tal i copyn", () => {
  it("talen hänger ihop", () => {
    expect(PRO_COMMIT_TOTAL_ORE).toBe(PRO_COMMIT_MONTHLY_ORE * PRO_COMMIT_MONTHS);
    expect([month, commit, total]).toEqual(["59 kr", "39 kr", "468 kr"]);
  });

  it("villkoren nämner båda planerna, totalen, provperioden och påminnelsen", () => {
    const s = sv.Terms.s11Body as string;
    const e = en.Terms.s11Body as string;
    for (const n of [month, commit, total]) {
      expect(s).toContain(n);
      expect(e).toContain(n);
    }
    expect(s).toContain(`${PRO_TRIAL_DAYS} dagars gratis provperiod`);
    expect(e).toContain(`${PRO_TRIAL_DAYS}-day free trial`);
    expect(s).toContain(`${PRO_COMMIT_MONTHS} månaders bindningstid`);
    expect(s).toContain(TRIAL_REMINDER_DAYS_BEFORE === 2 ? "två dagar innan" : "!");
    expect(e).toContain(TRIAL_REMINDER_DAYS_BEFORE === 2 ? "two days before" : "!");
  });

  it("de korta prisraderna säger det lägsta priset", () => {
    for (const m of [sv, en]) {
      expect(m.Pricing.card.price).toBe(commit);
      for (const s of [m.Pricing.heroPrice, m.Pricing.card.aria, m.More.proPrice, m.Settings.planPrice, m.Scanner.limitCta]) {
        expect(s).toContain(commit);
      }
      expect(m.Pricing.card.cancel).toContain(month);
    }
  });

  it("det gamla priset står ingenstans där en kund läser det", () => {
    const visible = JSON.stringify([sv.Pricing, sv.Paywall, sv.More, sv.Settings, sv.Terms, sv.About, en.Pricing, en.Paywall, en.More, en.Settings, en.Terms, en.About]);
    expect(visible).not.toMatch(/\b49 kr/);
  });

  it("checkoutens samtycke och påminnelsemejlet har samma tal", () => {
    const checkout = readFileSync("src/app/api/billing/checkout/route.ts", "utf8");
    const mail = readFileSync("src/emails/templates.ts", "utf8");
    const push = readFileSync("src/services/trial-messages.ts", "utf8");
    for (const src of [checkout, mail, push]) {
      expect(src).toContain(`${commit}/mån`);
      expect(src).toContain(`${PRO_COMMIT_MONTHS} månader`);
      expect(src).toContain(total);
    }
    expect(checkout).toContain(`${PRO_TRIAL_DAYS} dagarna är gratis`);
  });

  it("apparnas förbetalda årspris står likadant i villkor, mejl och push", () => {
    // Apples regel: åtagandets total får inte understiga förbetalt.
    expect(PRO_ANNUAL_UPFRONT_ORE).toBeLessThanOrEqual(PRO_COMMIT_TOTAL_ORE);
    expect(sv.Terms.s11Body).toContain(`${upfront} direkt`);
    expect(sv.Terms.s11Body).toContain(`betalar du ${upfront} för 12 månader`);
    expect(en.Terms.s11Body).toContain(`${upfront} up front`);
    for (const f of ["src/emails/templates.ts", "src/services/trial-messages.ts"]) {
      expect(readFileSync(f, "utf8")).toContain(`${upfront} för 12 månader`);
    }
  });
});
