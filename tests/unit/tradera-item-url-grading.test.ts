import { describe, expect, it } from "vitest";
import {
  GRADES,
  GRADING_ISSUERS,
  gradingLabel,
  traderaGrade,
  traderaGradingIssuer,
  traderaItemUrl,
} from "@/lib/tradera-listing-options";

/**
 * ⛔ `/item/0/<id>` VAR 404 — och den länken låg i forumtrådarna ("Visa på
 * Tradera") och i katalogens offers, så knappen tog användaren till Traderas
 * felsida (rapporterat 2026-09-07). Mätt mot tradera.com samma dag:
 *   /item/0/749317922       → 404
 *   /item/1001337/749317922 → 404  (rätt kategori, ingen slug)
 *   /item/749317922         → 308 → /item/1001337/749317922/dragonair-jp-…
 * Bara den KORTA formen kanoniseras av Tradera själva — de kan slugen, vi kan
 * den inte.
 */
describe("traderaItemUrl", () => {
  it("bygger den korta formen, aldrig en gissad kategori", () => {
    expect(traderaItemUrl(749317922)).toBe("https://www.tradera.com/item/749317922");
    expect(traderaItemUrl("749317922")).toBe("https://www.tradera.com/item/749317922");
  });

  it("innehåller aldrig kategorisegmentet 0", () => {
    expect(traderaItemUrl(1)).not.toContain("/item/0/");
  });
});

/**
 * Graderingen skickas som Traderas STRUKTURERADE attribut (125 = bolag,
 * 126 = betyg), så annonsen blir sökbar i deras egna filter i stället för att
 * bara nämnas i texten. ⛔ Id:n och termer är hämtade ur
 * `GET /v4/categories/{id}/attribute-definitions` (scripts/probe-tradera-attributes.ts)
 * — API:t tar bara värden ur `possibleTermValues`.
 */
describe("gradering mot Traderas attribut", () => {
  it("listorna är Traderas egna termer", () => {
    expect(GRADING_ISSUERS).toEqual(["PSA", "Beckett", "CGC", "ACE", "Raukcard", "Övriga"]);
    // Tradera har inga betyg mellan 1 och 8 med halvsteg — bara 8.5 och 9.5.
    expect([...GRADES].sort()).toEqual(
      ["1", "10", "2", "3", "4", "5", "6", "7", "8", "8.5", "9", "9.5"].sort()
    );
  });

  it("mappar bolag till Traderas egna termer", () => {
    expect(traderaGradingIssuer("psa")).toBe("PSA");
    // BGS heter "Beckett" hos Tradera.
    expect(traderaGradingIssuer("BGS")).toBe("Beckett");
    expect(traderaGradingIssuer("Beckett")).toBe("Beckett");
    // ⛔ Okänt bolag blir "Övriga", aldrig undefined: kortet ÄR graderat, och
    // att tappa den upplysningen vore sämre än att säga "någon annan".
    expect(traderaGradingIssuer("SGC")).toBe("Övriga");
    expect(traderaGradingIssuer("")).toBeUndefined();
    expect(traderaGradingIssuer(null)).toBeUndefined();
  });

  it("släpper bara igenom betyg Tradera känner", () => {
    expect(traderaGrade("10")).toBe("10");
    // Svensk decimalkomma in, Traderas punkt ut.
    expect(traderaGrade("9,5")).toBe("9.5");
    expect(traderaGrade("9.5")).toBe("9.5");
    expect(traderaGrade("11")).toBeUndefined();
    expect(traderaGrade("Gem Mint")).toBeUndefined();
  });

  it("etiketten kräver BÅDE bolag och betyg", () => {
    expect(gradingLabel("PSA", "10")).toBe("PSA 10");
    // Ett bolag utan betyg säger ingenting om kortet.
    expect(gradingLabel("PSA", "")).toBeNull();
    expect(gradingLabel("", "10")).toBeNull();
    expect(gradingLabel("bgs", "9,5")).toBe("Beckett 9.5");
  });
});
