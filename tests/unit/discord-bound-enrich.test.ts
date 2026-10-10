/**
 * NYSS BUNDEN PRODUKT (2026-10-10): en helt ny butikssida postas utan rutt (ingen
 * produktlänk, inget marknadsvärde). Appen binder den i larm-hiten och svarar med
 * produktens data; lanen redigerar sitt inlägg. Card Havens 30th UPC:er 10-10 20:07.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applyBoundToPost,
  buildRestockEmbed,
  editRestockMessage,
  postRestocks,
  type DiscordRestockConfig,
  type RestockPost,
} from "@/lib/discord-restock";
import { parseBoundHits, sendRestockHits } from "@/lib/restock-hits";

const unrouted = (): RestockPost => ({
  key: "Card Haven\thttps://cardhaven.se/shop/pokemon/upc-umbreon",
  title: "Pokémon Mega: 30th Celebration Ultra Premium Collection Box – Night Umbreon",
  storeName: "Card Haven",
  storeUrl: "https://cardhaven.se/shop/pokemon/upc-umbreon",
  priceOre: 589900,
  imageUrl: null,
  setName: "30th Celebration",
  series: null,
  productUrl: null,
  productSlug: null,
  setUrl: "https://foilio.se/sets/30th-celebration",
  preorder: true,
});

const BOUND = {
  key: "Card Haven\thttps://cardhaven.se/shop/pokemon/upc-umbreon",
  slug: "30th-upc-umbreon",
  title: "30th Celebration Ultra Premium Collection Night Umbreon",
  setName: "30th Celebration",
  marketValueOre: 480198,
  soldMedianOre: null,
  soldCount: null,
};

const nb = (s: string | undefined) => s?.replace(/ /g, " ");

describe("applyBoundToPost", () => {
  it("ger inlägget produktlänk, katalogtitel, marknadsvärde och röd kant", () => {
    const before = buildRestockEmbed(unrouted());
    expect(before.fields.some((f) => f.name === "Hos oss")).toBe(true);
    expect(before.fields.some((f) => f.name === "Marknadsvärde")).toBe(false);

    const post = applyBoundToPost(unrouted(), BOUND, "https://foilio.se/");
    const after = buildRestockEmbed(post);
    expect(post.productUrl).toBe("https://foilio.se/produkter/30th-upc-umbreon");
    expect(after.title).toBe(BOUND.title);
    expect(after.fields.some((f) => f.name === "Hos oss")).toBe(false);
    expect(after.fields.find((f) => f.name === "Prishistorik")?.value).toContain("/produkter/30th-upc-umbreon");
    expect(nb(after.fields.find((f) => f.name === "Marknadsvärde")?.value)).toBe("4 801,98 kr · 23 % över");
    expect(after.color).toBe(0xef4444);
  });

  it("utan CM-värde: bara länken rättas, ingen färgdom", () => {
    const post = applyBoundToPost(unrouted(), { ...BOUND, marketValueOre: null }, "https://foilio.se");
    const e = buildRestockEmbed(post);
    expect(e.fields.some((f) => f.name === "Prishistorik")).toBe(true);
    expect(e.color).toBe(0x2dd4bf);
  });
});

describe("parseBoundHits", () => {
  it("släpper bara igenom fullständiga poster, tål äldre svar", () => {
    expect(parseBoundHits(undefined)).toEqual([]);
    expect(parseBoundHits([{ key: "k" }, null, "x", BOUND])).toEqual([BOUND]);
  });
});

describe("transport + redigering", () => {
  afterEach(() => vi.unstubAllGlobals());
  const config: DiscordRestockConfig = {
    botToken: "t",
    setChannels: {},
    seriesChannels: {},
    languageChannels: {},
    defaultChannelId: "ch-1",
    priceChannelId: null,
    storeChannelId: null,
    pro: null,
  };

  it("sendRestockHits bär appens `bound` vidare", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true, paused: false, received: 1, matched: 1, bound: [BOUND] }), { status: 200 })
    );
    const res = await sendRestockHits([], { baseUrl: "https://foilio.se", secret: "s", fetchImpl });
    expect(res.result?.bound).toEqual([BOUND]);
  });

  it("postRestocks returnerar meddelande-id:t, och redigeringen behåller tidsstämpeln", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: "msg-9" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const posted = await postRestocks([unrouted()], config);
    expect(posted.messages).toHaveLength(1);
    const msg = posted.messages[0];
    expect(msg).toMatchObject({ channelId: "ch-1", messageId: "msg-9", cart: false });

    applyBoundToPost(msg.posts[0], BOUND, "https://foilio.se");
    fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));
    expect(await editRestockMessage(msg, config)).toBe(true);
    const [url, init] = fetchMock.mock.calls.at(-1)!;
    expect(String(url)).toContain("/channels/ch-1/messages/msg-9");
    expect(init.method).toBe("PATCH");
    const body = JSON.parse(init.body as string);
    expect(body.embeds[0].timestamp).toBe(new Date(msg.at).toISOString());
    expect(body.embeds[0].fields.some((f: { name: string }) => f.name === "Marknadsvärde")).toBe(true);
  });

  it("en misslyckad redigering kastar aldrig", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("nät")));
    const msg = { channelId: "c", messageId: "m", posts: [unrouted()], cart: false, at: 0 };
    await expect(editRestockMessage(msg, config)).resolves.toBe(false);
  });
});
