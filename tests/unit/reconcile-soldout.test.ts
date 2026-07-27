/**
 * offersToVerify: en offer vars butik hämtades men vars URL försvann ur feeden ska
 * slås upp mot butikens EGEN produktsida — men först efter grace-fönstret (debounce
 * mot rullande/instabila feeds som Swepoke).
 *
 * Till skillnad från gamla offersToMarkSoldOut filtreras INGA statusar bort: en
 * slutsåld Speltrollet-vara ligger inte i deras Pokémon-kollektioner alls, så feeden
 * kan aldrig visa att den kommit tillbaka. Utan uppslaget vore den permanent osynlig
 * för restock-larmen. UNKNOWN→IN larmar ändå aldrig → tyst healing, ingen spam.
 */
import { describe, expect, it } from "vitest";
import { StockStatus } from "@prisma/client";
import { offersToVerify } from "@/scrapers/runner";

const feedRetailers = new Set(["r1"]);
const NOW = new Date("2026-07-06T12:00:00Z");
const GRACE = 24 * 3600_000;
const long = new Date(NOW.getTime() - 30 * 3600_000); // sedd för 30h sedan (> grace)
const recent = new Date(NOW.getTime() - 1 * 3600_000); // sedd för 1h sedan (< grace)

const offer = (o: Partial<{ retailerId: string; url: string; stockStatus: StockStatus; lastSeenAt: Date | null }>) => ({
  retailerId: "r1", url: "https://s/a", stockStatus: StockStatus.IN_STOCK, lastSeenAt: long, ...o,
});
const run = (offers: ReturnType<typeof offer>[], freshKeys: Set<string>, retailers = feedRetailers) =>
  offersToVerify(offers, freshKeys, retailers, NOW, GRACE);

describe("offersToVerify", () => {
  it("tar upp en försvunnen in-stock offer som varit borta längre än grace", () => {
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

  it("tar upp en redan slutsåld offer — feeden kan inte visa att den kommit tillbaka", () => {
    expect(run([offer({ stockStatus: StockStatus.OUT_OF_STOCK })], new Set<string>())).toHaveLength(1);
  });

  it("tar upp en redan UNKNOWN-nollad offer så den kan helas", () => {
    expect(run([offer({ stockStatus: StockStatus.UNKNOWN })], new Set<string>())).toHaveLength(1);
  });

  it("tar upp en aldrig-sedd (lastSeenAt null) försvunnen offer", () => {
    expect(run([offer({ lastSeenAt: null })], new Set<string>())).toHaveLength(1);
  });

  it("äldst först — taket (RESTOCK_VERIFY_MAX) roterar rättvist", () => {
    const older = new Date(NOW.getTime() - 90 * 3600_000);
    const result = run(
      [offer({ url: "https://s/ny", lastSeenAt: long }), offer({ url: "https://s/gammal", lastSeenAt: older })],
      new Set<string>()
    );
    expect(result.map((o) => o.url)).toEqual(["https://s/gammal", "https://s/ny"]);
  });
});

describe("rotation → tyst återställning (UNKNOWN→IN larmar aldrig)", () => {
  it("UNKNOWN→IN_STOCK är ingen äkta övergång (ingen event, inget larm)", async () => {
    const { netStockEvent } = await import("@/scrapers/restock");
    const ev = netStockEvent(StockStatus.UNKNOWN, StockStatus.IN_STOCK);
    expect(ev.emit).toBe(false);
    expect(ev.isRestock).toBe(false);
  });

  it("äkta slutförsäljning OUT→IN larmar fortfarande", async () => {
    const { netStockEvent } = await import("@/scrapers/restock");
    const ev = netStockEvent(StockStatus.OUT_OF_STOCK, StockStatus.IN_STOCK);
    expect(ev.emit).toBe(true);
    expect(ev.isRestock).toBe(true);
  });
});
