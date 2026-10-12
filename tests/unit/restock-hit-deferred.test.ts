import { describe, expect, it } from "vitest";
import { restockHitBatchSchema, sendRestockHits, type RestockHit } from "@/lib/restock-hits";
import { DB_AWAKE_PIGGYBACK_MS, dbIdleMs, noteDbActivity } from "@/lib/db-activity";

const sync: RestockHit = {
  key: "Speltrollet\thttps://speltrollet.se/products/x",
  kind: "STOCK_SYNC",
  storeName: "Speltrollet",
  storeUrl: "https://speltrollet.se/products/x",
  cartUrl: null,
  productSlug: null,
  title: null,
  priceOre: null,
  previousPriceOre: null,
  from: "IN_STOCK",
  to: "OUT_OF_STOCK",
  at: 1,
};

describe("lagersynkar som inte får väcka Neon (2026-10-12)", () => {
  it("onlyIfAwake skickas med och ett deferred-svar lämnar hitsen i kön", async () => {
    let sent: unknown = null;
    const fetchImpl = (async (_u: string, init: RequestInit) => {
      sent = JSON.parse(String(init.body));
      return new Response(JSON.stringify({ ok: true, deferred: true, received: 1 }), { status: 200 });
    }) as unknown as typeof fetch;
    const r = await sendRestockHits([sync], { baseUrl: "https://x", secret: "s", onlyIfAwake: true, fetchImpl });
    expect(sent).toMatchObject({ onlyIfAwake: true });
    expect(r).toMatchObject({ ok: true, deferred: true });
    expect(r.result).toBeUndefined();
  });

  it("äldre kroppar utan flaggan tolkas som vanliga leveranser", () => {
    expect(restockHitBatchSchema.parse({ hits: [sync] }).onlyIfAwake).toBe(false);
  });

  it("vaken = en fråga inom fönstret", () => {
    noteDbActivity(1_000_000);
    expect(dbIdleMs(1_000_000 + DB_AWAKE_PIGGYBACK_MS - 1)).toBeLessThan(DB_AWAKE_PIGGYBACK_MS);
    expect(dbIdleMs(1_000_000 + DB_AWAKE_PIGGYBACK_MS + 1)).toBeGreaterThan(DB_AWAKE_PIGGYBACK_MS);
  });
});
