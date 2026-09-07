import { describe, expect, it } from "vitest";
import {
  SEALED_CONDITIONS,
  applyPricePercent,
  conditionLabel,
  conditionOptionsFor,
  gradeToCondition,
  totalBuyerKr,
} from "@/lib/tradera-listing-options";
import { normalizeShippingOptions } from "@/lib/tradera-shipping";

describe("prissnabbvalen", () => {
  it("räknar procenten på basen, som exemplet i ägarens beskrivning", () => {
    expect(applyPricePercent(200, 20)).toBe(240);
    expect(applyPricePercent(200, -10)).toBe(180);
    expect(applyPricePercent(200, 0)).toBe(200);
  });

  it("går aldrig under 1 kr — Tradera tar inga nollannonser", () => {
    expect(applyPricePercent(1, -10)).toBe(1);
  });

  it("summan är pris + frakt, och ogiltiga tal räknas som noll", () => {
    expect(totalBuyerKr(240, 22)).toBe(262);
    expect(totalBuyerKr(Number.NaN, 22)).toBe(22);
    expect(totalBuyerKr(240, Number.NaN)).toBe(240);
  });
});

describe("skick per varutyp", () => {
  it("en förseglad produkt får förseglad/öppnad, aldrig Near Mint-skalan", () => {
    expect(conditionOptionsFor(false)).toEqual(SEALED_CONDITIONS);
    expect(conditionOptionsFor(true)).toContain("NEAR_MINT");
    expect(conditionOptionsFor(true)).not.toContain("SEALED");
  });

  it("samma nyckel betyder olika saker för kort och sealed", () => {
    expect(conditionLabel("NEAR_MINT", true)).toBe("Near Mint");
    expect(conditionLabel("NEAR_MINT", false)).toBe("Öppnad, som ny");
  });
});

describe("AI-graderingens förslag", () => {
  it("mappar helhetsgraden till ett skick", () => {
    expect(gradeToCondition(10)).toBe("MINT");
    expect(gradeToCondition(8.7)).toBe("NEAR_MINT");
    expect(gradeToCondition(7.2)).toBe("EXCELLENT");
    expect(gradeToCondition(5)).toBe("GOOD");
    expect(gradeToCondition(3.5)).toBe("PLAYED");
    expect(gradeToCondition(1)).toBe("POOR");
  });

  it("faller på NEAR_MINT när graden inte är ett tal — aldrig ett värre påstående än vi vet", () => {
    expect(gradeToCondition(Number.NaN)).toBe("NEAR_MINT");
  });
});

describe("fraktalternativen ur Traderas referensdata", () => {
  const raw = {
    productsPerWeightSpan: [
      {
        weight: 0.05,
        products: [
          {
            id: 1,
            shippingProvider: "PostNordStamp",
            shippingProviderId: 13,
            price: 22,
            deliveryInformation: { isTraceable: false, servicePoint: false, estimatedDeliveryTime: { minWeekdays: 2 } },
          },
          {
            id: 101,
            shippingProvider: "DHL",
            shippingProviderId: 2,
            price: 49,
            deliveryInformation: { isTraceable: true, servicePoint: true, estimatedDeliveryTime: { minWeekdays: 1, maxWeekdays: 3 } },
          },
          // Samma leverantör två gånger — bara den billigaste ska överleva.
          { id: 300, shippingProvider: "Instabox", shippingProviderId: 19, price: 59 },
          // …och vid LIKA pris den som tar det största paketet (id 102 här).
          {
            id: 100,
            shippingProvider: "Instabox",
            shippingProviderId: 19,
            price: 49,
            packageRequirements: { maxLength: 0.34, maxWidth: 0.24, maxHeight: 0.07 },
          },
          {
            id: 102,
            shippingProvider: "Instabox",
            shippingProviderId: 19,
            price: 49,
            packageRequirements: { maxLength: 0.6, maxWidth: 0.4, maxHeight: 0.2 },
          },
          // "Alternative" är vår egen "Egen frakt"-rad, inte ett fraktbolag.
          { id: 10, shippingProvider: "Alternative", shippingProviderId: 6, price: 0 },
        ],
      },
      { weight: 0, products: [] },
    ],
  };

  it("sorterar billigast först, en rad per leverantör, utan Alternative", () => {
    const spans = normalizeShippingOptions(raw);
    expect(spans).toHaveLength(1);
    expect(spans[0].weightKg).toBe(0.05);
    expect(spans[0].options.map((o) => `${o.provider}:${o.priceKr}`)).toEqual([
      "PostNordStamp:22",
      "DHL:49",
      "Instabox:49",
    ]);
  });

  it("vid lika pris vinner produkten som tar det största paketet", () => {
    const instabox = normalizeShippingOptions(raw)[0].options.find((o) => o.provider === "Instabox");
    expect(instabox?.productId).toBe(102);
  });

  it("bär med leveransinfo så raden kan säga spårbar/ombud/dagar", () => {
    const [stamp, dhl] = normalizeShippingOptions(raw)[0].options;
    expect(stamp).toMatchObject({ tracked: false, servicePoint: false, minDays: 2, maxDays: null });
    expect(dhl).toMatchObject({ tracked: true, servicePoint: true, minDays: 1, maxDays: 3 });
  });

  it("skräp in ger tom lista, inte ett kast", () => {
    expect(normalizeShippingOptions(null)).toEqual([]);
    expect(normalizeShippingOptions({ productsPerWeightSpan: "nej" })).toEqual([]);
  });
});
