import { describe, expect, it } from "vitest";
import { sealedListingProblem } from "@/lib/tradera-sealed-rules";

describe("Tradera: fortfarande den förseglade varan? (utan AI)", () => {
  it("öppnad, tom, bara asken, kopia ⇒ fälls", () => {
    expect(sealedListingProblem("Prismatic Evolutions ETB öppnad", "")).toMatch(/öppnad/);
    expect(sealedListingProblem("Togepi Mini Tin", "5 tomma mini tins utan innehåll, endast ask och art card")).toBeTruthy();
    expect(sealedListingProblem("Crown Zenith ETB", "Säljer bara asken, korten är borta")).toBeTruthy();
    expect(sealedListingProblem("Booster Box", "Ripped seal on one side")).toBeTruthy();
    expect(sealedListingProblem("151 Booster Bundle", "Proxy-kort ingår")).toMatch(/äkta/);
    expect(sealedListingProblem("Surging Sparks ETB", "ETB:n saknar 2 boosterpaket")).toMatch(/saknar/);
  });

  it("nekade ord är MOTSATSEN och fäller inte", () => {
    expect(sealedListingProblem("Surging Sparks ETB - oöppnad", "Aldrig öppnad, inplastad")).toBeNull();
    expect(sealedListingProblem("Booster Box ej öppnad", "Inte öppnad, i originalplast")).toBeNull();
    expect(sealedListingProblem("Display", "Ubrudt emballage, uåbnet, sealed")).toBeNull();
    expect(sealedListingProblem("ETB", "Unopened, factory sealed")).toBeNull();
    expect(sealedListingProblem("ETB", "Saknar inget, komplett")).toBeNull();
  });

  it("kosmetiska skavanker och 'saknar repor' fäller inte", () => {
    expect(sealedListingProblem("Paldean Fates ETB", "Liten buckla i hörnet, plasten hel. Saknar repor.")).toBeNull();
    expect(sealedListingProblem("Booster Box", "Lite solblekt kartong, förseglad")).toBeNull();
  });
});
