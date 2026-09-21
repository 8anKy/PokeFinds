import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  canCreatePortfolio,
  FREE_PORTFOLIO_LIMIT,
  normalizePortfolioName,
  PORTFOLIO_NAME_MAX,
  portfolioIdForWrite,
  portfolioItemWhere,
  portfolioOfItem,
  PRO_PORTFOLIO_LIMIT,
} from "@/lib/portfolio-limit";

/**
 * Pärmtaket (1 gratis / 5 Pro) är ett PUBLICERAT tal — det står i prissidans
 * spec-blad på båda språken. Samma vakt som watchlist-limit-copy-sync: läs
 * messages-filerna och jämför, så att en ändring av konstanten TVINGAR någon
 * att läsa copyn.
 */
function messages(locale: "sv" | "en"): Record<string, any> {
  return JSON.parse(readFileSync(resolve(process.cwd(), `messages/${locale}.json`), "utf8"));
}

describe("pärmtaket", () => {
  it("1 gratis, 5 Pro (ägarbeslut 2026-09-21)", () => {
    expect(FREE_PORTFOLIO_LIMIT).toBe(1);
    expect(PRO_PORTFOLIO_LIMIT).toBe(5);
  });

  it("dömer på antalet befintliga pärmar", () => {
    expect(canCreatePortfolio(0, false)).toBe(true);
    expect(canCreatePortfolio(1, false)).toBe(false);
    expect(canCreatePortfolio(4, true)).toBe(true);
    expect(canCreatePortfolio(5, true)).toBe(false);
    // En Pro som fallit till Free med sex pärmar: nekas NYA, behåller gamla.
    expect(canCreatePortfolio(6, false)).toBe(false);
  });

  for (const locale of ["sv", "en"] as const) {
    it(`prissidans spec-blad (${locale}) nämner samma tal på pärmraden`, () => {
      const rows: { label: string; free: string; pro: string }[] = messages(locale).Pricing.specRows;
      const row = rows.find((r) => /pärm|binder/i.test(r.label));
      expect(row, "pärmraden saknas i specRows").toBeDefined();
      expect(row!.free).toBe(String(FREE_PORTFOLIO_LIMIT));
      expect(row!.pro).toBe(String(PRO_PORTFOLIO_LIMIT));
    });
  }
});

describe("standardpärmen = null på posten", () => {
  const def = { id: "pf-default", isDefault: true };
  const other = { id: "pf-2", isDefault: false };

  it("översätter pärm → where och pärm → skrivvärde konsekvent", () => {
    expect(portfolioItemWhere(def)).toEqual({ portfolioId: null });
    expect(portfolioItemWhere(other)).toEqual({ portfolioId: "pf-2" });
    expect(portfolioIdForWrite(def)).toBeNull();
    expect(portfolioIdForWrite(other)).toBe("pf-2");
  });

  it("hittar postens pärm ur listan, null-poster till standardpärmen", () => {
    const list = [def, other];
    expect(portfolioOfItem(list, null)).toBe(def);
    expect(portfolioOfItem(list, "pf-2")).toBe(other);
    expect(portfolioOfItem(list, "pf-gone")).toBeUndefined();
  });
});

describe("pärmnamnet", () => {
  it("trimmar, slår ihop blanksteg och klipper vid taket", () => {
    expect(normalizePortfolioName("  Byteshögen  ")).toBe("Byteshögen");
    expect(normalizePortfolioName("Barnens   kort")).toBe("Barnens kort");
    expect(normalizePortfolioName("x".repeat(PORTFOLIO_NAME_MAX + 10))).toHaveLength(PORTFOLIO_NAME_MAX);
  });

  it("tomt eller bara blanksteg är inget namn", () => {
    expect(normalizePortfolioName("")).toBeNull();
    expect(normalizePortfolioName("   ")).toBeNull();
  });
});
