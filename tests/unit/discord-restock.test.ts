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
  parseDiscordRestockState,
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
    language: "EN",
    imageUrl: "https://cdn.foilio.se/pitch-black-etb.jpg",
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
    setChannels: { "prismatic evolutions": "777" },
    seriesChannels: { "mega evolution": "111", "scarlet & violet": "222" },
    languageChannels: {} as Record<string, string>,
    defaultChannelId: "999",
  };

  it("SET vinner över SERIE — annars kan en setkanal aldrig ta emot något", () => {
    // Prismatic Evolutions ligger i serien Scarlet & Violet, som har egen kanal (222).
    expect(resolveChannelId("Prismatic Evolutions", "Scarlet & Violet", config)).toBe("777");
  });

  it("väljer seriekanalen när setet saknar egen kanal", () => {
    expect(resolveChannelId("Surging Sparks", "Scarlet & Violet", config)).toBe("222");
    expect(resolveChannelId(null, "Mega Evolution", config)).toBe("111");
  });

  it("matchar skiftlägesokänsligt och utan kantmellanslag", () => {
    expect(resolveChannelId("  prismatic evolutions ", null, config)).toBe("777");
    expect(resolveChannelId(null, "  MEGA EVOLUTION", config)).toBe("111");
  });

  it("faller tillbaka på catch-all för okänt set och okänd serie", () => {
    expect(resolveChannelId("Silver Tempest", "Sword & Shield", config)).toBe("999");
    expect(resolveChannelId(null, null, config)).toBe("999");
  });

  it("FAIL CLOSED: utan catch-all postas inget alls hellre än i fel kanal", () => {
    expect(resolveChannelId("Okänd", "Okänd", { ...config, defaultChannelId: null })).toBeNull();
    expect(resolveChannelId(null, null, { ...config, defaultChannelId: null })).toBeNull();
  });

  // Mätt 2026-08-12: japanska set bär samma latinska serienamn som de engelska
  // ("Ninja Spinner (M4)" har serien "Mega Evolution") → fyra JP-boxar hamnade i
  // EN-seriekanalen. Språket måste därför spärra set-/serieuppslaget helt.
  it("JAPANSKA produkter går ALDRIG till set-/seriekanalerna", () => {
    expect(resolveChannelId("Ninja Spinner", "Mega Evolution", config, "JP")).toBe("999");
  });

  it("japanska produkter tar språkkanalen när den finns", () => {
    const withJp = { ...config, languageChannels: { jp: "555" } };
    expect(resolveChannelId("Ninja Spinner", "Mega Evolution", withJp, "JP")).toBe("555");
  });

  it("saknat språk (äldre ruttabell) tolkas som engelska — oförändrad routing", () => {
    expect(resolveChannelId("Prismatic Evolutions", "Scarlet & Violet", config, null)).toBe("777");
    expect(resolveChannelId("Prismatic Evolutions", "Scarlet & Violet", config, undefined)).toBe("777");
    expect(resolveChannelId("Prismatic Evolutions", "Scarlet & Violet", config, "EN")).toBe("777");
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

  it("SEEDAR en NY KÄLLA tyst fast state redan finns för andra källor", () => {
    // Mätt 2026-08-12: när MaxGaming lades till i butikslistan såg diffen alla dess
    // lagerförda varor som "ny-i-lager" och postade befintligt sortiment som restocks.
    const otherStoreKey = "Webhallen\thttps://webhallen.se/nagon-vara";
    const r = derive({
      state: state({ stock: { [otherStoreKey]: "IN_STOCK" } }),
      groups: groups([{ url: "https://butik.se/pitch-black-etb", stockStatus: "IN_STOCK" }]),
    });
    expect(r.posts).toHaveLength(0);
    expect(r.stats.seededSources).toEqual(["Dragon's Lair"]);
    // Källans lagerläge skrivs ändå — nästa körning diffas den som vanligt...
    expect(r.nextState.stock[KEY]).toBe("IN_STOCK");

    // ...och en riktig påfyllning efteråt postar.
    const r2 = derive({
      state: state({ stock: { ...r.nextState.stock, [KEY]: "OUT_OF_STOCK" } }),
      groups: groups([{ url: "https://butik.se/pitch-black-etb", stockStatus: "IN_STOCK" }]),
    });
    expect(r2.stats.seededSources).toEqual([]);
    expect(r2.posts).toHaveLength(1);
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
      language: "EN",
      priceOre: 54900,
      // Feeden bär ingen bild → katalogbilden ur ruttabellen som reserv.
      imageUrl: "https://cdn.foilio.se/pitch-black-etb.jpg",
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
    expect(r.stats.unknownUrlKeys).toEqual([key]);
    // ...men den GLÖMS inte: övergången väntar på att ruttabellen ska hinna ikapp.
    expect(r.nextState.pending?.[key]).toBe(NOW.getTime());
  });

  // Samlarhobbys Paradox Rift-booster 2026-08-12: offern föddes 18:02 via auto-import,
  // ruttabellen var från 12:57 → övergången konsumerades och postades ALDRIG. Andra
  // chansen: okända IN_STOCK-övergångar väntar i state och postas när rutten dykt upp.
  describe("andra chansen för okända URL:er", () => {
    const NEW_URL = "https://butik.se/paradox-rift-booster";
    const NEW_KEY = `Dragon's Lair\t${NEW_URL}`;
    const ROUTED: RouteTable = {
      ...ROUTES,
      [NEW_URL]: {
        title: "Paradox Rift Booster",
        slug: "paradox-rift-booster",
        setName: "Paradox Rift",
        series: "Scarlet & Violet",
      },
    };
    const pendingState = () =>
      state({
        stock: { [NEW_KEY]: "IN_STOCK" },
        pending: { [NEW_KEY]: NOW.getTime() - 10 * 60_000 },
      });
    const inStockGroups = () => groups([{ url: NEW_URL, stockStatus: "IN_STOCK" }]);

    it("postar när rutten dykt upp och varan fortfarande är i lager", () => {
      const r = deriveRestockPosts({
        state: pendingState(),
        groups: inStockGroups(),
        rotating: new Set(),
        routes: ROUTED,
        now: NOW,
        policy: POLICY,
        cooldownHours: 2,
        baseUrl: BASE,
      });
      expect(r.posts).toHaveLength(1);
      expect(r.posts[0].title).toBe("Paradox Rift Booster");
      expect(r.nextState.pending?.[NEW_KEY]).toBeUndefined();
    });

    it("väntar kvar när rutten fortfarande saknas — och när källan inte sveptes", () => {
      const still = derive({ state: pendingState(), groups: inStockGroups() });
      expect(still.posts).toHaveLength(0);
      expect(still.nextState.pending?.[NEW_KEY]).toBe(NOW.getTime() - 10 * 60_000);

      // Artighetsnivån: källan var inte med i det här ticket → rör ingenting.
      const absent = derive({ state: pendingState(), groups: groups([]) });
      expect(absent.nextState.pending?.[NEW_KEY]).toBe(NOW.getTime() - 10 * 60_000);
    });

    it("släpper en väntande post som hann ta slut", () => {
      const r = deriveRestockPosts({
        state: pendingState(),
        groups: groups([{ url: NEW_URL, stockStatus: "OUT_OF_STOCK" }]),
        rotating: new Set(),
        routes: ROUTED,
        now: NOW,
        policy: POLICY,
        cooldownHours: 2,
        baseUrl: BASE,
      });
      expect(r.posts).toHaveLength(0);
      expect(r.nextState.pending?.[NEW_KEY]).toBeUndefined();
    });

    it("släpper väntande poster äldre än TTL-fönstret (sleeves får aldrig en rutt)", () => {
      const r = derive({
        state: state({
          stock: { [NEW_KEY]: "IN_STOCK" },
          pending: { [NEW_KEY]: NOW.getTime() - 13 * 3600_000 },
        }),
        groups: inStockGroups(),
      });
      expect(r.nextState.pending?.[NEW_KEY]).toBeUndefined();
    });
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

/**
 * STATE-FILENS SERIALISERING (2026-08-15).
 *
 * Andra chansen för en okänd URL testades bara som REN DOM (deriveRestockPosts ovan) —
 * aldrig som round-trip genom state-filen. Fältet `pending` skrevs till disk men
 * tappades vid inläsningen, så mekanismen kunde bara verka inom ETT jobb (~5–9 min)
 * medan rutten för en ny SKU typiskt dyker upp först efter att jobbet dött. En ren dom
 * med testad logik kan alltså vara helt verkningslös om I/O:t runt den inte testas.
 */
describe("parseDiscordRestockState", () => {
  it("behåller ALLA fyra fälten genom en round-trip", () => {
    const state = {
      stock: { "Butik\thttps://x.se/p/1": "IN_STOCK" },
      history: { "Butik\thttps://x.se/p/1": [{ o: "OUT_OF_STOCK", t: 1 }] },
      posted: { "Butik\thttps://x.se/p/1": 2 },
      pending: { "Butik\thttps://x.se/p/2": 3 },
    };
    const back = parseDiscordRestockState(JSON.parse(JSON.stringify(state)));
    expect(back).not.toBeNull();
    expect(back!.pending).toEqual({ "Butik\thttps://x.se/p/2": 3 });
    expect(back!.stock).toEqual(state.stock);
    expect(back!.history).toEqual(state.history);
    expect(back!.posted).toEqual(state.posted);
  });

  it("äldre state-filer utan pending läses som tom väntlista, inte som fel", () => {
    const back = parseDiscordRestockState({ stock: { a: "IN_STOCK" } });
    expect(back).not.toBeNull();
    expect(back!.pending).toEqual({});
    expect(back!.history).toEqual({});
  });

  it("null när lagerläget saknas — då måste anroparen seeda om", () => {
    expect(parseDiscordRestockState(null)).toBeNull();
    expect(parseDiscordRestockState({})).toBeNull();
    expect(parseDiscordRestockState({ history: {} })).toBeNull();
  });
});
