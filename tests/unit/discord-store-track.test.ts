/**
 * BUTIKSSPÅRET (ägarbeslut 2026-09-23): online och fysisk butik är TVÅ spår i
 * Discord-lanen. Webhallen fyllde på 30th Celebration i webblagret OCH i butikerna
 * samtidigt, men annonsen hade EN status ⇒ bara onlineinlägget gick ut och
 * butikskanalen teg.
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
import { buildRestockEmbed, resolveRestockChannelId } from "@/lib/discord-restock";
import { hitsFromPosts } from "@/lib/restock-hits";
import type { FlapPolicy } from "@/lib/stock-flap";

const POLICY: FlapPolicy = { minAwayMinutes: 20, flapMaxTransitions: 6, flapCooldownHours: 24 };
const NOW = new Date("2026-09-23T09:20:00Z");
const URL = "https://www.webhallen.com/se/product/401998";
const SRC = "Webhallen";
const MAIN = `${SRC}\t${URL}`;
const STORE = `${MAIN}${STORE_TRACK_SUFFIX}`;
const ROUTES: RouteTable = {
  [URL]: {
    title: "30th Celebration Greninja ex Box",
    slug: "30th-celebration-greninja-ex-box",
    setName: "30th Celebration",
    series: "Mega Evolution",
    language: "EN",
  },
};
const FILTER = buildDiscordFilterContext({ routes: ROUTES, setNames: ["30th Celebration"] });

type S = "IN_STOCK" | "OUT_OF_STOCK" | "PREORDER";
function feed(o: { status: S; storeOnly?: boolean; store?: S | null; units?: number }): FullFeedGroup[] {
  return [
    {
      sourceName: SRC,
      items: [
        {
          url: URL,
          stockStatus: o.status,
          title: "Pokemon 30th Celebration Greninja Ex Box",
          price: 34900,
          imageUrl: null,
          category: "BOX",
          storeOnly: o.storeOnly ?? false,
          storeStock: { units: o.units ?? 0, stores: o.units ? 2 : 0, capped: false },
          ...(o.store === null ? {} : { storeStatus: o.store ?? "OUT_OF_STOCK" }),
        },
      ],
    },
  ];
}

function derive(state: DiscordRestockState, groups: FullFeedGroup[]) {
  return deriveRestockPosts({
    state,
    groups,
    rotating: new Set(),
    routes: ROUTES,
    filter: FILTER,
    now: NOW,
    policy: POLICY,
    cooldownHours: 0.25,
    baseUrl: "https://foilio.se",
    priceDrops: null,
  });
}

const st = (stock: Record<string, string>): DiscordRestockState => ({
  stock,
  history: {},
  posted: {},
});

describe("butiksspåret i Discord-lanen", () => {
  it("påfyllning online OCH i butik ⇒ ETT inlägg per kanal", () => {
    const { posts } = derive(
      st({ [MAIN]: "OUT_OF_STOCK", [STORE]: "OUT_OF_STOCK" }),
      feed({ status: "IN_STOCK", store: "IN_STOCK", units: 13 })
    );
    expect(posts.map((p) => p.key).sort()).toEqual([MAIN, STORE].sort());
    const online = posts.find((p) => p.key === MAIN)!;
    const store = posts.find((p) => p.key === STORE)!;
    expect(online.storeOnly).toBe(false);
    expect(store.storeOnly).toBe(true);
    // Butiksinlägget länkar till den RIKTIGA annonsen och bär rutten.
    expect(store.storeUrl).toBe(URL);
    expect(store.productSlug).toBe("30th-celebration-greninja-ex-box");
    expect(store.storeStock?.units).toBe(13);
    expect(store.cartUrl ?? null).toBeNull();
    // Kanalerna: butikskanalen tar bara butiksinlägget.
    const cfg = {
      setChannels: {},
      seriesChannels: {},
      languageChannels: {},
      defaultChannelId: "online",
      storeChannelId: "stores",
    } as Parameters<typeof resolveRestockChannelId>[1];
    expect(resolveRestockChannelId(online, cfg)).toBe("online");
    expect(resolveRestockChannelId(store, cfg)).toBe("stores");
    // Copyn: varan går ÄVEN att beställa — "bara i butik" vore fel.
    const embed = buildRestockEmbed(store);
    expect(embed.title).toBe("Finns i butik: 30th Celebration Greninja ex Box");
    expect(embed.description).toContain("Går även att beställa i webbutiken");
    // ETT larm till appen, inte två.
    expect(hitsFromPosts(posts, NOW).map((h) => h.key)).toEqual([MAIN]);
  });

  it("bara butikerna fylls på (webben slut) ⇒ bara butiksinlägget, med hit", () => {
    const { posts } = derive(
      st({ [MAIN]: "OUT_OF_STOCK", [STORE]: "OUT_OF_STOCK" }),
      feed({ status: "IN_STOCK", storeOnly: true, store: "IN_STOCK", units: 20 })
    );
    expect(posts.map((p) => p.key)).toEqual([STORE]);
    expect(posts[0].alsoOnline).toBeUndefined();
    expect(buildRestockEmbed(posts[0]).title).toMatch(/^Finns bara i butik:/);
    expect(hitsFromPosts(posts, NOW)).toHaveLength(1);
  });

  it("butikerna fylls på medan webben redan har varan ⇒ butiksinlägg, INGEN hit", () => {
    const { posts } = derive(
      st({ [MAIN]: "IN_STOCK", [STORE]: "OUT_OF_STOCK" }),
      feed({ status: "IN_STOCK", store: "IN_STOCK", units: 5 })
    );
    expect(posts.map((p) => p.key)).toEqual([STORE]);
    expect(posts[0].alsoOnline).toBe(true);
    expect(hitsFromPosts(posts, NOW)).toHaveLength(0);
  });

  it("webben fylls på för en vara som stått i butik ⇒ onlineinlägget", () => {
    const { posts } = derive(
      st({ [MAIN]: "OUT_OF_STOCK", [STORE]: "IN_STOCK" }),
      feed({ status: "IN_STOCK", store: "IN_STOCK", units: 40 })
    );
    expect(posts.map((p) => p.key)).toEqual([MAIN]);
  });

  it("⛔ en butiksvara räknas som SLUT i onlinespåret — ingen online-restock om den", () => {
    const { posts, nextState } = derive(
      st({ [MAIN]: "OUT_OF_STOCK", [STORE]: "OUT_OF_STOCK" }),
      feed({ status: "IN_STOCK", storeOnly: true, store: "IN_STOCK", units: 3 })
    );
    expect(posts.some((p) => p.key === MAIN)).toBe(false);
    expect(nextState.stock[MAIN]).toBe("OUT_OF_STOCK");
  });

  it("⛔ första varvet efter deployen seedar butiksspåret TYST", () => {
    // Gammal state: bara huvudnyckeln (butiksvaran stod där som IN_STOCK).
    const first = derive(
      st({ [MAIN]: "IN_STOCK" }),
      feed({ status: "IN_STOCK", storeOnly: true, store: "IN_STOCK", units: 300 })
    );
    expect(first.posts).toHaveLength(0);
    expect(first.nextState.stock[STORE]).toBe("IN_STOCK");
    // Därefter diffas spåret som vanligt.
    const sold = derive(first.nextState, feed({ status: "OUT_OF_STOCK", store: "OUT_OF_STOCK" }));
    expect(sold.posts).toHaveLength(0);
    const back = derive(
      { ...sold.nextState, history: {} },
      feed({ status: "IN_STOCK", storeOnly: true, store: "IN_STOCK", units: 8 })
    );
    expect(back.posts.map((p) => p.key)).toEqual([STORE]);
  });

  it("källor utan butiksspår är orörda", () => {
    const { posts, nextState } = derive(
      st({ [MAIN]: "OUT_OF_STOCK" }),
      feed({ status: "IN_STOCK", store: null })
    );
    expect(posts.map((p) => p.key)).toEqual([MAIN]);
    expect(Object.keys(nextState.stock)).toEqual([MAIN]);
  });
});
