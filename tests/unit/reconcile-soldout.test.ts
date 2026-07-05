/**
 * offersToMarkSoldOut: en offer vars butik hämtades men vars URL försvann ur
 * feeden ska bli slutsåld; annars lämnas den orörd.
 */
import { describe, expect, it } from "vitest";
import { StockStatus } from "@prisma/client";
import { offersToMarkSoldOut } from "@/scrapers/runner";

const feedRetailers = new Set(["r1"]);
const offer = (o: Partial<{ retailerId: string; url: string; stockStatus: StockStatus }>) => ({
  retailerId: "r1", url: "https://s/a", stockStatus: StockStatus.IN_STOCK, ...o,
});

describe("offersToMarkSoldOut", () => {
  it("markerar en försvunnen (ej i feeden) in-stock offer", () => {
    const out = offersToMarkSoldOut([offer({})], new Set<string>(), feedRetailers);
    expect(out).toHaveLength(1);
  });

  it("rör INTE en offer som fortfarande finns i feeden", () => {
    const out = offersToMarkSoldOut([offer({})], new Set(["r1:https://s/a"]), feedRetailers);
    expect(out).toHaveLength(0);
  });

  it("rör INTE butiker vars feed inte hämtades (nätverksfel/tom)", () => {
    const out = offersToMarkSoldOut([offer({})], new Set<string>(), new Set<string>());
    expect(out).toHaveLength(0);
  });

  it("rör INTE en redan slutsåld offer", () => {
    const out = offersToMarkSoldOut(
      [offer({ stockStatus: StockStatus.OUT_OF_STOCK })], new Set<string>(), feedRetailers
    );
    expect(out).toHaveLength(0);
  });
});
