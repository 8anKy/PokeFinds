/**
 * /pris lageröverlägg (2026-10-12): lanens besked läggs på nattens snapshot.
 */
import { describe, expect, it } from "vitest";
import { applyStockOverlay, mergeOverlay, overlayKey, type StockOverlay } from "@/lib/stock-overlay";
import { buildPriceEmbed } from "@/lib/discord-price-command";
import type { SnapshotEntry } from "@/lib/catalog-snapshot";

const SNAP_AT = Date.parse("2026-10-12T01:30:00Z");
const URL_ST = "https://speltrollet.se/30th-booster-bundle";

function entry(): SnapshotEntry {
  const offer = (name: string, url: string, price: number, stockStatus = "IN_STOCK") =>
    ({ url, price, stockStatus, retailer: { name } }) as unknown as SnapshotEntry["prices"]["offers"][number];
  return {
    slug: "30th-booster-bundle",
    title: "30th Celebration Booster Bundle",
    imageUrl: null,
    set: { name: "30th Celebration" },
    prices: {
      at: new Date(SNAP_AT).toISOString(),
      offers: [offer("Speltrollet", URL_ST, 64900), offer("Rogerz", "https://rogerz.se/bb", 114500)],
      stats: {},
      affiliateRetailerIds: [],
    },
  } as unknown as SnapshotEntry;
}

describe("mergeOverlay", () => {
  it("nyaste beskedet per (butik, URL) vinner; äldre ignoreras", () => {
    const a = mergeOverlay({}, [{ storeName: "Speltrollet", storeUrl: URL_ST, to: "OUT_OF_STOCK", priceOre: null, at: 2000 }], 3000)!;
    expect(a[overlayKey("Speltrollet", URL_ST)]).toEqual({ s: "OUT_OF_STOCK", p: null, at: 2000 });
    expect(mergeOverlay(a, [{ storeName: "Speltrollet", storeUrl: URL_ST, to: "IN_STOCK", priceOre: 500, at: 1000 }], 3000)).toBeNull();
  });

  it("samma besked igen skriver inte om filen (lanen erbjuder synken varje minut)", () => {
    const a = mergeOverlay({}, [{ storeName: "S", storeUrl: "u", to: "OUT_OF_STOCK", priceOre: null, at: 1000 }], 1000)!;
    expect(mergeOverlay(a, [{ storeName: "S", storeUrl: "u", to: "OUT_OF_STOCK", priceOre: null, at: 61_000 }], 61_000)).toBeNull();
  });

  it("gamla besked städas bort", () => {
    const old: StockOverlay = { [overlayKey("S", "u")]: { s: "OUT_OF_STOCK", p: null, at: 0 } };
    expect(mergeOverlay(old, [], 49 * 3600_000)).toEqual({});
  });
});

describe("applyStockOverlay + /pris", () => {
  it("en butik som sålt slut efter snapshoten försvinner ur 'I lager i butik'", () => {
    const overlay: StockOverlay = {
      [overlayKey("Speltrollet", URL_ST)]: { s: "OUT_OF_STOCK", p: null, at: SNAP_AT + 13 * 3600_000 },
    };
    const live = applyStockOverlay(entry(), overlay);
    expect(live.updatedAt).toBe(SNAP_AT + 13 * 3600_000);
    const embed = buildPriceEmbed(live.entry, null, "https://foilio.se", live.updatedAt);
    const stores = embed.fields.find((f) => f.name === "I lager i butik")!.value;
    expect(stores).not.toContain("Speltrollet");
    expect(stores).toContain("Rogerz");
    expect(embed.description).toContain("lager uppdaterat <t:");
  });

  it("besked äldre än snapshoten rör ingenting", () => {
    const overlay: StockOverlay = { [overlayKey("Speltrollet", URL_ST)]: { s: "OUT_OF_STOCK", p: null, at: SNAP_AT - 1 } };
    const live = applyStockOverlay(entry(), overlay);
    expect(live.updatedAt).toBeNull();
    expect(live.entry.prices.offers[0].stockStatus).toBe("IN_STOCK");
  });

  it("annan butik med samma URL matchar inte", () => {
    const overlay: StockOverlay = { [overlayKey("Rogerz", URL_ST)]: { s: "OUT_OF_STOCK", p: null, at: SNAP_AT + 1 } };
    expect(applyStockOverlay(entry(), overlay).updatedAt).toBeNull();
  });
});
