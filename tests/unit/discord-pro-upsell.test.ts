/**
 * BUTIKSFÖRDRÖJNINGEN I DISCORD (ägarbeslut 2026-11-23): butiksvaror går först till
 * Pro-butikskanalen (med ortspingar) och en kvart senare till den publika, med raden
 * "Pro-medlemmar fick larmet 15 min tidigare". Onlinekanalerna rörs inte.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildDelayedStoreMessage,
  buildRestockEmbed,
  cityRoleIdsFor,
  discordRestockConfig,
  firstPostChannelId,
  planDelayedStoreCopies,
  postRestocks,
  releaseDelayedStorePosts,
  resolveRestockChannelId,
  storeDelayActive,
  type DiscordRestockConfig,
  type RestockPost,
} from "@/lib/discord-restock";
import {
  FREE_STORE_ALERT_DELAY_MINUTES,
  FREE_STORE_ALERT_MAX_AGE_MINUTES,
  proHeadStartField,
  proUpsellComponents,
  withProHeadStart,
} from "@/lib/discord-pro-upsell";
import { publicRestockChannelIds } from "@/lib/discord-restock-ledger";
import { regionForCity } from "@/lib/store-city-regions";

const PUBLIC_STORES = "100";
const PRO_STORES = "200";

const config: DiscordRestockConfig = {
  botToken: "x",
  setChannels: { "30th celebration": "10" },
  seriesChannels: {},
  languageChannels: {},
  defaultChannelId: "1",
  priceChannelId: null,
  storeChannelId: PUBLIC_STORES,
  onePieceChannelId: null,
  pro: { setChannels: {}, seriesChannels: {}, languageChannels: {}, defaultChannelId: "2", storeChannelId: PRO_STORES },
  cityRoles: { göteborg: "r-gbg", stockholm: "r-sthlm" },
  proButton: "stores",
};

const storePost: RestockPost = {
  key: "SF-Bok\thttps://www.sfbok.se/x#butik",
  title: "30th Celebration Booster Bundle",
  storeName: "SF-Bok",
  storeUrl: "https://www.sfbok.se/x",
  priceOre: 39900,
  imageUrl: null,
  setName: "30th Celebration",
  series: null,
  productUrl: null,
  storeOnly: true,
  storeStock: {
    units: 12,
    stores: 2,
    capped: false,
    locations: [
      { id: "S030", label: "Göteborg", units: 9, capped: false, city: "Göteborg" },
      { id: "S010", label: "Stockholm", units: 3, capped: false, city: "Stockholm" },
    ],
  },
};

const onlinePost: RestockPost = { ...storePost, key: "k", storeOnly: false, storeStock: null };

describe("butiksfördröjningen — routing", () => {
  it("butiksvaror postas FÖRST i Pro-butikskanalen, onlinevaror som förut", () => {
    expect(storeDelayActive(config)).toBe(true);
    expect(firstPostChannelId(storePost, config)).toBe(PRO_STORES);
    expect(firstPostChannelId(onlinePost, config)).toBe(resolveRestockChannelId(onlinePost, config));
    expect(firstPostChannelId(onlinePost, config)).toBe("10");
  });

  it("⛔ en halv konfiguration fördröjer ingenting: utan Pro-butikskanal går butiksvaror direkt publikt", () => {
    const noPro = { ...config, pro: { ...config.pro!, storeChannelId: null } };
    expect(storeDelayActive(noPro)).toBe(false);
    expect(firstPostChannelId(storePost, noPro)).toBe(PUBLIC_STORES);
    const noPublic = { ...config, storeChannelId: null };
    expect(storeDelayActive(noPublic)).toBe(false);
    // Utan publik butikskanal routas butiksvaran som allt annat (setkanalen) — aldrig bara till Pro.
    expect(firstPostChannelId(storePost, noPublic)).toBe("10");
  });

  it("överlämningens liggare läser Pro-butikskanalen (där inlägget först står)", () => {
    expect(publicRestockChannelIds(config)).toContain(PRO_STORES);
    expect(publicRestockChannelIds({ ...config, pro: null })).not.toContain(PRO_STORES);
  });
});

describe("ortsrollerna", () => {
  it("förorter hör till sin stad; okänd ort hör ingenstans", () => {
    expect(regionForCity("Västra Frölunda")).toBe("Göteborg");
    expect(regionForCity("Upplands Väsby")).toBe("Stockholm");
    expect(regionForCity(" solna ")).toBe("Stockholm");
    expect(regionForCity("Malmö")).toBe("Malmö");
    expect(regionForCity("Kiruna")).toBeNull();
    expect(regionForCity(null)).toBeNull();
  });

  it("pingar bara orterna för butikerna som JUST fick saldo", () => {
    expect(cityRoleIdsFor({ ...storePost, newStoreIds: ["S030"] }, config)).toEqual(["r-gbg"]);
    expect(cityRoleIdsFor({ ...storePost, newStoreIds: ["S010"] }, config)).toEqual(["r-sthlm"]);
  });

  it("utan utpekade butiker: alla butiker med saldo, en roll per stad", () => {
    expect(cityRoleIdsFor(storePost, config)).toEqual(["r-gbg", "r-sthlm"]);
    const twoInGbg: RestockPost = {
      ...storePost,
      storeStock: {
        units: 5,
        stores: 2,
        capped: false,
        locations: [
          { id: "1", label: "Nordstan", units: 3, capped: false, city: "Göteborg" },
          { id: "2", label: "Frölunda Torg", units: 2, capped: false, city: "Västra Frölunda" },
        ],
      },
    };
    expect(cityRoleIdsFor(twoInGbg, config)).toEqual(["r-gbg"]);
  });

  it("⛔ ingen ping utan ort, utan roll för orten eller på en onlinevara", () => {
    const noCity: RestockPost = {
      ...storePost,
      storeStock: { units: 1, stores: 1, capped: false, locations: [{ id: "9", label: "Okänd", units: 1, capped: false }] },
    };
    expect(cityRoleIdsFor(noCity, config)).toEqual([]);
    expect(cityRoleIdsFor(storePost, { cityRoles: { malmö: "r-malmo" } })).toEqual([]);
    expect(cityRoleIdsFor(storePost, { cityRoles: {} })).toEqual([]);
    expect(cityRoleIdsFor({ ...onlinePost, storeStock: storePost.storeStock }, config)).toEqual([]);
  });
});

describe("den fördröjda kopian", () => {
  const NOW = Date.parse("2026-11-23T12:00:00.000Z");
  const minutesAgo = (m: number) => new Date(NOW - m * 60_000).toISOString();
  /** Pro-inlägget som Discord returnerar det (med fält vi inte skickar tillbaka). */
  const proMessage = (id: string, ageMin: number, post: RestockPost = storePost) => {
    const at = NOW - ageMin * 60_000;
    return {
      id,
      timestamp: minutesAgo(ageMin),
      author: { bot: true },
      content: "<@&r-gbg>",
      embeds: [{ ...buildRestockEmbed(post, { at }), type: "rich", thumbnail: { url: "https://x/y.png", proxy_url: "https://proxy" } }],
    };
  };

  it("texten bär konstantens tal", () => {
    expect(FREE_STORE_ALERT_DELAY_MINUTES).toBe(15);
    expect(proHeadStartField(PRO_STORES).value).toBe("Pro-medlemmar fick larmet 15 min tidigare i <#200>.");
    expect(proHeadStartField(null).value).toBe("Pro-medlemmar fick larmet 15 min tidigare.");
  });

  it("kopieras först efter 15 min, och inte alls efter maxåldern", () => {
    expect(planDelayedStoreCopies([proMessage("a", 14)], [], NOW)).toEqual([]);
    expect(planDelayedStoreCopies([proMessage("a", 15)], [], NOW).map((c) => c.proMessageId)).toEqual(["a"]);
    expect(planDelayedStoreCopies([proMessage("a", FREE_STORE_ALERT_MAX_AGE_MINUTES + 1)], [], NOW)).toEqual([]);
  });

  it("äldst först, och det som redan kopierats i det här jobbet hoppas över", () => {
    const plan = planDelayedStoreCopies([proMessage("ny", 16), proMessage("gammal", 30)], [], NOW, new Set(["x"]));
    expect(plan.map((c) => c.proMessageId)).toEqual(["gammal", "ny"]);
    expect(planDelayedStoreCopies([proMessage("a", 20)], [], NOW, new Set(["a"]))).toEqual([]);
  });

  it("⛔ dubblettskyddet är den publika kanalens historik (jobbytet): samma länk + samma tidsstämpel = redan kopierad", () => {
    const pro = proMessage("a", 20);
    const [copy] = planDelayedStoreCopies([pro], [], NOW);
    const publicCopy = { id: "p1", timestamp: minutesAgo(5), author: { bot: true }, ...buildDelayedStoreMessage(copy, config, "https://scoutr.se") };
    expect(planDelayedStoreCopies([pro], [publicCopy], NOW)).toEqual([]);
  });

  it("⛔ samma vara påfylld i en ANDRA butik inom kvarten är ett eget inlägg — den första kopian blockerar inte", () => {
    const first = proMessage("a", 25);
    const second = proMessage("b", 18);
    const [copyA] = planDelayedStoreCopies([first], [], NOW);
    const publicA = { id: "p1", timestamp: minutesAgo(10), ...buildDelayedStoreMessage(copyA, config, "https://scoutr.se") };
    expect(planDelayedStoreCopies([second, first], [publicA], NOW).map((c) => c.proMessageId)).toEqual(["b"]);
  });

  it("bara botens butiksinlägg kopieras — aldrig en människas meddelande eller ett onlineinlägg", () => {
    const human = { ...proMessage("h", 20), author: { bot: false } };
    const online = proMessage("o", 20, onlinePost);
    expect(planDelayedStoreCopies([human, online, { id: "t", timestamp: minutesAgo(20), author: { bot: true }, embeds: [] }], [], NOW)).toEqual([]);
    expect(planDelayedStoreCopies("trasigt", [], NOW)).toEqual([]);
  });

  it("kopian bär Pro-raden före appraden, ingen ping, och knappen när den är påslagen", () => {
    const [copy] = planDelayedStoreCopies([proMessage("a", 20)], [], NOW);
    const msg = buildDelayedStoreMessage(copy, config, "https://scoutr.se");
    const names = msg.embeds[0].fields.map((f) => f.name);
    expect(names.indexOf("Scoutr Pro")).toBe(names.indexOf("Ladda ner Scoutr") - 1);
    expect(msg.embeds[0].fields.find((f) => f.name === "Scoutr Pro")?.value).toContain(`${FREE_STORE_ALERT_DELAY_MINUTES} min tidigare`);
    expect(msg.embeds[0].thumbnail).toEqual({ url: "https://x/y.png" });
    expect(msg.embeds[0].title).toBe("Finns bara i butik: 30th Celebration Booster Bundle");
    expect(msg).not.toHaveProperty("content");
    expect(msg.allowed_mentions).toEqual({ parse: [] });
    expect(msg.components).toEqual(proUpsellComponents("https://scoutr.se"));
    expect(msg.components?.[0].components[0].url).toBe("https://scoutr.se/priser");
    expect(buildDelayedStoreMessage(copy, { ...config, proButton: null }, "https://scoutr.se")).not.toHaveProperty("components");
  });

  it("Pro-raden läggs aldrig två gånger", () => {
    const embed = buildRestockEmbed(storePost);
    const once = withProHeadStart(embed, PRO_STORES);
    expect(withProHeadStart(once, PRO_STORES).fields.filter((f) => f.name === "Scoutr Pro")).toHaveLength(1);
  });
});

describe("konfigurationen", () => {
  const withEnv = (channels: unknown, fn: () => void) => {
    const prev = { e: process.env.DISCORD_RESTOCK_ENABLED, t: process.env.DISCORD_BOT_TOKEN, c: process.env.DISCORD_RESTOCK_CHANNELS };
    process.env.DISCORD_RESTOCK_ENABLED = "true";
    process.env.DISCORD_BOT_TOKEN = "x";
    process.env.DISCORD_RESTOCK_CHANNELS = JSON.stringify(channels);
    try {
      fn();
    } finally {
      process.env.DISCORD_RESTOCK_ENABLED = prev.e;
      process.env.DISCORD_BOT_TOKEN = prev.t;
      process.env.DISCORD_RESTOCK_CHANNELS = prev.c;
    }
  };

  it("läser pro.stores, cityRoles (skiftlägesokänsligt) och proButton", () => {
    withEnv(
      { default: "1", stores: "100", pro: { default: "2", stores: "200" }, cityRoles: { Göteborg: "r1" }, proButton: "all" },
      () => {
        const c = discordRestockConfig()!;
        expect(c.pro?.storeChannelId).toBe("200");
        expect(storeDelayActive(c)).toBe(true);
        expect(c.cityRoles).toEqual({ göteborg: "r1" });
        expect(c.proButton).toBe("all");
      }
    );
  });

  it("⛔ dagens konfiguration (utan de nya nycklarna) är oförändrad: ingen fördröjning, inga pingar, ingen knapp", () => {
    withEnv({ default: "1", stores: "100", pro: { default: "2" } }, () => {
      const c = discordRestockConfig()!;
      expect(storeDelayActive(c)).toBe(false);
      expect(c.cityRoles).toEqual({});
      expect(c.proButton).toBeNull();
      expect(firstPostChannelId(storePost, c)).toBe("100");
    });
    withEnv({ default: "1", proButton: "ja" }, () => expect(discordRestockConfig()!.proButton).toBeNull());
  });
});

describe("utskicket (Discord mockad)", () => {
  afterEach(() => vi.unstubAllGlobals());

  /** Fångar varje anrop; GET svarar med `history[kanal]`, POST med ett meddelande-id. */
  const stubDiscord = (history: Record<string, unknown[]> = {}) => {
    const calls: { method: string; channel: string; body: any }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: unknown, init?: RequestInit) => {
        const url = String(input);
        const channel = /channels\/(\d+)\/messages/.exec(url)?.[1] ?? "";
        const method = init?.method ?? "GET";
        calls.push({ method, channel, body: init?.body ? JSON.parse(String(init.body)) : null });
        const payload = method === "GET" ? (history[channel] ?? []) : { id: `m${calls.length}` };
        return new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });
      })
    );
    return calls;
  };

  it("butiksvaran går BARA till Pro-butikskanalen, med ortspingen; onlinevaran går publikt + Pro-spegeln utan ping", async () => {
    const calls = stubDiscord();
    const res = await postRestocks([{ ...storePost, newStoreIds: ["S030"] }, onlinePost], config);
    expect(res.failed).toBe(0);
    expect(res.postedKeys).toEqual(expect.arrayContaining([storePost.key, onlinePost.key]));
    const posts = calls.filter((c) => c.method === "POST");
    expect(posts.map((c) => c.channel).sort()).toEqual(["10", "2", PRO_STORES].sort());
    expect(posts.some((c) => c.channel === PUBLIC_STORES)).toBe(false);
    const store = posts.find((c) => c.channel === PRO_STORES)!;
    expect(store.body.content).toBe("<@&r-gbg>");
    expect(store.body.allowed_mentions).toEqual({ parse: [], roles: ["r-gbg"] });
    expect(store.body).not.toHaveProperty("components");
    const online = posts.find((c) => c.channel === "10")!;
    expect(online.body).not.toHaveProperty("content");
    // proButton "stores" ⇒ ingen knapp på onlineinlägg.
    expect(online.body).not.toHaveProperty("components");
  });

  it('proButton "all" ⇒ knappen även under publika onlineinlägg, aldrig i Pro-kanalerna', async () => {
    const calls = stubDiscord();
    await postRestocks([storePost, onlinePost], { ...config, proButton: "all" });
    const posts = calls.filter((c) => c.method === "POST");
    expect(posts.find((c) => c.channel === "10")!.body.components?.[0].components[0].label).toBe("Skaffa Pro");
    expect(posts.find((c) => c.channel === PRO_STORES)!.body).not.toHaveProperty("components");
    expect(posts.find((c) => c.channel === "2")!.body).not.toHaveProperty("components");
  });

  it("den mogna kopian postas i den publika kanalen en gång, och inte igen", async () => {
    const now = Date.parse("2026-11-23T12:00:00.000Z");
    const at = now - 20 * 60_000;
    const proMsg = { id: "a", timestamp: new Date(at).toISOString(), author: { bot: true }, embeds: [buildRestockEmbed(storePost, { at })] };
    const calls = stubDiscord({ [PRO_STORES]: [proMsg], [PUBLIC_STORES]: [] });
    const done = new Set<string>();
    const first = await releaseDelayedStorePosts(config, done, now);
    expect(first).toEqual({ sent: 1, failedIds: [], readFailed: false });
    const sent = calls.filter((c) => c.method === "POST");
    expect(sent).toHaveLength(1);
    expect(sent[0].channel).toBe(PUBLIC_STORES);
    expect(sent[0].body.embeds[0].fields.some((f: { name: string }) => f.name === "Scoutr Pro")).toBe(true);
    expect(sent[0].body).not.toHaveProperty("content");
    expect(await releaseDelayedStorePosts(config, done, now)).toEqual({ sent: 0, failedIds: [], readFailed: false });
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(1);
  });

  it("inget moget ⇒ den publika kanalen läses inte ens; fördröjningen av ⇒ inga anrop alls", async () => {
    const now = Date.parse("2026-11-23T12:00:00.000Z");
    const young = { id: "a", timestamp: new Date(now - 60_000).toISOString(), author: { bot: true }, embeds: [buildRestockEmbed(storePost, { at: now - 60_000 })] };
    const calls = stubDiscord({ [PRO_STORES]: [young] });
    await releaseDelayedStorePosts(config, new Set(), now);
    expect(calls.map((c) => c.channel)).toEqual([PRO_STORES]);
    calls.length = 0;
    await releaseDelayedStorePosts({ ...config, storeChannelId: null }, new Set(), now);
    expect(calls).toHaveLength(0);
  });
});
