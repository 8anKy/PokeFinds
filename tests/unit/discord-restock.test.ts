/**
 * Tester för Discord-lanens RENA delar: kanalvalet och domen om vad som ska postas.
 * Ingen DB, inga nätanrop — precis som lanen själv.
 *
 * De fall som MÅSTE hålla:
 *  · SEEDNINGEN — brister den postas hela sortimentet på en gång.
 *  · FLAPP-DÄMPNINGEN — brister den spammas Dragon's Lairs kanal sönder.
 *  · VAKTKEDJAN — den ersatte ruttabellen som grind 2026-08-16. Brister den fylls
 *    kanalerna med gosedjur och lösa kort (Pocketmonsters ensam levererade 83
 *    "flippar" i ett tick: badbyxor, plånböcker, plysch).
 *  · FRÅNVAROMINNET — brister det tappar roterande butiker sina äkta påfyllningar,
 *    vilket var precis den tystnad ägaren rapporterade (mejl kom, Discord teg).
 * Alla fyra felen är tysta i produktion.
 */
import { describe, expect, it } from "vitest";
import { chunk, resolveChannelId, buildRestockEmbed, postTestMessages } from "@/lib/discord-restock";
import {
  deriveRestockPosts,
  markPosted,
  parseDiscordRestockState,
  type DiscordRestockState,
  type FullFeedGroup,
  type RouteTable,
} from "@/lib/restock-feed-events";
import {
  buildDiscordFilterContext,
  buildKnownSets,
  classifyDiscordListing,
  matchKnownSet,
} from "@/lib/discord-restock-filter";
import type { FlapPolicy } from "@/lib/stock-flap";
import { formatPrice } from "@/lib/format";
import { judgePriceDrop, pricePolicy, type PriceDropPolicy } from "@/lib/price-drop";

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

const SETS = [
  { id: "set_pitch", name: "Pitch Black", series: "Mega Evolution", language: "EN" },
  { id: "set_prism", name: "Prismatic Evolutions", series: "Scarlet & Violet", language: "EN" },
  { id: "set_paradox", name: "Paradox Rift", series: "Scarlet & Violet", language: "EN" },
  { id: "set_ninja", name: "Ninja Spinner (M4)", series: "Mega Evolution", language: "JP" },
];
const FILTER = buildDiscordFilterContext({ routes: ROUTES, setNames: SETS.map((s) => s.name) });
const KNOWN_SETS = buildKnownSets({ sets: SETS });

/** En titel som passerar hela vaktkedjan — det normala fallet. */
const OK_TITLE = "Pokémon TCG: Pitch Black Elite Trainer Box";

function groups(
  items: { url: string; stockStatus: string; title?: string; price?: number }[],
  sourceName = "Dragon's Lair"
): FullFeedGroup[] {
  return [
    {
      sourceName,
      items: items.map((i) => ({
        url: i.url,
        stockStatus: i.stockStatus as FullFeedGroup["items"][number]["stockStatus"],
        title: i.title ?? OK_TITLE,
        price: i.price ?? 54900,
        imageUrl: null,
      })),
    },
  ];
}

function state(partial: Partial<DiscordRestockState>): DiscordRestockState {
  return { stock: {}, history: {}, posted: {}, ...partial };
}

/**
 * Prisgränserna i testerna är HÅRDKODADE, aldrig `pricePolicy()`: den läser env, och
 * ett test som ärver driftens spakar bevisar ingenting om domen.
 */
const PRICE_POLICY: PriceDropPolicy = {
  minPercent: 5,
  minOre: 1000,
  maxPercent: 60,
  maxPerStore: 8,
  cooldownHours: 12,
};

function derive(opts: {
  state: DiscordRestockState | null;
  groups: FullFeedGroup[];
  rotating?: Set<string>;
  routes?: RouteTable;
  now?: Date;
  priceDrops?: PriceDropPolicy | null;
}) {
  return deriveRestockPosts({
    state: opts.state,
    groups: opts.groups,
    rotating: opts.rotating ?? new Set(),
    routes: opts.routes ?? ROUTES,
    filter: FILTER,
    knownSets: KNOWN_SETS,
    now: opts.now ?? NOW,
    policy: POLICY,
    cooldownHours: 2,
    baseUrl: BASE,
    priceDrops: opts.priceDrops === undefined ? PRICE_POLICY : opts.priceDrops,
  });
}

const URL_ETB = "https://butik.se/pitch-black-etb";
const KEY = `Dragon's Lair\t${URL_ETB}`;

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

/**
 * VAKTKEDJAN ÄR NUMERA ENDA GRINDEN (2026-08-16). Fram till dess postades bara URL:er
 * som fanns i ruttabellen, dvs varor katalogen kände igen — och det var därför mejl
 * gick ut om påfyllningar Discord teg om. Varje rad nedan står för en klass som
 * FAKTISKT förekom i butikernas levande feedar när grinden mättes.
 */
describe("classifyDiscordListing", () => {
  const ok = (title: string, url = "https://butik.se/x") =>
    classifyDiscordListing({ title, url }, FILTER);

  it("släpper igenom en vanlig sealed-vara utan att katalogen känner URL:en", () => {
    const v = ok("Pokémon Mega Evolution: Pitch Black Booster Box");
    expect(v.ok).toBe(true);
    expect(v.language).toBe("EN");
  });

  it("släpper igenom JAPANSKA varor och märker språket", () => {
    const v = ok("Pokémon Ninja Spinner (M4) Booster Box (Japansk)");
    expect(v.ok).toBe(true);
    expect(v.language).toBe("JP");
  });

  it("blockerar kinesiska och koreanska utgåvor", () => {
    expect(ok("Pokémon Gem Pack Vol 6 Booster Box (Kinesisk)").reason).toBe("language");
    expect(ok("Pokémon Mega Brave Booster Box (KOR)").reason).toBe("language");
  });

  it("blockerar tillbehör — uttrycklig ägarregel för kanalerna", () => {
    expect(ok("Pokemon ME02 Phantasmal Flames Samlarpärm 9-pocket").reason).toBe("accessory");
    expect(ok("Ultra Pro Pokemon Mega Charizard X&Y Spelmatta").reason).toBe("accessory");
    // Adjektivet krävde sitt substantiv innan den här smet igenom (Hobbykort).
    expect(ok("Pokémon Protective Case - Booster Box Japanese").reason).toBe("accessory");
  });

  it("blockerar merch och lösa kort", () => {
    expect(ok("Pokémon Palmsize Wonders Series 2 Eeveelution Blind Box").reason).toBe("merch");
    expect(ok("Charizard ex #199 - PSA 8").reason).toBe("single");
  });

  it("blockerar andra TCG-franchiser", () => {
    expect(ok("One Piece [OP-17]: The World's Strongest Warrior Booster Pack").reason).toBe(
      "other-franchise"
    );
  });

  it("blockerar butikens egen hopsättning", () => {
    expect(ok("Swepoke's Mystery Box").reason).toBe("store-bundle");
  });

  it("blockerar former vi inte känner igen (OTHER-svansen är mest merch)", () => {
    expect(ok("Pokémon Squishmallow 40 cm").reason).toBeDefined();
  });

  it("kräver POSITIV Pokémon-evidens — en blocklista kan aldrig bli komplett", () => {
    expect(ok("Toy Story 30 Years & Beyond Booster Box").reason).toBe("no-pokemon-signal");
    // Evidensen läses också på RÅTITELN: cleanListingTitle tar bort "Pokémon TCG:"-
    // prefixet, och för den här SKU:n satt hela beviset just där.
    expect(ok("Pokemon TCG: 2025 World Championship Deck - Pult Bomb").ok).toBe(true);
  });

  it("respekterar ägarens denylist på URL:en, inte bara på titeln", () => {
    const denied = "https://goblinen.com/products/pokemon-tcg-mega-zygarde-ex-premium-collection";
    expect(classifyDiscordListing({ title: OK_TITLE, url: denied }, FILTER).reason).toBe("denylist");
  });
});

describe("matchKnownSet", () => {
  it("hittar setet i butikens egen titel så kanalvalet funkar utan rutt", () => {
    expect(matchKnownSet("Pokémon Pitch Black Booster Box", KNOWN_SETS, "EN")?.series).toBe(
      "Mega Evolution"
    );
  });

  it("väljer setet med RÄTT SPRÅK när namnet delas mellan EN och JP", () => {
    const shared = buildKnownSets({
      sets: [
        { name: "Black Bolt", series: "Scarlet & Violet", language: "EN" },
        { name: "Black Bolt", series: "Mega Evolution", language: "JP" },
      ],
    });
    expect(matchKnownSet("Black Bolt Booster Box", shared, "JP")?.series).toBe("Mega Evolution");
    expect(matchKnownSet("Black Bolt Booster Box", shared, "EN")?.series).toBe("Scarlet & Violet");
  });

  it("SERIENS basutgåva förlorar mot det specifika setet i samma titel", () => {
    // "Mega Evolution" är BÅDE ett set (seriens basutgåva) och en serie, och
    // butikerna skriver ut serien före setet. Utan specificitetsregeln vinner det
    // längre namnet och varan hamnar i basutgåvans kanal i stället för i sin egen.
    const both = buildKnownSets({
      sets: [
        { name: "Mega Evolution", series: "Mega Evolution", language: "EN" },
        { name: "Chaos Rising", series: "Mega Evolution", language: "EN" },
      ],
    });
    expect(matchKnownSet("Pokémon TCG: Mega Evolution - Chaos Rising Booster", both, "EN")?.name).toBe(
      "Chaos Rising"
    );
    // …men bär titeln BARA basutgåvans namn är den fortfarande rätt svar.
    expect(matchKnownSet("Pokémon TCG: Mega Evolution Booster Box", both, "EN")?.name).toBe(
      "Mega Evolution"
    );
  });

  it("null när inget känt set nämns → catch-all", () => {
    expect(matchKnownSet("Pokémon Booster Box", KNOWN_SETS, "EN")).toBeNull();
  });
});

describe("deriveRestockPosts", () => {
  it("SEEDAR utan att posta när ingen tidigare state finns", () => {
    const r = derive({
      state: null,
      groups: groups([{ url: URL_ETB, stockStatus: "IN_STOCK" }]),
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
      groups: groups([{ url: URL_ETB, stockStatus: "IN_STOCK" }]),
    });
    expect(r.posts).toHaveLength(0);
    expect(r.stats.seededSources).toEqual(["Dragon's Lair"]);
    // Källans lagerläge skrivs ändå — nästa körning diffas den som vanligt...
    expect(r.nextState.stock[KEY]).toBe("IN_STOCK");

    // ...och en riktig påfyllning efteråt postar.
    const r2 = derive({
      state: state({ stock: { ...r.nextState.stock, [KEY]: "OUT_OF_STOCK" } }),
      groups: groups([{ url: URL_ETB, stockStatus: "IN_STOCK" }]),
    });
    expect(r2.stats.seededSources).toEqual([]);
    expect(r2.posts).toHaveLength(1);
  });

  it("postar en påfyllning (OUT → IN) på en känd URL", () => {
    const r = derive({
      state: state({ stock: { [KEY]: "OUT_OF_STOCK" } }),
      groups: groups([{ url: URL_ETB, stockStatus: "IN_STOCK" }]),
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
      preorder: false,
    });
  });

  it("postar INTE en slutförsäljning", () => {
    const r = derive({
      state: state({ stock: { [KEY]: "IN_STOCK" } }),
      groups: groups([{ url: URL_ETB, stockStatus: "OUT_OF_STOCK" }]),
    });
    expect(r.posts).toHaveLength(0);
  });

  /**
   * ⛔ KÄRNAN I 2026-08-16-OMBYGGET. Att ruttabellen inte kände URL:en var det
   * vanligaste skälet till att Discord teg om en påfyllning som mejlades ut.
   */
  describe("katalogen grindar inte längre", () => {
    it("POSTAR en okänd URL som passerar vakterna — utan produktlänk", () => {
      const url = "https://butik.se/helt-ny-sku";
      const key = `Dragon's Lair\t${url}`;
      const r = derive({
        state: state({ stock: { [key]: "OUT_OF_STOCK" } }),
        groups: groups([
          { url, stockStatus: "IN_STOCK", title: "Pokémon Paradox Rift Booster Box" },
        ]),
      });
      expect(r.posts).toHaveLength(1);
      expect(r.posts[0]).toMatchObject({
        title: "Pokémon Paradox Rift Booster Box", // butikens egen fras, tvättad
        productUrl: null, // vi känner inte URL:en → ingen prishistorik att länka till
        // …men setet gick att läsa ur titeln, så inlägget hamnar i rätt seriekanal
        // OCH får en väg tillbaka till oss via katalogen filtrerad på setet.
        setName: "Paradox Rift",
        series: "Scarlet & Violet",
        setUrl: `${BASE}/sets/set_paradox`,
      });
    });

    /**
     * ⛔ VARJE INLÄGG SOM KAN HA EN VÄG TILLBAKA TILL OSS SKA HA DET. Ägaren såg ett
     * katalogfritt inlägg utan "Se på Foilio" och frågade efter länken — den saknades
     * för att vi inte vet VILKEN produkt butikens URL är. Setet vet vi ändå.
     * ⛔ Fritextsök (`?q=`) duger INTE som reserv: katalogfiltret kräver att ALLA ord
     *    finns i produktens normalizedTitle, och butikstiteln bär prefix, språktaggar
     *    och ibland stavfel — sökningen hade landat på noll träffar.
     */
    it("en ROUTAD post behåller produktlänken och får INGEN setlänk", () => {
      const r = derive({
        state: state({ stock: { [KEY]: "OUT_OF_STOCK" } }),
        groups: groups([{ url: URL_ETB, stockStatus: "IN_STOCK" }]),
      });
      expect(r.posts[0].productUrl).toBe(`${BASE}/produkter/pitch-black-elite-trainer-box`);
      expect(r.posts[0].setUrl).toBeNull();
    });

    it("utan känt set finns ingen ärlig länk — då sätts ingen", () => {
      const url = "https://butik.se/okant-set";
      const key = `Dragon's Lair\t${url}`;
      const r = derive({
        state: state({ stock: { [key]: "OUT_OF_STOCK" } }),
        groups: groups([
          { url, stockStatus: "IN_STOCK", title: "Pokémon Elite Trainer Box" },
        ]),
      });
      expect(r.posts).toHaveLength(1);
      expect(r.posts[0].productUrl).toBeNull();
      expect(r.posts[0].setUrl).toBeNull();
    });

    it("en ÄLDRE ruttabell utan set-id ger kanalval men ingen setlänk", () => {
      // Bakåtkompatibilitet: `sets[].id` tillkom 2026-08-16. En cachad fil utan
      // fältet får inte sluta posta — den ska bara sakna reservlänken.
      const url = "https://butik.se/helt-ny-sku-2";
      const key = `Dragon's Lair\t${url}`;
      const r = deriveRestockPosts({
        state: state({ stock: { [key]: "OUT_OF_STOCK" } }),
        groups: groups([
          { url, stockStatus: "IN_STOCK", title: "Pokémon Paradox Rift Booster Box" },
        ]),
        rotating: new Set(),
        routes: ROUTES,
        filter: FILTER,
        knownSets: buildKnownSets({
          sets: [{ name: "Paradox Rift", series: "Scarlet & Violet", language: "EN" }],
        }),
        now: NOW,
        policy: POLICY,
        cooldownHours: 2,
        baseUrl: BASE,
      });
      expect(r.posts).toHaveLength(1);
      expect(r.posts[0].series).toBe("Scarlet & Violet"); // kanalvalet funkar ändå
      expect(r.posts[0].setUrl).toBeNull();
    });

    /**
     * ⛔ INGEN REGRESSION. Fram till 2026-08-16 postades VARJE routad URL utan någon
     * vakt alls. Skulle en ordlista nu kunna rösta ner en sådan hade ombygget tagit
     * BORT larm samtidigt som det lade till dem. MÄTT samma dag: "Starter Deck 100
     * Japansk" och "Phantsmal Flames Booster Pack" (butikens stavfel) faller båda på
     * "no-pokemon-signal" trots att de är riktiga varor.
     */
    it("en KÄND rutt övertrumfar vakterna — annars vore ombygget en regression", () => {
      const r = derive({
        state: state({ stock: { [KEY]: "OUT_OF_STOCK" } }),
        // Titeln bär varken formord eller Pokémon-bevis; ensam hade den fällts.
        groups: groups([{ url: URL_ETB, stockStatus: "IN_STOCK", title: "Phantsmal Flames" }]),
      });
      expect(r.posts).toHaveLength(1);
      expect(r.stats.rescuedByRoute).toBe(1);
      expect(r.posts[0].title).toBe("Pitch Black Elite Trainer Box");
    });

    it("…men SPRÅK och DENYLIST övertrumfas ALDRIG — de är policy, inte gissningar", () => {
      const cn = derive({
        state: state({ stock: { [KEY]: "OUT_OF_STOCK" } }),
        groups: groups([
          { url: URL_ETB, stockStatus: "IN_STOCK", title: "Pokémon Gem Pack Vol 6 (Kinesisk)" },
        ]),
      });
      expect(cn.posts).toHaveLength(0);
      expect(cn.stats.filteredReasons.language).toBe(1);
      expect(cn.stats.rescuedByRoute).toBe(0);

      const deniedUrl =
        "https://goblinen.com/products/pokemon-tcg-mega-zygarde-ex-premium-collection";
      const deniedKey = `Dragon's Lair\t${deniedUrl}`;
      const denied = derive({
        state: state({ stock: { [deniedKey]: "OUT_OF_STOCK" } }),
        groups: groups([{ url: deniedUrl, stockStatus: "IN_STOCK" }]),
        routes: { ...ROUTES, [deniedUrl]: ROUTES[URL_ETB] },
      });
      expect(denied.posts).toHaveLength(0);
      expect(denied.stats.filteredReasons.denylist).toBe(1);
    });

    it("postar ALDRIG en okänd URL som vakterna fäller (det var ruttens enda skydd)", () => {
      const url = "https://butik.se/gosedjur";
      const key = `Dragon's Lair\t${url}`;
      const r = derive({
        state: state({ stock: { [key]: "OUT_OF_STOCK" } }),
        groups: groups([
          { url, stockStatus: "IN_STOCK", title: "Pokémon Pikachu Gosedjur 30 cm" },
        ]),
      });
      expect(r.posts).toHaveLength(0);
      expect(r.stats.skippedFiltered).toBe(1);
      expect(r.stats.filteredReasons.merch).toBe(1);
      // Namnet, inte bara räknaren — annars går bortfallet inte att felsöka.
      expect(r.stats.filteredSamples[0]).toContain(url);
    });
  });

  /**
   * FRÅNVAROMINNET (2026-08-16). `mergeStateMap` glömmer en URL som lämnar en
   * levererande feed. Det gav två fel åt var sitt håll — se filhuvudet i
   * restock-feed-events.ts.
   */
  describe("frånvarominne", () => {
    const OTHER = "Swepoke\thttps://butik.se/annat";
    const SWE_KEY = `Swepoke\t${URL_ETB}`;

    it("ROTERANDE butik: en URL som bara dyker upp är rotation, inte en påfyllning", () => {
      const r = derive({
        state: state({ stock: { [OTHER]: "IN_STOCK" } }),
        groups: groups([{ url: URL_ETB, stockStatus: "IN_STOCK" }], "Swepoke"),
        rotating: new Set(["Swepoke"]),
      });
      expect(r.posts).toHaveLength(0);
    });

    it("ROTERANDE butik: ett IHÅGKOMMET slutsålt → i lager ÄR en påfyllning", () => {
      // Rotationen kan inte fabricera det här: OUT_OF_STOCK måste ha OBSERVERATS.
      // Utan minnet var Shinycards och Swepoke — två av de mest aktiva butikerna —
      // helt oförmögna att ge ett restock-inlägg via den vägen, medan DB-lanen
      // larmade som vanligt eftersom Offer.stockStatus ligger kvar.
      const r = derive({
        state: state({
          stock: { [OTHER]: "IN_STOCK" },
          absent: { [SWE_KEY]: { s: "OUT_OF_STOCK", t: NOW.getTime() - 3 * 3600_000 } },
        }),
        groups: groups([{ url: URL_ETB, stockStatus: "IN_STOCK" }], "Swepoke"),
        rotating: new Set(["Swepoke"]),
      });
      expect(r.posts).toHaveLength(1);
    });

    it("FEED-HICKA: borta ur feeden kortare än blinkfönstret → ingen nyhet", () => {
      // Pocketmonsters levererade 83 "flippar" i ETT tick 2026-08-16 för att feeden
      // kom tillbaka med en delmängd. Utan regeln stämplas dessutom cooldown på
      // hundratals URL:er, vilket kan TYSTA en äkta påfyllning i två timmar.
      const r = derive({
        state: state({
          stock: { "Dragon's Lair\thttps://butik.se/annat": "IN_STOCK" },
          absent: { [KEY]: { s: "IN_STOCK", t: NOW.getTime() - 5 * 60_000 } },
        }),
        groups: groups([{ url: URL_ETB, stockStatus: "IN_STOCK" }]),
      });
      expect(r.posts).toHaveLength(0);
      expect(r.stats.skippedBlip).toBe(1);
    });

    it("…men en vara som varit borta LÄNGE och är tillbaka i lager postas", () => {
      // Speltrollet listar inte slutsålda varor i sina kollektioner alls — för dem är
      // frånvaro det ENDA slutsåld-beskedet, och återkomsten en riktig påfyllning.
      const r = derive({
        state: state({
          stock: { "Dragon's Lair\thttps://butik.se/annat": "IN_STOCK" },
          absent: { [KEY]: { s: "IN_STOCK", t: NOW.getTime() - 6 * 3600_000 } },
        }),
        groups: groups([{ url: URL_ETB, stockStatus: "IN_STOCK" }]),
      });
      expect(r.posts).toHaveLength(1);
    });

    /**
     * ⛔ ROTATION FÅR ALDRIG IN I HISTORIKEN. Historiken driver flapp-dämpningen: en
     * roterande butik levererar en NY delmängd varje hämtning, så om rotationen
     * bokförs som övergångar passerar varje URL sexövergångarsgränsen inom ett dygn
     * och får 24 h cooldown — dvs rotationen TYSTAR de äkta påfyllningarna. Upptäckt
     * i ett 100-sekunders röktest mot riktiga feedar: 94 fantomposter efter tre varv
     * över tre butiker.
     */
    it("skriver INGEN historik för rotationsbrus eller tyst seedade källor", () => {
      const rot = derive({
        state: state({ stock: { [OTHER]: "IN_STOCK" } }),
        groups: groups([{ url: URL_ETB, stockStatus: "IN_STOCK" }], "Swepoke"),
        rotating: new Set(["Swepoke"]),
      });
      expect(rot.nextState.history[SWE_KEY]).toBeUndefined();

      const fresh = derive({
        state: state({ stock: { "Webhallen\thttps://webhallen.se/x": "IN_STOCK" } }),
        groups: groups([{ url: URL_ETB, stockStatus: "IN_STOCK" }]),
      });
      expect(fresh.stats.seededSources).toEqual(["Dragon's Lair"]);
      expect(Object.keys(fresh.nextState.history)).toHaveLength(0);
    });

    it("en feed-hicka räknas inte som en övergång i flapp-historiken", () => {
      const r = derive({
        state: state({
          stock: { "Dragon's Lair\thttps://butik.se/annat": "IN_STOCK" },
          absent: { [KEY]: { s: "IN_STOCK", t: NOW.getTime() - 5 * 60_000 } },
        }),
        groups: groups([{ url: URL_ETB, stockStatus: "IN_STOCK" }]),
      });
      expect(r.stats.skippedBlip).toBe(1);
      expect(r.nextState.history[KEY]).toBeUndefined();
      // Lagerläget skrivs ändå — annars ser nästa varv samma sak som "ny".
      expect(r.nextState.stock[KEY]).toBe("IN_STOCK");
    });

    it("minns statusen när en URL lämnar en LEVERERANDE feed", () => {
      const r = derive({
        state: state({ stock: { [KEY]: "OUT_OF_STOCK", "Dragon's Lair\thttps://butik.se/kvar": "IN_STOCK" } }),
        groups: groups([{ url: "https://butik.se/kvar", stockStatus: "IN_STOCK" }]),
      });
      expect(r.nextState.absent?.[KEY]).toEqual({ s: "OUT_OF_STOCK", t: NOW.getTime() });
    });

    it("TOM feed rör inte minnet — frånvaro utan leverans är ingen information", () => {
      const r = derive({
        state: state({ stock: { [KEY]: "OUT_OF_STOCK" } }),
        groups: groups([]),
      });
      expect(r.nextState.absent?.[KEY]).toBeUndefined();
      expect(r.nextState.stock[KEY]).toBe("OUT_OF_STOCK");
    });
  });

  /**
   * PREORDER var ett svart hål fram till 2026-08-16: `actionableChanges` krävde att
   * BÅDA statusarna var IN_STOCK/OUT_OF_STOCK, medan DB-vägens `isRestock` med flit
   * räknar PREORDER → IN_STOCK som en restock. Släppet är det mest värdefulla larmet
   * av alla och kunde alltså aldrig postas.
   */
  describe("förhandsbokning", () => {
    it("PREORDER → IN_STOCK är en påfyllning (släppet)", () => {
      const r = derive({
        state: state({ stock: { [KEY]: "PREORDER" } }),
        groups: groups([{ url: URL_ETB, stockStatus: "IN_STOCK" }]),
      });
      expect(r.posts).toHaveLength(1);
      expect(r.posts[0].preorder).toBe(false);
    });

    it("OUT_OF_STOCK → PREORDER får ett EGET besked", () => {
      const r = derive({
        state: state({ stock: { [KEY]: "OUT_OF_STOCK" } }),
        groups: groups([{ url: URL_ETB, stockStatus: "PREORDER" }]),
      });
      expect(r.posts).toHaveLength(1);
      expect(r.posts[0].preorder).toBe(true);
    });

    it("IN_STOCK → PREORDER är en FÖRSÄMRING och postas inte", () => {
      const r = derive({
        state: state({ stock: { [KEY]: "IN_STOCK" } }),
        groups: groups([{ url: URL_ETB, stockStatus: "PREORDER" }]),
      });
      expect(r.posts).toHaveLength(0);
    });
  });

  it("BLINK: tillbaka i lager inom 20 min efter att ha lämnat lagret → inget larm", () => {
    const r = derive({
      state: state({
        stock: { [KEY]: "OUT_OF_STOCK" },
        // Lämnade IN_STOCK för 5 minuter sedan → har aldrig varit borta på riktigt.
        history: { [KEY]: [{ o: "IN_STOCK", t: NOW.getTime() - 5 * 60_000 }] },
      }),
      groups: groups([{ url: URL_ETB, stockStatus: "IN_STOCK" }]),
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
      groups: groups([{ url: URL_ETB, stockStatus: "IN_STOCK" }]),
    });
    expect(r.posts).toHaveLength(1);
  });

  it("COOLDOWN: samma vara postas inte igen inom två timmar", () => {
    const r = derive({
      state: state({
        stock: { [KEY]: "OUT_OF_STOCK" },
        posted: { [KEY]: NOW.getTime() - 30 * 60_000 },
      }),
      groups: groups([{ url: URL_ETB, stockStatus: "IN_STOCK" }]),
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
      groups: groups([{ url: URL_ETB, stockStatus: "IN_STOCK" }]),
    });
    expect(r.posts).toHaveLength(0);
    expect(r.stats.skippedCooldown).toBe(1);
  });

  it("stämplar INTE cooldown vid beslutet — bara markPosted får göra det", () => {
    // Annars tystas produkten i två timmar när Discord svarade med ett fel, dvs
    // precis när larmet aldrig kom fram.
    const r = derive({
      state: state({ stock: { [KEY]: "OUT_OF_STOCK" } }),
      groups: groups([{ url: URL_ETB, stockStatus: "IN_STOCK" }]),
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
});

describe("buildRestockEmbed", () => {
  const post = {
    key: KEY,
    title: "Pitch Black Elite Trainer Box",
    storeName: "Dragon's Lair",
    storeUrl: URL_ETB,
    priceOre: 54900,
    imageUrl: null,
    setName: "Pitch Black",
    series: "Mega Evolution",
    productUrl: `${BASE}/produkter/pitch-black-elite-trainer-box`,
  };

  it("länkar till BUTIKEN i rubriken — den som får larmet ska kunna köpa direkt", () => {
    expect(buildRestockEmbed(post).url).toBe(URL_ETB);
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

  it("faller tillbaka på SETLÄNKEN när produktsidan saknas", () => {
    const fields = buildRestockEmbed({
      ...post,
      productUrl: null,
      setUrl: `${BASE}/sets/set_pitch`,
    }).fields;
    const link = fields.find((f) => f.name === "Hos oss");
    expect(link?.value).toContain(`${BASE}/sets/set_pitch`);
    // ⛔ Fältnamnet får INTE vara "Prishistorik": det lovar en prisgraf, och den
    //    finns bara på produktsidan. Ett löfte vi inte håller är värre än inget.
    expect(fields.some((f) => f.name === "Prishistorik")).toBe(false);
  });

  it("produktsidan vinner över setlänken när båda finns", () => {
    const fields = buildRestockEmbed({ ...post, setUrl: `${BASE}/sets/set_pitch` }).fields;
    expect(fields.find((f) => f.name === "Prishistorik")?.value).toContain(post.productUrl);
    expect(fields.some((f) => f.name === "Hos oss")).toBe(false);
  });

  it("utan både produktsida och set finns ingen länkrad alls", () => {
    const fields = buildRestockEmbed({ ...post, productUrl: null, setUrl: null }).fields;
    expect(fields.some((f) => f.name === "Prishistorik" || f.name === "Hos oss")).toBe(false);
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
 * Andra chansen för en okänd URL testades bara som REN DOM — aldrig som round-trip
 * genom state-filen. Fältet skrevs till disk men tappades vid inläsningen, så
 * mekanismen kunde bara verka inom ETT jobb. En ren dom med testad logik kan alltså
 * vara helt verkningslös om I/O:t runt den inte testas. Samma vakt gäller nu
 * `absent`, som bär exakt samma sorts ansvar.
 */
describe("parseDiscordRestockState", () => {
  it("behåller ALLA fyra fälten genom en round-trip", () => {
    const s = {
      stock: { "Butik\thttps://x.se/p/1": "IN_STOCK" },
      history: { "Butik\thttps://x.se/p/1": [{ o: "OUT_OF_STOCK", t: 1 }] },
      posted: { "Butik\thttps://x.se/p/1": 2 },
      absent: { "Butik\thttps://x.se/p/2": { s: "OUT_OF_STOCK", t: 3 } },
    };
    const back = parseDiscordRestockState(JSON.parse(JSON.stringify(s)));
    expect(back).not.toBeNull();
    expect(back!.absent).toEqual({ "Butik\thttps://x.se/p/2": { s: "OUT_OF_STOCK", t: 3 } });
    expect(back!.stock).toEqual(s.stock);
    expect(back!.history).toEqual(s.history);
    expect(back!.posted).toEqual(s.posted);
  });

  it("äldre state-filer utan frånvarominne läses som tomt, inte som fel", () => {
    const back = parseDiscordRestockState({ stock: { a: "IN_STOCK" } });
    expect(back).not.toBeNull();
    expect(back!.absent).toEqual({});
    expect(back!.history).toEqual({});
  });

  it("null när lagerläget saknas — då måste anroparen seeda om", () => {
    expect(parseDiscordRestockState(null)).toBeNull();
    expect(parseDiscordRestockState({})).toBeNull();
    expect(parseDiscordRestockState({ history: {} })).toBeNull();
  });
});

/**
 * TESTLÄGETS KANALFILTER (2026-08-16). Att lägga till EN kanal, eller rätta
 * rättigheterna i EN kanal, krävde tidigare ett testinlägg i ALLA — åtta meddelanden
 * att städa bort för att kontrollera ett. Ett test som är obekvämt att köra körs inte,
 * och då är vi tillbaka i det tysta uppsättningsfelet som lät lanen stå still i 14
 * timmar 2026-08-12.
 */
describe("postTestMessages kanalfilter", () => {
  const config = {
    botToken: "x",
    setChannels: { "pitch black": "111" },
    seriesChannels: { "mega evolution": "222" },
    languageChannels: { jp: "333" },
    defaultChannelId: "999",
    priceChannelId: null,
  };

  it("⛔ ett filter som inte träffar rapporteras som FEL, aldrig som grönt", async () => {
    // Utan den regeln hade "0 kanaler OK, 0 misslyckades" sett ut som ett lyckat
    // test för ett id som inte ens står i konfigurationen.
    const res = await postTestMessages(config, "4711");
    expect(res.ok).toHaveLength(0);
    expect(res.failed).toHaveLength(1);
    expect(res.failed[0]).toContain("4711");
    expect(res.failed[0]).toContain("finns INTE");
  });
});

/**
 * NY FÖRHANDSBOKNING (2026-08-21). Webhallen är enda adaptern som skriver PREORDER,
 * och den gör det direkt i katalogfeeden: `stock.web = 0` + lanseringsdatum i
 * framtiden. En ny förhandsbokning dyker alltså upp som en URL vi ALDRIG SETT med
 * PREORDER som FÖRSTA status — och `preorder-open` (OUT_OF_STOCK → PREORDER) kan per
 * konstruktion aldrig fånga den. Före den här grenen var släppets viktigaste
 * förvarning osynlig i kanalerna.
 */
describe("deriveRestockPosts — ny URL i förhandsbokning", () => {
  const URL_NEW = "https://butik.se/webhallen-ny-preorder";
  const NEW_KEY = `Dragon's Lair\t${URL_NEW}`;

  it("en HELT NY URL med PREORDER som första status blir ett inlägg", () => {
    const r = derive({
      // Källan är känd sedan förut (annars seedas den tyst) — bara URL:en är ny.
      state: state({ stock: { [KEY]: "IN_STOCK" } }),
      groups: groups([
        { url: URL_ETB, stockStatus: "IN_STOCK" },
        { url: URL_NEW, stockStatus: "PREORDER" },
      ]),
    });
    const post = r.posts.find((p) => p.key === NEW_KEY);
    expect(post).toBeDefined();
    expect(post!.preorder).toBe(true);
  });

  it("⛔ en NY URL i lager är fortfarande en påfyllning, inte en förhandsbokning", () => {
    const r = derive({
      state: state({ stock: { [KEY]: "IN_STOCK" } }),
      groups: groups([
        { url: URL_ETB, stockStatus: "IN_STOCK" },
        { url: URL_NEW, stockStatus: "IN_STOCK" },
      ]),
    });
    expect(r.posts.find((p) => p.key === NEW_KEY)!.preorder).toBe(false);
  });

  it("⛔ hos en ROTERANDE butik är en ny PREORDER-URL rotation, inte en nyhet", () => {
    const SWE = "Swepoke";
    const swKey = `${SWE}\thttps://swepoke.se/pre-order`;
    const r = derive({
      state: state({ stock: { [`${SWE}\thttps://swepoke.se/annan`]: "IN_STOCK" } }),
      rotating: new Set([SWE]),
      groups: groups([{ url: "https://swepoke.se/pre-order", stockStatus: "PREORDER" }], SWE),
    });
    expect(r.posts.find((p) => p.key === swKey)).toBeUndefined();
  });

  it("⛔ minns vi den I LAGER är PREORDER en FÖRSÄMRING — tyst", () => {
    // Sågs i lager, försvann ur feeden, kommer tillbaka som förhandsbokning. Samma dom
    // som isPreorderOpen: bara OUT_OF_STOCK → PREORDER är en nyhet.
    const r = derive({
      state: state({
        stock: { [KEY]: "IN_STOCK" },
        absent: { [NEW_KEY]: { s: "IN_STOCK", t: NOW.getTime() - 5 * 3600_000 } },
      }),
      groups: groups([
        { url: URL_ETB, stockStatus: "IN_STOCK" },
        { url: URL_NEW, stockStatus: "PREORDER" },
      ]),
    });
    expect(r.posts.find((p) => p.key === NEW_KEY)).toBeUndefined();
  });

  it("minns vi den SLUTSÅLD är samma URL tillbaka i förhandsbokning en nyhet", () => {
    const r = derive({
      state: state({
        stock: { [KEY]: "IN_STOCK" },
        absent: { [NEW_KEY]: { s: "OUT_OF_STOCK", t: NOW.getTime() - 5 * 3600_000 } },
      }),
      groups: groups([
        { url: URL_ETB, stockStatus: "IN_STOCK" },
        { url: URL_NEW, stockStatus: "PREORDER" },
      ]),
    });
    expect(r.posts.find((p) => p.key === NEW_KEY)?.preorder).toBe(true);
  });

  it("⛔ en PREORDER som blinkar ur feeden ett varv är en feed-hicka, inte en nyhet", () => {
    // Blinkregeln jämför nu mot SAMMA status, inte bara mot IN_STOCK — annars hade
    // varje sidbrytning hos Webhallen gett ett nytt förhandsboknings-inlägg.
    const r = derive({
      state: state({
        stock: { [KEY]: "IN_STOCK" },
        absent: { [NEW_KEY]: { s: "PREORDER", t: NOW.getTime() - 60_000 } },
      }),
      groups: groups([
        { url: URL_ETB, stockStatus: "IN_STOCK" },
        { url: URL_NEW, stockStatus: "PREORDER" },
      ]),
    });
    expect(r.posts.find((p) => p.key === NEW_KEY)).toBeUndefined();
    expect(r.stats.skippedBlip).toBe(1);
  });

  it("⛔ en ny källa seedas tyst — hela sortimentet ser ut som nya förhandsbokningar", () => {
    const r = derive({
      state: state({ stock: { [KEY]: "IN_STOCK" } }),
      groups: groups([{ url: URL_NEW, stockStatus: "PREORDER" }], "Webhallen"),
    });
    expect(r.posts).toHaveLength(0);
    expect(r.stats.seededSources).toEqual(["Webhallen"]);
  });
});

/**
 * PRISSÄNKNINGAR. Gränserna finns för att feedpriset är en AVLÄSNING, inte en
 * prislista: Shopify utan variantsplit rapporterar billigaste köpbara varianten, fem
 * kopior av parseSekPrice gör "2.999,00" till 300 öre, och Shopifys svenska marknad
 * hänger på en cookie som utan verkan ger hela butiken EX MOMS.
 */
describe("judgePriceDrop", () => {
  const P = PRICE_POLICY;
  const now = NOW;

  it("ett riktigt fall passerar", () => {
    const v = judgePriceDrop(55900, 45000, null, now, P);
    expect(v.post).toBe(true);
    if (v.post) expect(Math.round(v.percent)).toBe(19);
  });

  it("⛔ 0 kr är inget pris — varken som baslinje eller som nytt pris", () => {
    expect(judgePriceDrop(0, 45000, null, now, P)).toMatchObject({ reason: "no-baseline" });
    expect(judgePriceDrop(55900, 0, null, now, P)).toMatchObject({ reason: "no-price" });
  });

  it("utan baslinje finns ingen sänkning", () => {
    expect(judgePriceDrop(undefined, 45000, null, now, P)).toMatchObject({ reason: "no-baseline" });
  });

  it("BÅDA golven måste passeras — 5 % av 40 kr är brus", () => {
    // 12,5 % men bara 5 kr.
    expect(judgePriceDrop(4000, 3500, null, now, P)).toMatchObject({ reason: "too-small" });
    // 30 kr men bara 3 %.
    expect(judgePriceDrop(100000, 97000, null, now, P)).toMatchObject({ reason: "too-small" });
  });

  it("⛔ ett för STORT fall är troligare vår parser än deras pris", () => {
    // "2.999,00 kr" → 300 öre är exakt det felet, och det läser som årets fynd.
    expect(judgePriceDrop(299900, 300, null, now, P)).toMatchObject({ reason: "implausible" });
  });

  it("⛔ pendling 559 ⇄ 450 postas inte om och om igen", () => {
    const lastPosted = { p: 45000, t: now.getTime() - 3600_000 };
    expect(judgePriceDrop(55900, 45000, lastPosted, now, P)).toMatchObject({ reason: "cooldown" });
  });

  it("…men ett YTTERLIGARE fall bryter cooldownen", () => {
    const lastPosted = { p: 45000, t: now.getTime() - 3600_000 };
    expect(judgePriceDrop(45000, 39000, lastPosted, now, P).post).toBe(true);
  });

  it("efter cooldown-fönstret räcker ett vanligt fall igen", () => {
    const lastPosted = { p: 45000, t: now.getTime() - 13 * 3600_000 };
    expect(judgePriceDrop(55900, 45000, lastPosted, now, P).post).toBe(true);
  });
});

describe("deriveRestockPosts — prissänkningar", () => {
  const inStock = state({ stock: { [KEY]: "IN_STOCK" }, price: { [KEY]: 55900 } });

  it("en sänkning på en vara som stått i lager blir ett prisinlägg", () => {
    const r = derive({
      state: inStock,
      groups: groups([{ url: URL_ETB, stockStatus: "IN_STOCK", price: 45000 }]),
    });
    expect(r.posts).toHaveLength(1);
    expect(r.posts[0]).toMatchObject({
      key: KEY,
      priceOre: 45000,
      previousPriceOre: 55900,
      preorder: false,
      // Samma berikning som påfyllningarna — en delad byggare, aldrig en kopia.
      title: "Pitch Black Elite Trainer Box",
      productUrl: `${BASE}/produkter/pitch-black-elite-trainer-box`,
    });
    expect(r.stats.priceDrops).toBe(1);
  });

  it("⛔ prisminnet uppdateras även när inget postas — annars finns ingen baslinje", () => {
    const r = derive({
      state: state({ stock: { [KEY]: "IN_STOCK" } }),
      groups: groups([{ url: URL_ETB, stockStatus: "IN_STOCK", price: 45000 }]),
    });
    expect(r.posts).toHaveLength(0);
    expect(r.nextState.price?.[KEY]).toBe(45000);
  });

  it("⛔ bara varor I LAGER bär ett pris i minnet — kartan får inte femdubblas", () => {
    const r = derive({
      state: inStock,
      groups: groups([{ url: URL_ETB, stockStatus: "OUT_OF_STOCK", price: 45000 }]),
    });
    expect(r.nextState.price?.[KEY]).toBeUndefined();
    expect(r.posts).toHaveLength(0);
  });

  it("⛔ en URL i frånvarominnet BEHÅLLER sitt pris — annars kan roterande butiker aldrig ge prisinlägg", () => {
    const OTHER = "https://butik.se/prismatic-etb";
    const otherKey = `Dragon's Lair\t${OTHER}`;
    const r = derive({
      state: state({
        stock: { [KEY]: "IN_STOCK", [otherKey]: "IN_STOCK" },
        price: { [KEY]: 55900, [otherKey]: 39900 },
      }),
      // Bara den ena URL:en levereras — den andra hamnar i frånvarominnet.
      groups: groups([{ url: URL_ETB, stockStatus: "IN_STOCK", price: 55900 }]),
    });
    expect(r.nextState.absent?.[otherKey]).toBeDefined();
    expect(r.nextState.price?.[otherKey]).toBe(39900);
  });

  it("⛔ en PÅFYLLNING på samma URL vinner — priset står redan i det inlägget", () => {
    const r = derive({
      state: state({ stock: { [KEY]: "OUT_OF_STOCK" }, price: { [KEY]: 55900 } }),
      groups: groups([{ url: URL_ETB, stockStatus: "IN_STOCK", price: 45000 }]),
    });
    expect(r.posts).toHaveLength(1);
    expect(r.posts[0].previousPriceOre).toBeUndefined();
  });

  it("⛔ vaktkedjan gäller prisinlägg också — en sleeve-sänkning postas inte", () => {
    const SLEEVE = "https://butik.se/kortfodral";
    const sleeveKey = `Dragon's Lair\t${SLEEVE}`;
    const r = derive({
      state: state({ stock: { [sleeveKey]: "IN_STOCK" }, price: { [sleeveKey]: 19900 } }),
      routes: {},
      groups: groups([
        {
          url: SLEEVE,
          stockStatus: "IN_STOCK",
          title: "Pokémon Card Sleeves Pikachu 65-pack",
          price: 9900,
        },
      ]),
    });
    expect(r.posts).toHaveLength(0);
    expect(r.stats.priceRejected.filtered).toBe(1);
  });

  it("⛔ BURST-GRÄNSEN: faller allt hos en butik samtidigt postas INGET", () => {
    // Symtomet på att `localization=SE` slutat bita är hela butiken ~20 % ned på en
    // gång. Att posta "de största" hade gjort en tyst valutamiss till fejkade fynd.
    const many = Array.from({ length: 9 }, (_, i) => `https://butik.se/vara-${i}`);
    const prevPrice: Record<string, number> = {};
    const prevStock: Record<string, string> = {};
    for (const u of many) {
      prevPrice[`Dragon's Lair\t${u}`] = 55900;
      prevStock[`Dragon's Lair\t${u}`] = "IN_STOCK";
    }
    const r = derive({
      state: state({ stock: prevStock, price: prevPrice }),
      groups: groups(many.map((url) => ({ url, stockStatus: "IN_STOCK", price: 45000 }))),
    });
    expect(r.posts).toHaveLength(0);
    expect(r.stats.priceRejected.burst).toBe(9);
    // Prisminnet skrivs ändå — annars hade samma tal fällts på nytt varje varv.
    expect(r.nextState.price?.[`Dragon's Lair\t${many[0]}`]).toBe(45000);
  });

  it("avstängd funktion rör inte prisminnet alls", () => {
    const r = derive({
      state: inStock,
      priceDrops: null,
      groups: groups([{ url: URL_ETB, stockStatus: "IN_STOCK", price: 45000 }]),
    });
    expect(r.posts).toHaveLength(0);
    expect(r.nextState.price).toEqual({});
  });

  it("⛔ första körningen (seed) postar inga prisinlägg men bygger baslinjen", () => {
    const r = derive({
      state: null,
      groups: groups([{ url: URL_ETB, stockStatus: "IN_STOCK", price: 45000 }]),
    });
    expect(r.posts).toHaveLength(0);
    expect(r.nextState.price?.[KEY]).toBe(45000);
  });
});

describe("markPosted — prisinlägg får ALDRIG tysta en påfyllning", () => {
  it("prisnycklar stämplas i pricePosted, inte i posted", () => {
    const before = state({ stock: { [KEY]: "IN_STOCK" } });
    const after = markPosted(before, [KEY], NOW, { [KEY]: 45000 });
    expect(after.posted[KEY]).toBeUndefined();
    expect(after.pricePosted?.[KEY]).toEqual({ p: 45000, t: NOW.getTime() });
  });

  it("vanliga larm stämplas som förut", () => {
    const after = markPosted(state({ stock: {} }), [KEY], NOW);
    expect(after.posted[KEY]).toBe(NOW.getTime());
    expect(after.pricePosted?.[KEY]).toBeUndefined();
  });
});

describe("state-filens serialisering bär de nya kartorna", () => {
  it("⛔ price och pricePosted överlever en rundtur — annars är mekanismen tyst död", () => {
    // Exakt `pending`-regressionen: en ren dom med tester, men serialiseringen runt
    // den hade inga, så kartan skrevs till filen och kastades vid nästa jobbstart.
    const back = parseDiscordRestockState({
      stock: { a: "IN_STOCK" },
      price: { a: 45000 },
      pricePosted: { a: { p: 45000, t: 1 } },
    });
    expect(back!.price).toEqual({ a: 45000 });
    expect(back!.pricePosted).toEqual({ a: { p: 45000, t: 1 } });
  });

  it("äldre state-filer utan prisminne läses som tomt, inte som fel", () => {
    const back = parseDiscordRestockState({ stock: { a: "IN_STOCK" } });
    expect(back!.price).toEqual({});
    expect(back!.pricePosted).toEqual({});
  });
});

describe("buildRestockEmbed — prissänkning", () => {
  const post = {
    key: "k",
    title: "Pitch Black Elite Trainer Box",
    storeName: "Dragon's Lair",
    storeUrl: "https://butik.se/x",
    priceOre: 45000,
    imageUrl: null,
    setName: "Pitch Black",
    series: "Mega Evolution",
    productUrl: null,
  };

  it("rubriken säger NYTT LÄGRE PRIS och texten bär båda talen", () => {
    const e = buildRestockEmbed({ ...post, previousPriceOre: 55900 });
    expect(e.title).toContain("Nytt lägre pris");
    // formatPrice ger sv-SE-valuta med HÅRT mellanslag (U+00A0) — jämför mot
    // funktionen, aldrig mot en handskriven sträng.
    expect(e.description).toContain(formatPrice(55900));
    expect(e.description).toContain(formatPrice(45000));
    expect(e.description).toContain("19,5 %");
  });

  it("⛔ ALDRIG ordet lägstapris — lanen har ingen prishistorik att belägga det med", () => {
    const e = buildRestockEmbed({ ...post, previousPriceOre: 55900 });
    expect(e.title.toLowerCase()).not.toContain("lägstapris");
    expect(e.description.toLowerCase()).not.toContain("lägstapris");
  });

  it("⛔ ett ogiltigt gammalt pris ger ingen −Infinity % i en publik kanal", () => {
    const e = buildRestockEmbed({ ...post, previousPriceOre: 0 });
    expect(e.description).toBe("Finns i lager igen.");
  });

  it("en påfyllning ser ut precis som förut", () => {
    expect(buildRestockEmbed(post).description).toBe("Finns i lager igen.");
    expect(buildRestockEmbed(post).title).toBe("Pitch Black Elite Trainer Box");
  });
});

describe("pricePolicy", () => {
  it("⛔ läser env vid ANROPET — ett modulnivåvärde hade frusit till avstängt", () => {
    const before = process.env.DISCORD_PRICE_DROPS_ENABLED;
    process.env.DISCORD_PRICE_DROPS_ENABLED = "false";
    expect(pricePolicy()).toBeNull();
    process.env.DISCORD_PRICE_DROPS_ENABLED = "true";
    expect(pricePolicy()).toMatchObject({ minPercent: 5, minOre: 1000 });
    // ⛔ TOM STRÄNG = OSATT, INTE AV. `${{ vars.X }}` i workflowet blir en tom sträng
    //    när repo-variabeln inte finns — hade det tolkats som "av" skulle själva
    //    raden i workflowet tyst ha stängt av funktionen.
    process.env.DISCORD_PRICE_DROPS_ENABLED = "";
    expect(pricePolicy()).not.toBeNull();
    if (before === undefined) delete process.env.DISCORD_PRICE_DROPS_ENABLED;
    else process.env.DISCORD_PRICE_DROPS_ENABLED = before;
  });
});
