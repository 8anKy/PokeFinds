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
  const play = { month: opt("premium_monthly:monthly", "month"), year: opt("premium_yearly:annual", "annual") };

  it("känner igen månads- och årsplanen på iOS", () => {
    expect(currentPlanKind("premium_monthly", ios)).toBe("month");
    expect(currentPlanKind("premium_yearly", ios)).toBe("year");
  });
  it("jämför Plays produkt utan basplan", () => {
    expect(currentPlanKind("premium_monthly", play)).toBe("month");
    expect(currentPlanKind("premium_yearly:annual", play)).toBe("year");
  });
  it("okänd eller saknad produkt ⇒ null (inget byte erbjuds)", () => {
    expect(currentPlanKind("foilio_pro_legacy", ios)).toBeNull();
    expect(currentPlanKind(null, ios)).toBeNull();
    expect(currentPlanKind("premium_monthly", { month: null, year: null })).toBeNull();
  });
});
