import { describe, expect, it } from "vitest";
import { soldItemIdsFrom } from "@/jobs/tradera-sold-sync";

describe("soldItemIdsFrom", () => {
  it("plockar ut objekt-ids som strängar och hoppar över tomma", () => {
    const set = soldItemIdsFrom([
      { item: { id: 738838205 } },
      { item: { id: 738837238 } },
      { item: {} },
      {},
    ]);
    expect(set).toEqual(new Set(["738838205", "738837238"]));
    expect(set.has("738838205")).toBe(true);
  });
});
