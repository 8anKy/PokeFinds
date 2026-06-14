/**
 * Tester för src/lib/format.ts.
 * OBS: sv-SE-formatering använder hårda mellanslag (U+00A0 / U+202F)
 * som tusentalsavgränsare — därför testar vi med toContain/regex
 * istället för exakta strängjämförelser.
 */
import { describe, expect, it } from "vitest";
import { formatPercent, formatPrice, priceChangePercent } from "@/lib/format";

describe("formatPrice", () => {
  it("formaterar öre till hela kronor utan decimaler", () => {
    const result = formatPrice(150000); // 1 500,00 kr
    expect(result).toContain("kr");
    // 1 500 med valfri (hård) mellanslagsavgränsare
    expect(result).toMatch(/1\s?500/);
    expect(result).not.toContain(",");
  });

  it("visar decimaler när öresbeloppet inte är jämna kronor", () => {
    const result = formatPrice(12345); // 123,45 kr
    expect(result).toMatch(/123,45/);
    expect(result).toContain("kr");
  });

  it("formaterar noll", () => {
    expect(formatPrice(0)).toMatch(/^0\s?kr$/u);
  });

  it("returnerar tankstreck för null/undefined", () => {
    expect(formatPrice(null)).toBe("–");
    expect(formatPrice(undefined)).toBe("–");
  });

  it("respekterar annan valuta", () => {
    const result = formatPrice(100000, "EUR");
    expect(result).toMatch(/1\s?000/);
    expect(result).toContain("€");
  });
});

describe("formatPercent", () => {
  it("lägger till plustecken för positiva värden", () => {
    expect(formatPercent(5)).toBe("+5,0 %");
  });

  it("behåller minustecken för negativa värden", () => {
    expect(formatPercent(-3.2)).toBe("-3,2 %");
  });

  it("inget plustecken för noll", () => {
    expect(formatPercent(0)).toBe("0,0 %");
  });

  it("kan stänga av plustecken med signed=false", () => {
    expect(formatPercent(7.5, false)).toBe("7,5 %");
  });

  it("avrundar till en decimal med svenskt kommatecken", () => {
    expect(formatPercent(12.34)).toBe("+12,3 %");
  });
});

describe("priceChangePercent", () => {
  it("beräknar prisfall i procent", () => {
    expect(priceChangePercent(10000, 9000)).toBe(-10);
  });

  it("beräknar prisökning i procent", () => {
    expect(priceChangePercent(20000, 25000)).toBe(25);
  });

  it("returnerar 0 vid oförändrat pris", () => {
    expect(priceChangePercent(15000, 15000)).toBe(0);
  });

  it("skyddar mot division med noll", () => {
    expect(priceChangePercent(0, 5000)).toBe(0);
  });
});
