/**
 * Tester för Tradera-kategorivakten (traderaCategoryCompatible) som hindrar att
 * t.ex. en boosterpaket-annons blir offerten för en ETB-produkt.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ prisma: {} }));

import { traderaCategoryCompatible } from "@/jobs/tradera-sweep";

describe("traderaCategoryCompatible", () => {
  it("avvisar boosterpaket-annons (1001339) mot ETB-produkt — den rapporterade buggen", () => {
    expect(traderaCategoryCompatible("ETB", 1001339)).toBe(false);
  });

  it("avvisar boosterbox-annons mot booster pack och tvärtom", () => {
    expect(traderaCategoryCompatible("BOOSTER_PACK", 1001340)).toBe(false);
    expect(traderaCategoryCompatible("BOOSTER_BOX", 1001339)).toBe(false);
  });

  it("godkänner annons i samma form-grupp", () => {
    expect(traderaCategoryCompatible("ETB", 1001341)).toBe(true);
    expect(traderaCategoryCompatible("COLLECTION_BOX", 1001341)).toBe(true);
    expect(traderaCategoryCompatible("BOOSTER_BOX", 1001340)).toBe(true);
    expect(traderaCategoryCompatible("SINGLE_CARD", 1001337)).toBe(true);
  });

  it("singel-annons (1001337) får inte matcha sealed och tvärtom", () => {
    expect(traderaCategoryCompatible("ETB", 1001337)).toBe(false);
    expect(traderaCategoryCompatible("SINGLE_CARD", 1001341)).toBe(false);
  });

  it("okänd annonskategori: behåller gamla vakten (singel kräver bekräftelse, sealed släpps)", () => {
    expect(traderaCategoryCompatible("SINGLE_CARD", undefined)).toBe(false);
    expect(traderaCategoryCompatible("ETB", undefined)).toBe(true);
  });
});
