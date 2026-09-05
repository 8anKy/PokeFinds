import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { FREE_PLAN_WATCHLIST_LIMIT } from "@/services/watchlist";

/**
 * Gratiskontots bevakningstak är ett PUBLICERAT tal.
 *
 * Det står i prissidans funktionslista och i startsidans FAQ, på båda språken,
 * som fri text utan någon koppling till konstanten. Sänkningen 10 → 5
 * (2026-08-06) rörde alltså fem ställen som inget verktyg kan para ihop — och
 * missas ett av dem säljer prissidan en gräns koden inte håller.
 *
 * Samma vaktmönster som `bulk-cap-sync.test.ts`: läs källan, jämför talen.
 * Trubbigt, men det fångar exakt den drift det finns till för.
 *
 * ⛔ Lös INTE detta genom att interpolera konstanten in i översättningarna.
 * Meningarna är olika på svenska och engelska och måste kunna formuleras fritt;
 * poängen är att någon TVINGAS läsa dem när talet ändras, inte att texten ska
 * bli generisk.
 */
function messages(locale: "sv" | "en"): Record<string, any> {
  return JSON.parse(readFileSync(resolve(process.cwd(), `messages/${locale}.json`), "utf8"));
}

/** Alla heltal i en sträng — "upp till 5 produkter" → [5]. */
function numbersIn(text: string): number[] {
  return [...text.matchAll(/\d+/g)].map((m) => Number(m[0]));
}

describe("gratiskontots bevakningstak vs publicerad copy", () => {
  it("är ett rimligt tal — en nolla eller tappad siffra fångas", () => {
    expect(FREE_PLAN_WATCHLIST_LIMIT).toBeGreaterThanOrEqual(1);
    expect(FREE_PLAN_WATCHLIST_LIMIT).toBeLessThanOrEqual(100);
  });

  for (const locale of ["sv", "en"] as const) {
    describe(locale, () => {
      it("prissidans spec-blad nämner rätt tal på bevakningsraden", () => {
        // Första raden är bevakningsraden med flit — pausable-mekaniken lägger in
        // larm-raderna EFTER den (se lib/pricing-features.ts).
        const row = messages(locale).Pricing.specRows[0];
        expect(row.label, `Pricing.specRows[0] (${locale})`).toMatch(/watch|bevakning/i);
        expect(numbersIn(row.free)).toContain(FREE_PLAN_WATCHLIST_LIMIT);
      });

      it("prissidans Free-rad nämner rätt tal", () => {
        const desc: string = messages(locale).Pricing.freeRowDesc;
        expect(numbersIn(desc)).toContain(FREE_PLAN_WATCHLIST_LIMIT);
      });

      it("startsidans FAQ nämner rätt tal", () => {
        const answer: string = messages(locale).Home.faq.items[0].a;
        expect(numbersIn(answer)).toContain(FREE_PLAN_WATCHLIST_LIMIT);
      });

      it("nedgraderings-FAQ:n nämner rätt tal", () => {
        const answer: string = messages(locale).Pricing.faqItems[1].a;
        expect(numbersIn(answer)).toContain(FREE_PLAN_WATCHLIST_LIMIT);
      });

      it("klientens 'listan är full'-text nämner rätt tal", () => {
        const desc: string = messages(locale).Watch.limitReachedDesc;
        expect(numbersIn(desc)).toContain(FREE_PLAN_WATCHLIST_LIMIT);
      });
    });
  }
});
