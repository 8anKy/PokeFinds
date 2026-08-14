import { afterEach, describe, expect, it } from "vitest";
import {
  MODEL_PRICES,
  costMicroUsd,
  microUsdToOre,
  priceForModel,
  resetPriceOverridesCache,
} from "@/lib/ai-pricing";

/**
 * Kostnad-per-användare i adminpanelen bygger helt på den här modulen. Ett fel
 * här ger inte ett undantag utan ett TROVÄRDIGT MEN FEL BELOPP — samma klass av
 * bugg som ett felaktigt kortpris, och lika svår att upptäcka i efterhand.
 *
 * Det testerna vaktar är därför i tur och ordning:
 *   1. att "vet inte" aldrig blir "noll kronor",
 *   2. att aritmetiken stämmer mot ett handräknat facit,
 *   3. att modellerna koden faktiskt anropar har ett pris.
 */
describe("ai-pricing", () => {
  afterEach(() => {
    delete process.env.AI_PRICE_OVERRIDES;
    resetPriceOverridesCache();
  });

  describe("costMicroUsd — null betyder OMÄTT, aldrig gratis", () => {
    it("returnerar null för en okänd modell", () => {
      expect(
        costMicroUsd("nagon-framtida-modell", { inputTokens: 1000, outputTokens: 100 })
      ).toBeNull();
    });

    it("returnerar null när tokentalen saknas", () => {
      expect(costMicroUsd("claude-haiku-4-5", null)).toBeNull();
      expect(costMicroUsd("claude-haiku-4-5", {})).toBeNull();
      expect(costMicroUsd("claude-haiku-4-5", { inputTokens: 10 })).toBeNull();
    });

    it("returnerar null för modellnamn som saknas helt", () => {
      expect(costMicroUsd(null, { inputTokens: 10, outputTokens: 1 })).toBeNull();
      expect(costMicroUsd("", { inputTokens: 10, outputTokens: 1 })).toBeNull();
      expect(costMicroUsd("   ", { inputTokens: 10, outputTokens: 1 })).toBeNull();
    });

    it("avvisar negativa och icke-ändliga tokental i stället för att räkna på dem", () => {
      expect(costMicroUsd("claude-haiku-4-5", { inputTokens: -5, outputTokens: 1 })).toBeNull();
      expect(
        costMicroUsd("claude-haiku-4-5", { inputTokens: Number.NaN, outputTokens: 1 })
      ).toBeNull();
    });

    it("0 tokens är 0 — ett mätt värde, inte ett saknat", () => {
      expect(costMicroUsd("claude-haiku-4-5", { inputTokens: 0, outputTokens: 0 })).toBe(0);
    });
  });

  describe("costMicroUsd — aritmetik mot handräknat facit", () => {
    it("räknar Haiku 4.5 rätt (1 $/5 $ per MTok)", () => {
      // 1 000 000 in = 1,00 $ = 1 000 000 µ$; 200 000 ut = 1,00 $.
      expect(
        costMicroUsd("claude-haiku-4-5", { inputTokens: 1_000_000, outputTokens: 200_000 })
      ).toBe(2_000_000);
    });

    it("räknar ett realistiskt skanningsanrop (~0,0023 $)", () => {
      // Uppmätt storleksordning i CLAUDE.md: ~3 700 in / ~60 ut på Haiku.
      // Facit för hand: 3 700/1e6 × 1 $ = 0,0037 $, 60/1e6 × 5 $ = 0,0003 $
      //               → 0,0040 $ = 4 000 µ$.
      expect(
        costMicroUsd("claude-haiku-4-5", { inputTokens: 3_700, outputTokens: 60 })
      ).toBe(4_000);
    });

    it("räknar Gemini 3.1 Flash-Lite rätt (0,25 $/1,50 $ per MTok)", () => {
      expect(
        costMicroUsd("gemini-3.1-flash-lite", {
          inputTokens: 4_000_000,
          outputTokens: 1_000_000,
        })
      ).toBe(1_000_000 + 1_500_000);
    });
  });

  describe("priceForModel", () => {
    it("matchar datumsuffixade snapshots via prefix", () => {
      // Leverantörerna lägger till datum; priset ska inte försvinna då.
      expect(priceForModel("claude-haiku-4-5-20260101")).toEqual(
        MODEL_PRICES["claude-haiku-4-5"]
      );
    });

    it("väljer den LÄNGSTA prefixträffen när flera matchar", () => {
      // "claude-sonnet-5" respektive "claude-sonnet-4-6" får inte förväxlas.
      expect(priceForModel("claude-sonnet-4-6-20251114")).toEqual(
        MODEL_PRICES["claude-sonnet-4-6"]
      );
    });

    it("matchar inte på ett kort prefix", () => {
      expect(priceForModel("claude")).toBeNull();
    });
  });

  describe("AI_PRICE_OVERRIDES", () => {
    it("ersätter ett publicerat pris (t.ex. Sonnet 5:s introduktionspris)", () => {
      process.env.AI_PRICE_OVERRIDES = JSON.stringify({
        "claude-sonnet-5": { inputPerMTok: 2, outputPerMTok: 10 },
      });
      resetPriceOverridesCache();
      expect(priceForModel("claude-sonnet-5")).toEqual({
        inputPerMTok: 2,
        outputPerMTok: 10,
      });
    });

    it("ignorerar trasig JSON i stället för att sänka adminpanelen", () => {
      process.env.AI_PRICE_OVERRIDES = "{ inte json";
      resetPriceOverridesCache();
      expect(priceForModel("claude-haiku-4-5")).toEqual(MODEL_PRICES["claude-haiku-4-5"]);
    });

    it("ignorerar poster med ogiltiga värden", () => {
      process.env.AI_PRICE_OVERRIDES = JSON.stringify({
        "claude-haiku-4-5": { inputPerMTok: "gratis", outputPerMTok: -1 },
      });
      resetPriceOverridesCache();
      expect(priceForModel("claude-haiku-4-5")).toEqual(MODEL_PRICES["claude-haiku-4-5"]);
    });
  });

  describe("microUsdToOre", () => {
    it("konverterar med den kurs som skickas in", () => {
      // 2 000 000 µ$ = 2,00 $ × 10,50 kr = 21,00 kr = 2 100 öre.
      expect(microUsdToOre(2_000_000, 1050)).toBe(2_100);
    });

    it("avrundar små belopp till hela öre", () => {
      // 4 000 µ$ = 0,004 $ × 10,50 = 0,042 kr ≈ 4 öre.
      expect(microUsdToOre(4_000, 1050)).toBe(4);
    });
  });

  describe("prislistan täcker modellerna koden faktiskt anropar", () => {
    /**
     * ⛔ Defaultmodellerna står som strängliteraler i getOcrAdapter() och
     * modelForTier(). Byter någon default utan att lägga till priset blir varje
     * anrop OMÄTT — kostnadsvyn slutar tyst att räkna, och det syns bara som att
     * "omätta" börjar växa. Listan här är de defaultvärden som gäller i dag.
     */
    const DEFAULTS = [
      "claude-haiku-4-5", // SCANNER_MODEL
      "claude-sonnet-5", // SCANNER_MODEL_PRECISE
      "gemini-3.1-flash-lite", // SCANNER_MODEL (gemini) + GRADING_MODEL_FREE_GEMINI
      "gemini-3.6-flash", // GRADING_MODEL_PREMIUM_GEMINI
      "claude-sonnet-4-6", // GRADING_MODEL_PREMIUM
    ];

    it.each(DEFAULTS)("har ett pris för %s", (model) => {
      expect(priceForModel(model)).not.toBeNull();
    });
  });
});
