/**
 * offersToMarkSoldOut: en offer vars butik hämtades men vars URL försvann ur
 * feeden ska bli slutsåld — MEN först efter grace-fönstret (debounce mot
 * rullande/instabila feeds som Swepoke). Annars lämnas den orörd.
 */
import { describe, expect, it } from "vitest";
import { StockStatus } from "@prisma/client";
import { offersToMarkSoldOut } from "@/scrapers/runner";

const feedRetailers = new Set(["r1"]);
const NOW = new Date("2026-07-06T12:00:00Z");
const GRACE = 24 * 3600_000;
const long = new Date(NOW.getTime() - 30 * 3600_000); // sedd för 30h sedan (> grace)
const recent = new Date(NOW.getTime() - 1 * 3600_000); // sedd för 1h sedan (< grace)

const offer = (o: Partial<{ retailerId: string; url: string; stockStatus: StockStatus; lastSeenAt: Date | null }>) => ({
  retailerId: "r1", url: "https://s/a", stockStatus: StockStatus.IN_STOCK, lastSeenAt: long, ...o,
});
const run = (offers: ReturnType<typeof offer>[], freshKeys: Set<string>, retailers = feedRetailers) =>
  offersToMarkSoldOut(offers, freshKeys, retailers, NOW, GRACE);

describe("offersToMarkSoldOut", () => {
  it("markerar en försvunnen in-stock offer som varit borta längre än grace", () => {
    expect(run([offer({})], new Set<string>())).toHaveLength(1);
  });

  it("rör INTE en nyligen sedd offer (debounce mot rullande feed)", () => {
    expect(run([offer({ lastSeenAt: recent })], new Set<string>())).toHaveLength(0);
  });

  it("rör INTE en offer som fortfarande finns i feeden", () => {
    expect(run([offer({})], new Set(["r1:https://s/a"]))).toHaveLength(0);
  });

  it("rör INTE butiker vars feed inte hämtades (nätverksfel/tom)", () => {
    expect(run([offer({})], new Set<string>(), new Set<string>())).toHaveLength(0);
  });

  it("rör INTE en redan slutsåld offer", () => {
    expect(run([offer({ stockStatus: StockStatus.OUT_OF_STOCK })], new Set<string>())).toHaveLength(0);
  });

  it("slutsäljer en aldrig-sedd (lastSeenAt null) försvunnen offer", () => {
    expect(run([offer({ lastSeenAt: null })], new Set<string>())).toHaveLength(1);
  });
});
