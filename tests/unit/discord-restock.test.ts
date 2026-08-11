/**
 * Tester för Discord-snabbfilens RENA delar: kanalvalet och domen om vad som ska
 * postas. Ingen DB, inga nätanrop — precis som lanen själv.
 *
 * De två fall som MÅSTE hålla är seedningen och flapp-dämpningen: brister den första
 * postas hela sortimentet på en gång, brister den andra spammar Dragon's Lair kanalen
 * sönder. Båda felen är tysta i produktion.
 */
import { describe, expect, it } from "vitest";
import { chunk, resolveChannelId, buildRestockEmbed } from "@/lib/discord-restock";
import {
  deriveRestockPosts,
  markPosted,
  type DiscordRestockState,
  type FullFeedGroup,
  type RouteTable,
} from "@/lib/restock-feed-events";
import type { FlapPolicy } from "@/lib/stock-flap";

const POLICY: FlapPolicy = { minAwayMinutes: 20, flapMaxTransitions: 6, flapCooldownHours: 24 };
const NOW = new Date("2026-08-11T12:00:00Z");
const BASE = "https://www.foilio.se";

const ROUTES: RouteTable = {
  "https://butik.se/pitch-black-etb": {
    title: "Pitch Black Elite Trainer Box",
    slug: "pitch-black-elite-trainer-box",
    setName: "Pitch Black",
    series: "Mega Evolution",
  },
  "https://butik.se/prismatic-etb": {
    title: "Prismatic Evolutions Elite Trainer Box",
    slug: "prismatic-evolutions-etb",
    setName: "Prismatic Evolutions",
    series: "Scarlet & Violet",
  },
};

function groups(items: { url: string; stockStatus: string }[], sourceName = "Dragon's Lair"): FullFeedGroup[] {
  return [
    {
      sourceName,
      items: items.map((i) => ({
        url: i.url,
        stockStatus: i.stockStatus as FullFeedGroup["items"][number]["stockStatus"],
        title: "Butikens titel",
        price: 54900,
        imageUrl: null,
      })),
    },
  ];
}

function state(partial: Partial<DiscordRestockState>): DiscordRestockState {
  return { stock: {}, history: {}, posted: {}, ...partial };
}

function derive(opts: {
  state: DiscordRestockState | null;
  groups: FullFeedGroup[];
  rotating?: Set<string>;
  now?: Date;
}) {
  return deriveRestockPosts({
    state: opts.state,
    groups: opts.groups,
    rotating: opts.rotating ?? new Set(),
    routes: ROUTES,
    now: opts.now ?? NOW,
    policy: POLICY,
    cooldownHours: 2,
    baseUrl: BASE,
  });
}

const KEY = "Dragon's Lair\thttps://butik.se/pitch-black-etb";

describe("resolveChannelId", () => {
  const config = {
    seriesChannels: { "mega evolution": "111", "scarlet & violet": "222" },
    defaultChannelId: "999",
  };

  it("väljer seriekanalen, skiftlägesokänsligt", () => {
    expect(resolveChannelId("Mega Evolution", config)).toBe("111");
    expect(resolveChannelId("  mega evolution ", config)).toBe("111");
  });

  it("faller tillbaka på catch-all för okänd eller saknad serie", () => {
    expect(resolveChannelId("Sword & Shield", config)).toBe("999");
    expect(resolveChannelId(null, config)).toBe("999");
  });

  it("FAIL CLOSED: utan catch-all postas inget alls hellre än i fel kanal", () => {
    expect(resolveChannelId("Okänd", { ...config, defaultChannelId: null })).toBeNull();
    expect(resolveChannelId(null, { ...config, defaultChannelId: null })).toBeNull();
  });
});

describe("deriveRestockPosts", () => {
  it("SEEDAR utan att posta när ingen tidigare state finns", () => {
    const r = derive({
      state: null,
      groups: groups([{ url: "https://butik.se/pitch-black-etb", stockStatus: "IN_STOCK" }]),
    });
    expect(r.posts).toHaveLength(0);
    expect(r.stats.seeded).toBe(true);
    // Lagerläget måste ändå sparas, annars seedar nästa körning om i evighet.
    expect(r.nextState.stock[KEY]).toBe("IN_STOCK");
  });

  it("postar en påfyllning (OUT → IN) på en känd URL", () => {
    const r = derive({
      state: state({ stock: { [KEY]: "OUT_OF_STOCK" } }),
      groups: groups([{ url: "https://butik.se/pitch-black-etb", stockStatus: "IN_STOCK" }]),
    });
    expect(r.posts).toHaveLength(1);
    expect(r.posts[0]).toMatchObject({
      title: "Pitch Black Elite Trainer Box", // katalogens titel, inte butikens fras
      storeName: "Dragon's Lair",
      series: "Mega Evolution",
      priceOre: 54900,
      productUrl: `${BASE}/produkter/pitch-black-elite-trainer-box`,
    });
  });

  it("postar INTE en slutförsäljning", () => {
    const r = derive({
      state: state({ stock: { [KEY]: "IN_STOCK" } }),
      groups: groups([{ url: "https://butik.se/pitch-black-etb", stockStatus: "OUT_OF_STOCK" }]),
    });
    expect(r.posts).toHaveLength(0);
  });

  it("hoppar över URL:er som saknas i ruttabellen (kan vara sleeves/singlar)", () => {
    const key = "Dragon's Lair\thttps://butik.se/kartongfodral";
    const r = derive({
      state: state({ stock: { [key]: "OUT_OF_STOCK" } }),
      groups: groups([{ url: "https://butik.se/kartongfodral", stockStatus: "IN_STOCK" }]),
    });
    expect(r.posts).toHaveLength(0);
    expect(r.stats.skippedUnknownUrl).toBe(1);
  });

  it("BLINK: tillbaka i lager inom 20 min efter att ha lämnat lagret → inget larm", () => {
    const r = derive({
      state: state({
        stock: { [KEY]: "OUT_OF_STOCK" },
        // Lämnade IN_STOCK för 5 minuter sedan → har aldrig varit borta på riktigt.
        history: { [KEY]: [{ o: "IN_STOCK", t: NOW.getTime() - 5 * 60_000 }] },
      }),
      groups: groups([{ url: "https://butik.se/pitch-black-etb", stockStatus: "IN_STOCK" }]),
    });
    expect(r.posts).toHaveLength(0);
    expect(r.stats.skippedFlap).toBe(1);
  });

  it("ÄKTA påfyllning (borta > 20 min) larmar", () => {
    const r = derive({
      state: state({
        stock: { [KEY]: "OUT_OF_STOCK" },
        history: { [KEY]: [{ o: "IN_STOCK", t: NOW.getTime() - 90 * 60_000 }] },
      }),
      groups: groups([{ url: "https://butik.se/pitch-black-etb", stockStatus: "IN_STOCK" }]),
    });
    expect(r.posts).toHaveLength(1);
  });

  it("COOLDOWN: samma vara postas inte igen inom två timmar", () => {
    const r = derive({
      state: state({
        stock: { [KEY]: "OUT_OF_STOCK" },
        posted: { [KEY]: NOW.getTime() - 30 * 60_000 },
      }),
      groups: groups([{ url: "https://butik.se/pitch-black-etb", stockStatus: "IN_STOCK" }]),
    });
    expect(r.posts).toHaveLength(0);
    expect(r.stats.skippedCooldown).toBe(1);
  });

  it("FLAPP: fler än 6 övergångar på ett dygn förlänger cooldownen till ett dygn", () => {
    const history = Array.from({ length: 7 }, (_, i) => ({
      o: "IN_STOCK",
      t: NOW.getTime() - (i + 1) * 60 * 60_000, // 1–7 h sedan, alla utanför blink-fönstret
    }));
    const r = derive({
      state: state({
        stock: { [KEY]: "OUT_OF_STOCK" },
        history: { [KEY]: history },
        posted: { [KEY]: NOW.getTime() - 5 * 3600_000 }, // 5 h sedan: över 2h men under 24h
      }),
      groups: groups([{ url: "https://butik.se/pitch-black-etb", stockStatus: "IN_STOCK" }]),
    });
    expect(r.posts).toHaveLength(0);
    expect(r.stats.skippedCooldown).toBe(1);
  });

  it("stämplar INTE cooldown vid beslutet — bara markPosted får göra det", () => {
    // Annars tystas produkten i två timmar när Discord svarade med ett fel, dvs
    // precis när larmet aldrig kom fram.
    const r = derive({
      state: state({ stock: { [KEY]: "OUT_OF_STOCK" } }),
      groups: groups([{ url: "https://butik.se/pitch-black-etb", stockStatus: "IN_STOCK" }]),
    });
    expect(r.posts).toHaveLength(1);
    expect(r.nextState.posted[KEY]).toBeUndefined();

    const after = markPosted(r.nextState, r.posts.map((p) => p.key), NOW);
    expect(after.posted[KEY]).toBe(NOW.getTime());
  });

  it("markPosted rensar stämplar äldre än dygnsfönstret", () => {
    const old = { stock: {}, history: {}, posted: { gammal: NOW.getTime() - 30 * 3600_000 } };
    expect(markPosted(old, [], NOW).posted).toEqual({});
  });

  it("TOM FEED raderar inte butikens minne (annars blir allt 'nytt' nästa körning)", () => {
    const prev = state({ stock: { [KEY]: "IN_STOCK" } });
    const r = derive({ state: prev, groups: groups([]) });
    expect(r.posts).toHaveLength(0);
    expect(r.nextState.stock[KEY]).toBe("IN_STOCK");
  });

  it("ROTERANDE butik: en URL som dyker upp i lager är rotation, inte en påfyllning", () => {
    const r = derive({
      // Icke-tom state (annars seedar den) men URL:en är ny.
      state: state({ stock: { "Swepoke\thttps://butik.se/annat": "IN_STOCK" } }),
      groups: groups([{ url: "https://butik.se/pitch-black-etb", stockStatus: "IN_STOCK" }], "Swepoke"),
      rotating: new Set(["Swepoke"]),
    });
    expect(r.posts).toHaveLength(0);
  });
});

describe("buildRestockEmbed", () => {
  const post = {
    key: KEY,
    title: "Pitch Black Elite Trainer Box",
    storeName: "Dragon's Lair",
    storeUrl: "https://butik.se/pitch-black-etb",
    priceOre: 54900,
    imageUrl: null,
    setName: "Pitch Black",
    series: "Mega Evolution",
    productUrl: `${BASE}/produkter/pitch-black-elite-trainer-box`,
  };

  it("länkar till BUTIKEN i rubriken — den som får larmet ska kunna köpa direkt", () => {
    expect(buildRestockEmbed(post).url).toBe("https://butik.se/pitch-black-etb");
  });

  it("tar med pris, butik, set och en länk till vår produktsida", () => {
    const fields = buildRestockEmbed(post).fields;
    expect(fields.find((f) => f.name === "Butik")?.value).toBe("Dragon's Lair");
    expect(fields.find((f) => f.name === "Pris")?.value).toContain("549");
    expect(fields.find((f) => f.name === "Set")?.value).toBe("Pitch Black");
    expect(fields.find((f) => f.name === "Prishistorik")?.value).toContain(post.productUrl);
  });

  it("kapar titlar över Discords 256-teckensgräns (annars 400 → HELA batchen tappas)", () => {
    const embed = buildRestockEmbed({ ...post, title: "x".repeat(400) });
    expect(embed.title.length).toBeLessThanOrEqual(256);
  });

  it("skriver egen rubriktext för förhandsbokning — det är ett annat besked", () => {
    expect(buildRestockEmbed({ ...post, preorder: true }).description).toContain("förhandsboka");
  });
});

describe("chunk", () => {
  it("delar i bitar om högst tio (Discords tak per inlägg)", () => {
    expect(chunk(Array.from({ length: 23 }, (_, i) => i), 10).map((c) => c.length)).toEqual([10, 10, 3]);
    expect(chunk([], 10)).toEqual([]);
  });
});
