/**
 * TYST LAGERSYNK (ägarbeslut 2026-09-28, "alternativ A"): Discord-lanen såg varje
 * slutförsäljning men kastade den — "i lager" stod kvar i appen tills nattkedjan, upp
 * till ett dygn, och prislarmet/"Lägst" kunde peka på en slutsåld butik.
 *
 * Tre saker vaktas:
 *   1. Domen i lanen: bara RUTTADE URL:er, feedens status som helhet (en Webhallen-vara
 *      som bara tagit slut i webblagret är fortfarande en butiksvara = i lager), och
 *      påfyllningar lanen dämpade bort synkas tillbaka så appen inte står kvar på "Slut".
 *   2. Kön: synkar väcker aldrig Neon — de åker bara efter ett levererat larm, en per
 *      URL, och ett larm eller en motsägande feedstatus gör dem inaktuella.
 *   3. Appen: bara offern på URL:en, aldrig över ett nyare läge, ingen RestockEvent.
 */
import { describe, expect, it } from "vitest";
import {
  deriveRestockPosts,
  STORE_TRACK_SUFFIX,
  type DiscordRestockState,
  type FullFeedGroup,
  type RouteTable,
} from "@/lib/restock-feed-events";
import { buildDiscordFilterContext } from "@/lib/discord-restock-filter";
import {
  hitsFromStockSyncs,
  mergePendingHits,
  restockHitSchema,
  splitHitBatch,
  STOCK_SYNC_TTL_MS,
  type RestockHit,
} from "@/lib/restock-hits";
import type { FlapPolicy } from "@/lib/stock-flap";

const POLICY: FlapPolicy = { minAwayMinutes: 5, flapMaxTransitions: 40, flapCooldownHours: 24 };
const NOW = new Date("2026-09-28T12:00:00Z");
const ROUTE = {
  title: "30th Celebration Elite Trainer Box",
  slug: "30th-celebration-elite-trainer-box",
  setName: "30th Celebration",
  series: "Mega Evolution",
  language: "EN",
};

const SHOP_URL = "https://speltrollet.se/products/pokemon-30th-celebration-elite-trainer-box";
const SHOP = "Speltrollet";
const SHOP_KEY = `${SHOP}\t${SHOP_URL}`;
const WH_URL = "https://www.webhallen.com/se/product/401998";
const WH = "Webhallen";
const WH_KEY = `${WH}\t${WH_URL}`;
const WH_STORE = `${WH_KEY}${STORE_TRACK_SUFFIX}`;
const ROUTES: RouteTable = { [SHOP_URL]: ROUTE, [WH_URL]: ROUTE };
const FILTER = buildDiscordFilterContext({ routes: ROUTES, setNames: ["30th Celebration"] });

type S = "IN_STOCK" | "OUT_OF_STOCK" | "PREORDER";
const shopFeed = (status: S, url = SHOP_URL): FullFeedGroup[] => [
  {
    sourceName: SHOP,
    items: [{ url, stockStatus: status, title: "Pokémon 30th Celebration Elite Trainer Box", price: 89900, imageUrl: null, category: "ETB" }],
  },
];
const whFeed = (o: { status: S; storeOnly: boolean; store: S }): FullFeedGroup[] => [
  {
    sourceName: WH,
    items: [
      {
        url: WH_URL,
        stockStatus: o.status,
        title: "Pokemon 30th Celebration Elite Trainer Box",
        price: 89900,
        imageUrl: null,
        category: "ETB",
        storeOnly: o.storeOnly,
        storeStock: { units: o.store === "IN_STOCK" ? 12 : 0, stores: o.store === "IN_STOCK" ? 2 : 0, capped: false },
        storeStatus: o.store,
      },
    ],
  },
];

function derive(state: DiscordRestockState, groups: FullFeedGroup[], routes: RouteTable = ROUTES) {
  return deriveRestockPosts({
    state,
    groups,
    rotating: new Set(),
    routes,
    filter: FILTER,
    now: NOW,
    policy: POLICY,
    cooldownHours: 0.25,
    baseUrl: "https://foilio.se",
    priceDrops: null,
  });
}
const st = (stock: Record<string, string>, posted: Record<string, number> = {}): DiscordRestockState => ({
  stock,
  history: {},
  posted,
});

describe("lagersynk i lanen — vad som blir en tyst synk", () => {
  it("slutförsäljning på en ruttad URL ⇒ synk till OUT, inget inlägg", () => {
    const r = derive(st({ [SHOP_KEY]: "IN_STOCK" }), shopFeed("OUT_OF_STOCK"));
    expect(r.posts).toEqual([]);
    expect(r.stockSyncs).toEqual([
      { key: SHOP_KEY, storeName: SHOP, storeUrl: SHOP_URL, from: "IN_STOCK", to: "OUT_OF_STOCK", priceOre: 89900 },
    ]);
  });

  it("utan rutt finns ingen offer att rätta ⇒ ingen synk", () => {
    expect(derive(st({ [SHOP_KEY]: "IN_STOCK" }), shopFeed("OUT_OF_STOCK"), {}).stockSyncs).toEqual([]);
  });

  it("Webhallen: webblagret slut men butikerna har den ⇒ butiksvara = i lager i appen, ingen synk", () => {
    const r = derive(
      st({ [WH_KEY]: "IN_STOCK", [WH_STORE]: "IN_STOCK" }),
      whFeed({ status: "IN_STOCK", storeOnly: true, store: "IN_STOCK" })
    );
    expect(r.stockSyncs).toEqual([]);
  });

  it("Webhallen: sista butiken tömd ⇒ synk till OUT på den RIKTIGA URL:en, aldrig butiksspårets", () => {
    const r = derive(
      st({ [WH_KEY]: "OUT_OF_STOCK", [WH_STORE]: "IN_STOCK" }),
      whFeed({ status: "OUT_OF_STOCK", storeOnly: false, store: "OUT_OF_STOCK" })
    );
    expect(r.stockSyncs).toEqual([
      expect.objectContaining({ key: WH_KEY, storeUrl: WH_URL, to: "OUT_OF_STOCK" }),
    ]);
  });

  it("påfyllning som dämpas av cooldownen ⇒ synk TILLBAKA till i lager (appen ska inte stå kvar på Slut)", () => {
    const r = derive(st({ [SHOP_KEY]: "OUT_OF_STOCK" }, { [SHOP_KEY]: NOW.getTime() - 60_000 }), shopFeed("IN_STOCK"));
    expect(r.posts).toEqual([]);
    expect(r.stockSyncs).toEqual([expect.objectContaining({ key: SHOP_KEY, from: "OUT_OF_STOCK", to: "IN_STOCK" })]);
  });

  it("en postad påfyllning är ingen synk — larm-hiten bär läget", () => {
    const r = derive(st({ [SHOP_KEY]: "OUT_OF_STOCK" }), shopFeed("IN_STOCK"));
    expect(r.posts).toHaveLength(1);
    expect(r.stockSyncs).toEqual([]);
  });

  it("en ny URL (ABSENT) är ingen synk — auto-importen tar den", () => {
    expect(derive(st({ [SHOP_KEY]: "IN_STOCK" }), shopFeed("OUT_OF_STOCK", `${SHOP_URL}-2`)).stockSyncs).toEqual([]);
  });
});

const T = NOW.getTime();
const sync = (to: RestockHit["to"], at: number, key = SHOP_KEY): RestockHit =>
  hitsFromStockSyncs(
    [{ key, storeName: SHOP, storeUrl: key.split("\t")[1], from: "IN_STOCK", to, priceOre: null }],
    new Date(at)
  )[0];
const restock = (at: number): RestockHit => ({
  key: SHOP_KEY,
  kind: "RESTOCK",
  storeName: SHOP,
  storeUrl: SHOP_URL,
  cartUrl: null,
  productSlug: "30th-celebration-elite-trainer-box",
  title: null,
  priceOre: 89900,
  previousPriceOre: null,
  from: "OUT_OF_STOCK",
  to: "IN_STOCK",
  at,
});

describe("kön — synkar väcker aldrig Neon", () => {
  it("schemat tar emot en synk", () => {
    expect(restockHitSchema.parse(sync("OUT_OF_STOCK", T)).kind).toBe("STOCK_SYNC");
  });

  it("en synk per URL: slut och sedan tillbaka ⇒ bara det senaste läget", () => {
    const q = mergePendingHits([sync("OUT_OF_STOCK", T - 60_000)], [sync("IN_STOCK", T)], NOW);
    expect(q).toHaveLength(1);
    expect(q[0].to).toBe("IN_STOCK");
  });

  it("ett larm på samma URL gör en äldre (eller samtidig) synk inaktuell", () => {
    const q = mergePendingHits([sync("OUT_OF_STOCK", T - 60_000)], [restock(T)], NOW);
    expect(q.map((h) => h.kind)).toEqual(["RESTOCK"]);
    // En synk EFTER larmet (varan sålde slut igen) står kvar.
    expect(mergePendingHits([restock(T - 60_000)], [sync("OUT_OF_STOCK", T)], NOW)).toHaveLength(2);
  });

  it("synkar lever längre än larm (ett läge, ingen nyhet) men inte för evigt", () => {
    expect(mergePendingHits([sync("OUT_OF_STOCK", T - 3 * 3600_000)], [], NOW)).toHaveLength(1);
    expect(mergePendingHits([sync("OUT_OF_STOCK", T - STOCK_SYNC_TTL_MS - 1)], [], NOW)).toEqual([]);
  });

  it("splitHitBatch: bara synkar ⇒ inget brådskande, alltså inget anrop", () => {
    const s = splitHitBatch([sync("OUT_OF_STOCK", T)], () => "OUT_OF_STOCK");
    expect(s.urgent).toEqual([]);
    expect(s.syncs).toHaveLength(1);
  });

  it("splitHitBatch: en synk som motsägs av lanens senaste feedstatus är inaktuell", () => {
    const s = splitHitBatch([sync("OUT_OF_STOCK", T), restock(T)], () => "IN_STOCK");
    expect(s.urgent).toHaveLength(1);
    expect(s.syncs).toEqual([]);
    expect(s.stale).toHaveLength(1);
    // Okänd status (butiken inte hämtad än i jobbet) ⇒ skickas; appen vaktar tiden.
    expect(splitHitBatch([sync("OUT_OF_STOCK", T)], () => undefined).syncs).toHaveLength(1);
    // PREORDER och IN_STOCK är båda köpbara — ingen motsägelse.
    expect(splitHitBatch([sync("IN_STOCK", T)], () => "PREORDER").syncs).toHaveLength(1);
  });
});
