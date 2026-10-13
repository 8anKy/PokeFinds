import { describe, expect, it } from "vitest";
import { portfolioPushMessage } from "@/lib/portfolio-push";
import { parseNotificationSettings } from "@/lib/notification-settings";

const nbsp = (s: string) => s.replace(/ | /g, " ");

describe("portfolioPushMessage", () => {
  it("värde + veckans rörelse + största lyft", () => {
    const m = portfolioPushMessage({
      totalValueOre: 1_254_049,
      changeOre: 41_220,
      changePercent: 3.4,
      topMover: { name: "Charizard ex", percent: 18.25 },
    })!;
    expect(m.url).toBe("/samling");
    expect(nbsp(m.body)).toBe(
      "Din samling är värd 12 540 kr. +412 kr (+3,4 %) den här veckan. Störst lyft: Charizard ex +18,3 %."
    );
  });

  it("nedgång skrivs med minus, inte bara en siffra", () => {
    const m = portfolioPushMessage({ totalValueOre: 100_000, changeOre: -5_000, changePercent: -4.8, topMover: null })!;
    expect(nbsp(m.body)).toContain("−50 kr (−4,8 %) den här veckan.");
  });

  it("kronor utan procent när procenten inte är ärlig", () => {
    const m = portfolioPushMessage({ totalValueOre: 345_500, changeOre: -700, changePercent: null, topMover: null })!;
    expect(nbsp(m.body)).toBe("Din samling är värd 3 455 kr. −7 kr den här veckan.");
  });

  it("okänd förändring ⇒ bara värdet, aldrig 0 %", () => {
    const m = portfolioPushMessage({ totalValueOre: 100_000, changeOre: null, changePercent: null, topMover: null })!;
    expect(nbsp(m.body)).toBe("Din samling är värd 1 000 kr.");
  });

  it("under en krona i rörelse = oförändrad", () => {
    const m = portfolioPushMessage({ totalValueOre: 100_000, changeOre: 40, changePercent: 0, topMover: null })!;
    expect(m.body).toContain("Oförändrad mot förra veckan.");
  });

  it("0 kr är inget värde ⇒ ingen notis", () => {
    expect(portfolioPushMessage({ totalValueOre: 0, changeOre: null, changePercent: null, topMover: null })).toBeNull();
  });
});

describe("portfolioPush-inställningen", () => {
  it("är PÅ för ett konto som aldrig rört den (ingen migration)", () => {
    expect(parseNotificationSettings({ push: true }).portfolioPush).toBe(true);
    expect(parseNotificationSettings({ portfolioPush: false }).portfolioPush).toBe(false);
  });
});
