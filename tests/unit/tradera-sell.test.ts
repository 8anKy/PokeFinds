import { describe, expect, it } from "vitest";
import { traderaCategoryId, traderaLanguageTerm, parseImage } from "@/lib/tradera-sell";

describe("traderaCategoryId", () => {
  it("mappar singel/graderat till löskort och sealed till rätt kategori", () => {
    expect(traderaCategoryId(null, true)).toBe(1001337);
    expect(traderaCategoryId("GRADED_CARD", false)).toBe(1001337);
    expect(traderaCategoryId("BOOSTER_BOX", false)).toBe(1001340);
    expect(traderaCategoryId("BOOSTER_PACK", false)).toBe(1001339);
    expect(traderaCategoryId("ETB", false)).toBe(1001341);
  });
});

describe("traderaLanguageTerm", () => {
  it("översätter kända språk och lämnar okända odefinierade", () => {
    expect(traderaLanguageTerm("EN")).toBe("Engelska");
    expect(traderaLanguageTerm("SV")).toBeUndefined();
  });
});

describe("parseImage", () => {
  it("plockar ut base64 och rätt ImageFormat (0=Jpeg, 2=Png)", () => {
    expect(parseImage("data:image/png;base64,AAAB")).toEqual({ data: "AAAB", format: 2 });
    expect(parseImage("data:image/jpeg;base64,ZZZZ")).toEqual({ data: "ZZZZ", format: 0 });
    // rått base64 utan prefix → antas jpeg
    expect(parseImage("RAWDATA")).toEqual({ data: "RAWDATA", format: 0 });
  });
});
