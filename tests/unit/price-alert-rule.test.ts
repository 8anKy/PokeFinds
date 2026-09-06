/**
 * Prislarmets dom (src/lib/price-alert-rule.ts) — de sex defekterna från 2026-08-26
 * uttryckta som regler:
 *   · målpris: ETT larm per gång målet nås (spärr), inte per rörelse under målet;
 *   · prisfall utan målpris: tydligt fall (5 % OCH 10 kr) från det pris användaren
 *     senast såg, aldrig över 60 % (fel data), nytt larm först vid ett nytt fall;
 *   · 0 kr är inget pris, åt båda hållen.
 */
import { afterEach, describe, expect, it } from "vitest";
import { judgePriceAlert, priceAlertPolicy, shouldRearm } from "@/lib/price-alert-rule";

const P = priceAlertPolicy();

describe("målpris-läget", () => {
  const w = { targetPrice: 200_000, priceAlertFiredOre: null };

  it("larmar när lägsta köpbara ligger på eller under målet", () => {
    expect(judgePriceAlert(w, 199_900, null, P)).toEqual({ fire: true, kind: "PRICE_TARGET" });
    expect(judgePriceAlert(w, 200_000, null, P)).toEqual({ fire: true, kind: "PRICE_TARGET" });
  });

  it("tiger över målet", () => {
    expect(judgePriceAlert(w, 200_100, null, P)).toEqual({ fire: false, reason: "above-target" });
  });

  it("SPÄRREN: har vi larmat för den här målnåddheten larmar en ytterligare sänkning inte igen", () => {
    // Defekt 2: Prismatic larmade 7 ggr på 30 dygn för varje litet fall under målet.
    const latched = { ...w, priceAlertFiredOre: 195_000 };
    expect(judgePriceAlert(latched, 190_000, null, P)).toEqual({ fire: false, reason: "latched" });
  });

  it("ett äldre PRISFALL-larm över målet spärrar inte målpris-larmet", () => {
    const older = { ...w, priceAlertFiredOre: 250_000 };
    expect(judgePriceAlert(older, 199_000, null, P)).toEqual({ fire: true, kind: "PRICE_TARGET" });
  });

  it("spärren släpps när priset åter ligger ÖVER målet — och först då", () => {
    const latched = { ...w, priceAlertFiredOre: 195_000 };
    expect(shouldRearm(latched, 200_000, P)).toBe(false);
    expect(shouldRearm(latched, 200_100, P)).toBe(true);
    expect(shouldRearm(latched, null, P)).toBe(false); // okänt pris släpper aldrig
  });

  it("utgångsläget spelar ingen roll i målpris-läget", () => {
    expect(judgePriceAlert(w, 150_000, 140_000, P).fire).toBe(true);
  });
});

describe("prisfall-läget (inget målpris)", () => {
  const w = { targetPrice: null, priceAlertFiredOre: null };

  it("larmar vid ett tydligt fall från priset användaren senast såg", () => {
    expect(judgePriceAlert(w, 90_000, 100_000, P)).toEqual({
      fire: true,
      kind: "PRICE_DROP",
      baselineOre: 100_000,
      dropOre: 10_000,
      percent: 10,
    });
  });

  it("utan utgångsläge (ingen spärr, inget tidigare pris) avstår den", () => {
    // Defekt 4: 18 bevakningar stod i det här läget — nu larmar de, men aldrig på
    // en gissning om vad priset var förut.
    expect(judgePriceAlert(w, 90_000, null, P)).toEqual({ fire: false, reason: "no-baseline" });
  });

  it("båda golven måste klaras: 5 % OCH 10 kr", () => {
    expect(judgePriceAlert(w, 3_800, 4_000, P)).toEqual({ fire: false, reason: "too-small" }); // 5 % men 2 kr
    expect(judgePriceAlert(w, 98_900, 100_000, P)).toEqual({ fire: false, reason: "too-small" }); // 11 kr men 1,1 %
    expect(judgePriceAlert(w, 94_000, 100_000, P).fire).toBe(true); // 6 % och 60 kr
  });

  it("ett fall över taket är troligare fel data än ett pris", () => {
    expect(judgePriceAlert(w, 30_000, 100_000, P)).toEqual({ fire: false, reason: "implausible" });
  });

  it("oförändrat eller högre pris larmar inte", () => {
    expect(judgePriceAlert(w, 100_000, 100_000, P)).toEqual({ fire: false, reason: "not-cheaper" });
    expect(judgePriceAlert(w, 110_000, 100_000, P)).toEqual({ fire: false, reason: "not-cheaper" });
  });

  it("efter ett larm är larmnivån utgångsläget — nästa larm kräver ett NYTT tydligt fall", () => {
    const latched = { ...w, priceAlertFiredOre: 90_000 };
    expect(judgePriceAlert(latched, 88_000, 100_000, P)).toEqual({ fire: false, reason: "too-small" });
    expect(judgePriceAlert(latched, 80_000, 100_000, P).fire).toBe(true);
  });

  it("spärren släpps när priset stigit 10 % över larmnivån", () => {
    const latched = { ...w, priceAlertFiredOre: 90_000 };
    expect(shouldRearm(latched, 98_000, P)).toBe(false);
    expect(shouldRearm(latched, 99_000, P)).toBe(true);
    expect(shouldRearm(w, 200_000, P)).toBe(false); // ingen spärr att släppa
  });
});

describe("0 kr är inget pris", () => {
  const w = { targetPrice: null, priceAlertFiredOre: null };
  it("nytt pris 0/null/negativt ⇒ no-price, aldrig ett larm om 'gratis'", () => {
    for (const v of [0, null, undefined, -5, Number.NaN]) {
      expect(judgePriceAlert(w, v, 100_000, P)).toEqual({ fire: false, reason: "no-price" });
      expect(judgePriceAlert({ targetPrice: 1, priceAlertFiredOre: null }, v, null, P)).toEqual({
        fire: false,
        reason: "no-price",
      });
    }
  });
  it("utgångsläge 0 räknas inte (hade gett ett oändligt fall)", () => {
    expect(judgePriceAlert(w, 50_000, 0, P)).toEqual({ fire: false, reason: "no-baseline" });
  });
});

describe("policyn läses ur env vid anropet", () => {
  const before = { ...process.env };
  afterEach(() => {
    for (const k of ["PRICE_ALERT_MIN_PERCENT", "PRICE_ALERT_MIN_ORE", "PRICE_ALERT_MAX_PERCENT", "PRICE_ALERT_REARM_PERCENT"]) {
      if (before[k] === undefined) delete process.env[k];
      else process.env[k] = before[k];
    }
  });

  it("defaultar till 5 % / 10 kr / 60 % / 10 %", () => {
    delete process.env.PRICE_ALERT_MIN_PERCENT;
    delete process.env.PRICE_ALERT_MIN_ORE;
    delete process.env.PRICE_ALERT_MAX_PERCENT;
    delete process.env.PRICE_ALERT_REARM_PERCENT;
    expect(priceAlertPolicy()).toEqual({ minPercent: 5, minOre: 1000, maxPercent: 60, rearmPercent: 10 });
  });

  it("ogiltiga värden faller tillbaka på defaulten", () => {
    process.env.PRICE_ALERT_MIN_PERCENT = "abc";
    process.env.PRICE_ALERT_MIN_ORE = "-3";
    expect(priceAlertPolicy().minPercent).toBe(5);
    expect(priceAlertPolicy().minOre).toBe(1000);
    process.env.PRICE_ALERT_MIN_PERCENT = "8";
    expect(priceAlertPolicy().minPercent).toBe(8);
  });
});
