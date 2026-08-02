/**
 * Vinst/förlust per samlingspost + köppris-fältets tur och retur (öre ↔ kronor).
 * Ren aritmetik — ingen DB, ingen rendering. Själva inmatningstolken testas i
 * purchase-price.test.ts; här verifieras bara att redigeringsfältet förifylls med
 * något den tolken läser tillbaka till EXAKT samma öre.
 */
import { describe, expect, it } from "vitest";
import { parseKronorToOre } from "@/lib/purchase-price";
import {
  oreToKr,
  profitToneClass,
  rowProfit,
  type ProfitInput,
} from "@/app/[locale]/(app)/samling/profit";

function row(overrides: Partial<ProfitInput>): ProfitInput {
  return { quantity: 1, purchasePrice: null, estimatedValue: null, ...overrides };
}

describe("oreToKr", () => {
  it("blankt när köppris saknas — aldrig '0', som hade lästs som 'köpt gratis'", () => {
    expect(oreToKr(null)).toBe("");
    expect(oreToKr(0)).toBe("0");
  });

  it("skriver komma som decimaltecken och läses tillbaka utan tapp", () => {
    expect(oreToKr(1299)).toBe("12,99");
    for (const ore of [0, 1, 1299, 123450, 999999]) {
      expect(parseKronorToOre(oreToKr(ore))).toEqual({ kind: "ok", ore });
    }
  });
});

describe("rowProfit", () => {
  it("beloppet gäller HELA posten (per styck × antal), procenten per styck", () => {
    const p = rowProfit(row({ quantity: 3, purchasePrice: 10000, estimatedValue: 15000 }));
    expect(p).toEqual({ amount: 15000, percent: 50 });
  });

  it("förlust ger negativt belopp och negativ procent", () => {
    const p = rowProfit(row({ purchasePrice: 20000, estimatedValue: 5000 }));
    expect(p?.amount).toBe(-15000);
    expect(p?.percent).toBe(-75);
  });

  it("utan köppris finns ingen kostnadsbas → null", () => {
    expect(rowProfit(row({ estimatedValue: 50000 }))).toBeNull();
  });

  it("utan aktuellt värde går vinsten inte att räkna → null", () => {
    expect(rowProfit(row({ purchasePrice: 50000 }))).toBeNull();
  });

  it("köppris 0 ger belopp men ingen procent (ingen division med noll)", () => {
    const p = rowProfit(row({ purchasePrice: 0, estimatedValue: 9900 }));
    expect(p?.amount).toBe(9900);
    expect(p?.percent).toBeNull();
  });
});

describe("profitToneClass", () => {
  it("grönt upp, rött ner, dämpat vid noll", () => {
    expect(profitToneClass(1)).toBe("text-rise");
    expect(profitToneClass(-1)).toBe("text-fall");
    expect(profitToneClass(0)).toBe("text-ink-muted");
  });
});
