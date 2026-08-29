import { afterEach, describe, expect, it } from "vitest";
import {
  GEMINI_31_FLASH_LITE_BAND,
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
 *   3. att det KALIBRERADE priset ligger i sitt härledbara band och på rätt
 *      ände av det,
 *   4. att modellerna koden faktiskt anropar har ett pris.
 *
 * ⛔ **PUNKT 3 ÄR ETT BAND, ALDRIG EN RESIDUAL.** Ett test som säger "vi
 *    reproducerar fakturan inom X %" har alltid ett X som valdes efter att man
 *    sett svaret. Bandets ändar följer däremot av vad fakturan KAN se — och de
 *    två skälen till att den inte ser allt står i src/lib/ai-pricing.ts.
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

    it("räknar Gemini 3.1 Flash-Lite rätt (0,2136 $ in KALIBRERAT / 1,50 $ ut listpris)", () => {
      // ⛔ INPRISET ÄR INTE LISTPRISET (0,25) — det är löst ur den enda faktura vi
      // läst. Testet vaktar aritmetiken: 4 MTok × 0,2136 = 0,8544 $.
      expect(
        costMicroUsd("gemini-3.1-flash-lite", {
          inputTokens: 4_000_000,
          outputTokens: 1_000_000,
        })
      ).toBe(854_400 + 1_500_000);
    });
  });

  /**
   * ⛔ **KONTRAKTET ÄR BANDET, ALDRIG EN RESIDUAL** (omskrivet 2026-08-29).
   *
   * Det förra testet hette "KALIBRERINGEN REPRODUCERAR FAKTURAN inom 3 %" och var
   * FITTAT MOT SVARET: den faktiska residualen var 2,726 % mot en tröskel på 3 %.
   * En tröskel som väljs efter att man sett talet vaktar ingenting — den hade
   * dessutom brutits av varje legitim justering INOM det band filen själv pekar
   * ut, och passerats av vad som helst strax under.
   *
   * Fakturan ger inte en punkt utan ett BAND, av två skäl som står utskrivna i
   * `src/lib/ai-pricing.ts`: utpriset är osynligt för fakturan (avvägningskurva),
   * och nämnaren är bevisligen ofullständig (29 odiagnostiserade skanningar i
   * fakturafönstret, mätt mot prod 2026-08-29). Det testerna här vaktar är
   * DOKTRINEN: inpriset ligger i bandet och på dess ÖVRE ände, utpriset är kvar
   * på listpris.
   */
  describe("gemini-3.1-flash-lite — kalibreringens kontrakt", () => {
    // ⛔ IMPORTERAT, ALDRIG KOPIERAT. Låg bandet som literaler här kunde priset
    // och dess vakt driva isär tyst — samma tvåkopiors-fälla som ART_TRUST_* i
    // mätskriptet och den andra prislistan i scanner-telemetry.ts.
    const { low: BAND_LOW, high: BAND_HIGH } = GEMINI_31_FLASH_LITE_BAND;

    it("inpriset ligger i det härledbara bandet $0,159–$0,2136", () => {
      const p = MODEL_PRICES["gemini-3.1-flash-lite"];
      // ⛔ Övre gränsen är INTE kosmetisk: den fäller både listpriset (0,25,
      // +15,4 % mot fakturan) och det påslag på 0,22 som stod här till
      // 2026-08-29 — motiverat med ett "band" 0,2135–0,2243 som inte finns,
      // eftersom 0,2243 bara gäller ihop med utpriset 0,80.
      expect(p.inputPerMTok).toBeLessThanOrEqual(BAND_HIGH);
      expect(p.inputPerMTok).toBeGreaterThan(BAND_LOW);
    });

    it("och på bandets ÖVRE ände — hellre överskatta än underskatta", () => {
      // Varje oräknat anrop drar det sanna inpriset NEDÅT, så övre änden är den
      // enda punkten som går att HÄRLEDA i stället för att väljas. Sjunker talet
      // in mot mitten är det någon som gissat hur de 29 raderna fördelade sig.
      const p = MODEL_PRICES["gemini-3.1-flash-lite"];
      expect(p.inputPerMTok).toBeGreaterThan((BAND_LOW + BAND_HIGH) / 2);
    });

    it("utpriset är LISTPRIS och kalibreras aldrig — fakturan kan inte se det", () => {
      // Utdelen är 9,7 % av notan, så $0,80 och $1,50 går inte att skilja åt ur
      // fakturan. ⛔ Den gamla kalibreringen (0,20/0,80) föll på just det här:
      // dess INPRIS ligger i bandet ovan, så bara utpriset avslöjar paret.
      expect(MODEL_PRICES["gemini-3.1-flash-lite"].outputPerMTok).toBe(1.5);
    });

    it("bandets övre ände ÄR den fakturakonsistenta punkten (uträkningen går att reproducera)", () => {
      // Googles konsol 2026-08-02: 0,82 kr mot 362 353 in / 5 565 ut.
      // ⚠️ 9,5651 är ECB:s USD/SEK 2026-07-31 (verifierad mot Frankfurter
      // 2026-08-29) — men 0,82 kr är Googles EGEN SEK-omräkning, och vilken kurs
      // de använde står ingenstans. Kursen är alltså ett ANTAGANDE, och testet
      // vaktar därför bara att UTRÄKNINGEN i kommentaren stämmer, aldrig att
      // kursen är den rätta.
      const invoiceUsd = 0.82 / 9.5651;
      const solvedIn = (invoiceUsd - (5_565 * 1.5) / 1e6) / (362_353 / 1e6);
      expect(solvedIn).toBeCloseTo(BAND_HIGH, 3);
    });
  });

  describe("gemini-3.5-flash — dominansen, inte talen", () => {
    it("prissätts aldrig BILLIGARE än 3.6", () => {
      // ⛔ BÅDA talen är HÄRLEDDA, aldrig avlästa: 9,375 = 7,5 / 0,8 ur
      // leverantörens "20 % billigare ut", och docs/SCANNER.md bär samma
      // uträkning skriven en andra gång — inte en oberoende avläsning.
      // MÄTT mot prod 2026-08-29: gemini-3.5-flash har 0 rader i ScannerJob
      // (costModel) OCH 0 i GradingJob (modelUsed), så ingen faktura har någonsin
      // kunnat rätta dem.
      //
      // Kontraktet är därför inte TALEN utan RELATIONEN: koden motiverar att
      // SCANNER_MODEL_PRECISE pekar på 3.6 med att 3.5 är "strikt dominerad".
      // Blir 3.5 billigare i tabellen är den motiveringen en lögn.
      // ⛔ `>=`, inte `toBe`/`>`: ett exakt lås mellan två aldrig avlästa tal
      //    bryts av varje legitim avläsning som råkar ge en annan nivå — och då
      //    är det talen som ska in, inte testet som ska bråka.
      const a = MODEL_PRICES["gemini-3.5-flash"];
      const b = MODEL_PRICES["gemini-3.6-flash"];
      expect(a.inputPerMTok).toBeGreaterThanOrEqual(b.inputPerMTok);
      expect(a.outputPerMTok).toBeGreaterThanOrEqual(b.outputPerMTok);
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
