/**
 * Tester för graderingens LEVERANTÖRSNEUTRALA kontrakt och adapterval.
 *
 * Varför just de här två sakerna:
 *  1. `getGradingAdapter` är enda stället där GRADING_PROVIDER tolkas, och en
 *     tyst fallback till fel leverantör hade skrivit graderingar användaren
 *     sparar i sin samling. Okänd leverantör MÅSTE kasta.
 *  2. `GRADE_REQUIRED` härleds ur `GRADE_FIELDS`. Glider de isär blir cardName
 *     obligatoriskt igen — dvs modellen TVINGAS gissa ett kortnamn, vilket är
 *     precis vad fältet är markerat optional för att slippa.
 *
 * Ingen adapter anropas: konstruktorerna rör inget nätverk, och API-nycklarna
 * läses först i grade().
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ prisma: { gradingJob: {} } }));

import {
  DEFAULT_GRADING_LOCALE,
  GRADE_FIELDS,
  GRADE_REQUIRED,
  buildClosingInstruction,
  buildGradeResult,
  buildSystem,
  resolveGradingLocale,
} from "@/services/grading/contract";
import { getGradingAdapter } from "@/services/grading";

beforeEach(() => {
  delete process.env.GRADING_PROVIDER;
  delete process.env.GRADING_MODEL_FREE_GEMINI;
  delete process.env.GRADING_MODEL_PREMIUM_GEMINI;
});

describe("getGradingAdapter", () => {
  it("mock är standard när GRADING_PROVIDER saknas", () => {
    expect(getGradingAdapter("FREE").name).toBe("mock");
  });

  it("claude ger Claude-adaptern på båda planerna", () => {
    process.env.GRADING_PROVIDER = "claude";
    expect(getGradingAdapter("FREE").name).toBe("claude");
    expect(getGradingAdapter("PREMIUM").name).toBe("claude");
  });

  it("gemini ger Gemini-adaptern på båda planerna", () => {
    process.env.GRADING_PROVIDER = "gemini";
    expect(getGradingAdapter("FREE").name).toBe("gemini");
    expect(getGradingAdapter("PREMIUM").name).toBe("gemini");
  });

  it("okänd leverantör KASTAR — aldrig en tyst fallback", () => {
    process.env.GRADING_PROVIDER = "gemeni";
    expect(() => getGradingAdapter("FREE")).toThrowError();
  });
});

describe("modellval per leverantör", () => {
  // Modellnamnet är privat i adaptern, så det läses via det enda stället det
  // syns utåt: GradeResult.modelUsed. Mocken bryr sig inte om modellen, så
  // testet går via adapterns egna fält i stället — vi kontrollerar att Pro och
  // gratis får OLIKA modeller, inte vilka strängar de är (defaultet ska kunna
  // ändras utan att testet blir en andra sanningskälla).
  it("Pro och gratis får olika Gemini-modeller", () => {
    process.env.GRADING_PROVIDER = "gemini";
    process.env.GRADING_MODEL_FREE_GEMINI = "modell-gratis";
    process.env.GRADING_MODEL_PREMIUM_GEMINI = "modell-pro";
    const free = getGradingAdapter("FREE") as unknown as { model: string };
    const pro = getGradingAdapter("PREMIUM") as unknown as { model: string };
    expect(free.model).toBe("modell-gratis");
    expect(pro.model).toBe("modell-pro");
  });

  it("TOM STRÄNG räknas som osatt (Actions/Railway sätter oangivna vars till '')", () => {
    process.env.GRADING_PROVIDER = "gemini";
    process.env.GRADING_MODEL_FREE_GEMINI = "";
    const free = getGradingAdapter("FREE") as unknown as { model: string };
    expect(free.model).not.toBe("");
    expect(free.model).toContain("gemini-3");
  });
});

describe("fältspec ↔ required", () => {
  it("required är exakt de icke-optional fälten, i samma ordning", () => {
    expect(GRADE_REQUIRED).toEqual(
      GRADE_FIELDS.filter((f) => !f.optional).map((f) => f.name)
    );
  });

  it("varje required-namn finns i fältspecen", () => {
    const names = new Set(GRADE_FIELDS.map((f) => f.name));
    for (const r of GRADE_REQUIRED) expect(names.has(r)).toBe(true);
  });

  it("cardName är det ENDA valfria fältet — ett gissat kortnamn är värre än inget", () => {
    expect(GRADE_FIELDS.filter((f) => f.optional).map((f) => f.name)).toEqual([
      "cardName",
    ]);
    expect(GRADE_REQUIRED).not.toContain("cardName");
    expect(GRADE_REQUIRED).toHaveLength(7);
  });
});

describe("buildGradeResult", () => {
  it("klämmer delpoäng till 1–10 och avrundar helhetsgraden till en decimal", () => {
    const r = buildGradeResult(
      {
        centering: 99,
        corners: -3,
        edges: 8,
        surface: 7.5,
        overall: 8.47,
        confidence: 2,
        rationale: "  Fina hörn.  ",
      },
      "modell-x"
    );
    expect(r.subScores).toEqual({
      centering: 10,
      corners: 1,
      edges: 8,
      surface: 7.5,
    });
    expect(r.overall).toBe(8.5);
    expect(r.confidence).toBe(1);
    expect(r.rationale).toBe("Fina hörn.");
    expect(r.modelUsed).toBe("modell-x");
  });

  it("saknade/ogiltiga fält faller på mitten, aldrig på NaN", () => {
    const r = buildGradeResult({ centering: "åtta" }, "modell-x");
    expect(r.subScores.centering).toBe(5);
    expect(r.overall).toBe(5);
    expect(r.confidence).toBe(0.5);
    expect(r.rationale).toBe("Ingen motivering tillgänglig.");
  });

  it("tomt cardName blir undefined, aldrig en tom sträng i UI:t", () => {
    expect(buildGradeResult({ cardName: "   " }, "m").cardName).toBeUndefined();
    expect(buildGradeResult({ cardName: 42 }, "m").cardName).toBeUndefined();
    expect(buildGradeResult({ cardName: " Torchic 65/100 " }, "m").cardName).toBe(
      "Torchic 65/100"
    );
  });

  it("kortnamnet kapas till 120 tecken", () => {
    const r = buildGradeResult({ cardName: "x".repeat(300) }, "m");
    expect(r.cardName).toHaveLength(120);
  });
});

describe("buildClosingInstruction", () => {
  it("är ORDAGRANT densamma för alla leverantörer, med och utan hint", () => {
    expect(buildClosingInstruction()).toBe(
      "Bedöm kortets skick och anropa report_grade med dina poäng."
    );
    expect(buildClosingInstruction("Torchic 65/100")).toBe(
      "Bedöm kortets skick och anropa report_grade med dina poäng. Kortet är troligen: Torchic 65/100."
    );
  });
});

/**
 * MOTIVERINGENS SPRÅK. `rationale` är modellgenererad prosa och kan därför inte
 * översättas via messages/*.json — språket måste följa med förfrågan. Rapporterat
 * i fält 2026-08-05: en användare med engelskt gränssnitt fick svensk motivering,
 * eftersom systemprompten hårdkodade "på svenska".
 *
 * Testet vaktar att språket FAKTISKT når prompten. En tyst fallback till svenska
 * är exakt buggen, så reserven testas också explicit.
 */
describe("graderingens språk", () => {
  it("skriver motiveringen på det begärda språket", () => {
    expect(buildSystem("sv")).toContain("motivering på svenska");
    expect(buildSystem("en")).toContain("motivering på engelska");
  });

  it("byter BARA motiveringens språk — instruktionen står kvar", () => {
    // Byttes hela promptspråket skulle en leverantörsjämförelse mäta prompt,
    // inte modell. Allt utom språkfrasen ska vara identiskt.
    const sv = buildSystem("sv").replace("på svenska", "SPRÅK");
    const en = buildSystem("en").replace("på engelska", "SPRÅK");
    expect(sv).toBe(en);
  });

  it("faller tillbaka på appens standardspråk för okänt/saknat värde", () => {
    expect(resolveGradingLocale("en")).toBe("en");
    expect(resolveGradingLocale("sv")).toBe("sv");
    expect(resolveGradingLocale(undefined)).toBe(DEFAULT_GRADING_LOCALE);
    expect(resolveGradingLocale(null)).toBe(DEFAULT_GRADING_LOCALE);
    expect(resolveGradingLocale("de")).toBe(DEFAULT_GRADING_LOCALE);
  });
});
