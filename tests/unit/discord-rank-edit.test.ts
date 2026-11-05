import { describe, expect, it } from "vitest";
import {
  applyRankLevel,
  baseListingUrl,
  formatRankField,
  parseRankMemory,
  pruneRankMemory,
  rankLevelChanges,
  rememberRankPosts,
  RANK_MEMORY_DAYS,
  type RankMemory,
} from "@/lib/discord-rank-edit";
import { buildRestockEmbed, type PostedRestockMessage, type RestockPost } from "@/lib/discord-restock";
import { webhallenRankLevel } from "@/scrapers/adapters/webhallen-adapter";

const URL_A = "https://www.webhallen.com/se/product/401984";
const URL_B = "https://www.webhallen.com/se/product/401985";

function post(url: string, minRankLevel: number | null, extra: Partial<RestockPost> = {}): RestockPost {
  return {
    key: `Webhallen\t${url}`,
    title: "30th Celebration: Ditto Premium Collection",
    storeName: "Webhallen",
    storeUrl: url,
    priceOre: 89900,
    minRankLevel,
    ...extra,
  } as RestockPost;
}

function msg(id: string, posts: RestockPost[], cart = false): PostedRestockMessage {
  return { channelId: "c1", messageId: id, posts, cart, at: 1_000 };
}

function rankField(p: RestockPost): string | undefined {
  return buildRestockEmbed(p).fields.find((f: { name: string }) => f.name === "Kräver")?.value;
}

describe("nivåkravet följer butiken (Ditto 2026-11-03: postat 21+, sänkt till 9)", () => {
  it("minns publikt + Pro-inlägg för en vara med nivåkrav, ignorerar varor utan", () => {
    const mem: RankMemory = {};
    const a = post(URL_A, 21);
    const b = post(URL_B, null);
    rememberRankPosts(mem, [msg("m1", [a, b]), msg("m2", [a], true)], 5_000);
    expect(Object.keys(mem)).toEqual([URL_A]);
    expect(mem[URL_A]).toMatchObject({ lvl: 21, orig: 21, at: 5_000 });
    expect(mem[URL_A].msgs.map((m) => m.messageId)).toEqual(["m1", "m2"]);
  });

  it("en sänkning skriver om fältet till 'Nivå 9+ (sänkt från 21+)' på alla inläggets kopior", () => {
    const mem: RankMemory = {};
    const pub = post(URL_A, 21);
    const pro = post(URL_A, 21);
    const other = post(URL_B, 26);
    rememberRankPosts(mem, [msg("m1", [pub, other]), msg("m2", [pro], true)], 5_000);

    const changes = rankLevelChanges(mem, [{ url: URL_A, rankLevel: 9 }, { url: URL_B, rankLevel: 26 }]);
    expect(changes).toEqual([{ url: URL_A, from: 21, to: 9 }]);
    applyRankLevel(mem[URL_A], URL_A, 9);

    expect(rankField(pub)).toBe("Nivå 9+ (sänkt från 21+)");
    expect(rankField(pro)).toBe("Nivå 9+ (sänkt från 21+)");
    // Grannen i samma meddelande rörs inte.
    expect(rankField(other)).toBe("Nivå 26+");
    // Ingen ny ändring när nivån står still.
    expect(rankLevelChanges(mem, [{ url: URL_A, rankLevel: 9 }])).toEqual([]);
  });

  it("nivå 1 = alla får köpa", () => {
    const mem: RankMemory = {};
    const p = post(URL_A, 21);
    rememberRankPosts(mem, [msg("m1", [p])], 5_000);
    applyRankLevel(mem[URL_A], URL_A, 1);
    expect(rankField(p)).toBe("Alla (sänkt från Nivå 21+)");
  });

  it("en höjning visar den nya nivån utan 'sänkt från'", () => {
    const mem: RankMemory = {};
    const p = post(URL_A, 9);
    rememberRankPosts(mem, [msg("m1", [p])], 5_000);
    applyRankLevel(mem[URL_A], URL_A, 26);
    expect(rankField(p)).toBe("Nivå 26+");
  });

  it("⛔ okänt (inget live-svar) är aldrig en sänkning", () => {
    const mem: RankMemory = {};
    rememberRankPosts(mem, [msg("m1", [post(URL_A, 21)])], 5_000);
    expect(rankLevelChanges(mem, [{ url: URL_A }])).toEqual([]);
    expect(webhallenRankLevel({} as never)).toBeUndefined();
    expect(webhallenRankLevel({ minimumRankLevel: 1 } as never)).toBe(1);
    expect(webhallenRankLevel({ minimumRankLevel: 9 } as never)).toBe(9);
  });

  it("butiksspårets nycklar pekar på samma sida", () => {
    expect(baseListingUrl(`${URL_A}#butik`)).toBe(URL_A);
    expect(baseListingUrl(`${URL_A}#butik@15`)).toBe(URL_A);
    const mem: RankMemory = {};
    rememberRankPosts(mem, [msg("m1", [post(`${URL_A}#butik`, 21)])], 5_000);
    expect(rankLevelChanges(mem, [{ url: URL_A, rankLevel: 9 }])).toEqual([{ url: URL_A, from: 21, to: 9 }]);
  });

  it("ett nytt utskick om samma vara ersätter det gamla minnet", () => {
    const mem: RankMemory = {};
    rememberRankPosts(mem, [msg("m1", [post(URL_A, 21)])], 5_000);
    rememberRankPosts(mem, [msg("m9", [post(URL_A, 9)])], 9_000_000);
    expect(mem[URL_A]).toMatchObject({ lvl: 9, orig: 9 });
    expect(mem[URL_A].msgs.map((m) => m.messageId)).toEqual(["m9"]);
  });

  it("glömmer efter RANK_MEMORY_DAYS och tål en trasig fil", () => {
    const mem: RankMemory = {};
    rememberRankPosts(mem, [msg("m1", [post(URL_A, 21)])], 0);
    expect(pruneRankMemory(mem, (RANK_MEMORY_DAYS - 1) * 86_400_000)).toBe(false);
    expect(pruneRankMemory(mem, (RANK_MEMORY_DAYS + 1) * 86_400_000)).toBe(true);
    expect(mem).toEqual({});

    expect(parseRankMemory(null)).toEqual({});
    expect(parseRankMemory({ x: { lvl: "9" } })).toEqual({});
    const round = parseRankMemory(JSON.parse(JSON.stringify({ [URL_A]: { lvl: 21, orig: 21, at: 1, msgs: [msg("m1", [post(URL_A, 21)])] } })));
    expect(round[URL_A].msgs[0].messageId).toBe("m1");
  });

  it("formatRankField: inget fält när ingen nivå finns och inget sänkts", () => {
    expect(formatRankField({ minRankLevel: null, rankLevelWas: null })).toBeNull();
    expect(formatRankField({ minRankLevel: 9 })).toBe("Nivå 9+");
  });
});
