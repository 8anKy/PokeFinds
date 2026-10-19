import { describe, it, expect } from "vitest";
import { currentPlanKind, type StorePlanOption } from "@/lib/store-plans";

// Pro-vyns bytesknapp (2026-10-20) får bara visas när vi VET att kunden har
// månadsplanen — en okänd produkt (gammal, gåva) ger inget erbjudande alls.
const opt = (productId: string, kind: StorePlanOption["kind"]): StorePlanOption => ({
  packageId: kind,
  productId,
  kind,
  price: "39 kr",
  per: "month",
  secondary: null,
  trialDays: null,
});

describe("currentPlanKind", () => {
  const ios = { month: opt("premium_monthly", "month"), year: opt("premium_yearly", "commit") };
  // Som i Play Console: EN prenumeration, två basplaner.
  const play = { month: opt("foilio_pro_monthly:monthly", "month"), year: opt("foilio_pro_monthly:yearly", "annual") };

  it("känner igen månads- och årsplanen på iOS", () => {
    expect(currentPlanKind("premium_monthly", ios)).toBe("month");
    expect(currentPlanKind("premium_yearly", ios)).toBe("year");
  });
  it("Play: basplanen avgör när månad och år är samma produkt", () => {
    expect(currentPlanKind("foilio_pro_monthly", play, "monthly")).toBe("month");
    expect(currentPlanKind("foilio_pro_monthly", play, "yearly")).toBe("year");
  });
  it("Play utan basplan ⇒ null, aldrig en gissning", () => {
    expect(currentPlanKind("foilio_pro_monthly", play)).toBeNull();
  });
  it("iOS-åtagandet (premium_yearly:monthly) räknas som året", () => {
    const commit = { month: opt("premium_monthly", "month"), year: opt("premium_yearly:monthly", "commit") };
    expect(currentPlanKind("premium_yearly", commit)).toBe("year");
    expect(currentPlanKind("premium_monthly", commit)).toBe("month");
  });
  it("okänd eller saknad produkt ⇒ null (inget byte erbjuds)", () => {
    expect(currentPlanKind("foilio_pro_legacy", ios)).toBeNull();
    expect(currentPlanKind(null, ios)).toBeNull();
    expect(currentPlanKind("premium_monthly", { month: null, year: null })).toBeNull();
  });
});
