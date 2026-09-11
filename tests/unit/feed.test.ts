/**
 * Nyhetsflödets rena dom: relevansgrinden, identiteten och gallringen.
 *
 * De tre sakerna som kostar mest om de går sönder:
 *  · relevansgrinden — utan den blir "Senaste nytt" en tv-spelsblogg,
 *  · `stableId` — instabil ⇒ samma nyhet dubbleras vid varje körning,
 *  · lane-invarianten — ett jobb får aldrig radera det andras poster.
 */
import { describe, expect, it } from "vitest";
import {
  EVENT_CATEGORIES,
  NEWS_CATEGORIES,
  clampSummary,
  daysUntil,
  eventItemSchema,
  feedPublishSchema,
  inferNewsCategory,
  isTcgRelevant,
  newsItemSchema,
  normalizeFeed,
  slugify,
  stableId,
} from "@/lib/feed";
import { decodeEntities, parseFeed, stripTags } from "@/lib/rss";

describe("relevansgrinden", () => {
  it("släpper igenom kortnyheter", () => {
    expect(isTcgRelevant("New TCG set announced", "")).toBe(true);
    expect(isTcgRelevant("Elite Trainer Box preorders are live", "")).toBe(true);
    expect(isTcgRelevant("Prerelease events announced", null)).toBe(true);
    expect(isTcgRelevant("Nya kort i katalogen", undefined)).toBe(true);
  });

  it("fäller tv-spelsnyheter — det var 18 av 18 i verkliga flöden", () => {
    expect(isTcgRelevant("Nintendo Direct September 2026 Is Live", "")).toBe(false);
    expect(isTcgRelevant("Pokémon GO Battle League now underway", "")).toBe(false);
    expect(isTcgRelevant("Pokémon Pokopia update 2.0.1 is now available", "")).toBe(false);
  });

  it("ordet pokemon ensamt räcker inte — det står i varje rubrik hos källorna", () => {
    expect(isTcgRelevant("Pokémon news roundup", "")).toBe(false);
  });

  it("en uteslutande term vinner över en relevant", () => {
    expect(isTcgRelevant("Pokemon GO adds new card-themed avatar", "")).toBe(false);
  });
});

describe("kategori", () => {
  it("ett släpp känns igen oavsett källans egen kategori", () => {
    expect(inferNewsCategory("MARKET", "Preorder opens for the new set", "")).toBe("RELEASE");
    expect(inferNewsCategory("STORE", "Release date confirmed", "")).toBe("RELEASE");
  });
  it("annars behålls källans kategori", () => {
    expect(inferNewsCategory("MARKET", "PSA raises grading prices", "")).toBe("MARKET");
  });
});

describe("stableId", () => {
  it("är stabil för samma indata", () => {
    expect(stableId("https://example.com/a")).toBe(stableId("https://example.com/a"));
  });
  it("skiljer på näraliggande strängar", () => {
    expect(stableId("https://example.com/a")).not.toBe(stableId("https://example.com/b"));
    // Omkastningsvarvet finns just för det här fallet.
    expect(stableId("ab")).not.toBe(stableId("ba"));
  });
});

describe("slugify", () => {
  it("kapar långa rubriker vid ett ordslut, aldrig mitt i ett ord", () => {
    const slug = slugify("Sällsynt Pikachu Illustrator på auktion hos Heritage – budet över 1,1 miljoner dollar");
    expect(slug.length).toBeLessThanOrEqual(80);
    expect(slug.endsWith("-miljoner")).toBe(true);
  });

  it("translittererar svenska tecken i stället för att stryka dem", () => {
    expect(slugify("Samlarkortsfestivalen Malmö")).toBe("samlarkortsfestivalen-malmo");
    expect(slugify("Svenska Pokémonmässan Göteborg")).toBe("svenska-pokemonmassan-goteborg");
  });
  it("ger en slug som schemat accepterar", () => {
    const slug = slugify("  Höstcupen 2026 — Standard!  ");
    expect(eventItemSchema.shape.slug.safeParse(slug).success).toBe(true);
  });
});

describe("clampSummary", () => {
  it("klipper inte mitt i ett ord", () => {
    const out = clampSummary("ett två tre fyra fem sex sju åtta nio tio", 20);
    expect(out.endsWith("…")).toBe(true);
    expect(out.length).toBeLessThanOrEqual(21);
    expect(out).not.toContain("  ");
  });
  it("lämnar korta texter i fred", () => {
    expect(clampSummary("kort text", 100)).toBe("kort text");
  });
});

describe("newsItemSchema.url", () => {
  const base = { id: "a", title: "Rubrik här", source: "Foilio", publishedAt: new Date().toISOString() };
  it("accepterar https och interna vägar", () => {
    expect(newsItemSchema.safeParse({ ...base, url: "https://example.com/x" }).success).toBe(true);
    expect(newsItemSchema.safeParse({ ...base, url: "/sets/sv12" }).success).toBe(true);
  });
  it("fäller protokoll-relativa vägar — annars blir en intern länk en öppen omdirigering", () => {
    expect(newsItemSchema.safeParse({ ...base, url: "//annan.sajt/x" }).success).toBe(false);
    expect(newsItemSchema.safeParse({ ...base, url: "javascript:alert(1)" }).success).toBe(false);
  });
});

describe("normalizeFeed", () => {
  const now = new Date("2026-09-09T12:00:00Z");
  const news = (id: string, publishedAt: string, lane: "rss" | "foilio" = "rss") =>
    newsItemSchema.parse({ id, title: `Nyhet ${id}`, url: `https://example.com/${id}`, source: "K", publishedAt, lane });
  const event = (slug: string, startsAt: string, endsAt: string | null = null) =>
    eventItemSchema.parse({ id: slug, slug, title: `Event ${slug}`, startsAt, endsAt });

  it("sorterar nyheter nyast först och tar bort dubbletter", () => {
    const doc = normalizeFeed(
      { generatedAt: now.toISOString(), news: [news("a", "2026-09-01T00:00:00Z"), news("b", "2026-09-08T00:00:00Z"), news("a", "2026-09-01T00:00:00Z")], events: [] },
      now
    );
    expect(doc.news.map((n) => n.id)).toEqual(["b", "a"]);
  });

  it("städar bort evenemang först dagen efter att de slutat", () => {
    const doc = normalizeFeed(
      {
        generatedAt: now.toISOString(),
        news: [],
        events: [
          event("igar", "2026-09-08T10:00:00Z", "2026-09-08T18:00:00Z"),
          event("forra-veckan", "2026-09-01T10:00:00Z", "2026-09-01T18:00:00Z"),
          event("snart", "2026-10-03T10:00:00Z"),
        ],
      },
      now
    );
    expect(doc.events.map((e) => e.slug)).toEqual(["igar", "snart"]);
  });

  it("sorterar evenemang stigande — månadsgrupperingen i UI:t förutsätter det", () => {
    const doc = normalizeFeed(
      { generatedAt: now.toISOString(), news: [], events: [event("sen", "2026-11-01T10:00:00Z"), event("tidig", "2026-09-20T10:00:00Z")] },
      now
    );
    expect(doc.events.map((e) => e.slug)).toEqual(["tidig", "sen"]);
  });

  it("två evenemang med samma slug ger EN sida, inte två som skuggar varandra", () => {
    const doc = normalizeFeed(
      { generatedAt: now.toISOString(), news: [], events: [event("dubbel", "2026-10-01T10:00:00Z"), event("dubbel", "2026-10-02T10:00:00Z")] },
      now
    );
    expect(doc.events).toHaveLength(1);
  });
});

describe("lane-invarianten", () => {
  it("nyheter bär sin lane så publiceringsrutten kan behålla den andras poster", () => {
    const payload = feedPublishSchema.parse({
      lane: "foilio",
      generatedAt: new Date().toISOString(),
      news: [{ id: "x", title: "Setet släpps", url: "/sets/sv12", source: "Foilio", publishedAt: new Date().toISOString(), internal: true, lane: "foilio" }],
    });
    expect(payload.news[0].lane).toBe("foilio");
    // ⛔ `events` utelämnat ⇒ null ⇒ rutten rör inte evenemangen.
    expect(payload.events).toBeNull();
  });
});

describe("daysUntil", () => {
  it("räknar på dygnsgräns, inte på 24-timmarsblock", () => {
    const now = new Date(2026, 8, 9, 23, 0, 0);
    expect(daysUntil(new Date(2026, 8, 10, 2, 0, 0).toISOString(), now)).toBe(1);
    expect(daysUntil(new Date(2026, 8, 9, 23, 59, 0).toISOString(), now)).toBe(0);
  });
});

describe("rss-läsaren", () => {
  const rss = `<?xml version="1.0"?><rss><channel><title>Testflödet</title>
    <item>
      <title><![CDATA[Ny ETB &amp; mer]]></title>
      <link>https://example.com/a</link>
      <pubDate>Tue, 08 Sep 2026 10:00:00 +0000</pubDate>
      <description><![CDATA[<p>Text med <b>taggar</b> och <img src="https://example.com/bild.jpg"> bild.</p>]]></description>
    </item>
    <item>
      <title>Utan datum</title>
      <link>https://example.com/b</link>
    </item>
  </channel></rss>`;

  it("plockar rubrik, länk, datum, ren text och bild", () => {
    const [first] = parseFeed(rss);
    expect(first.title).toBe("Ny ETB & mer");
    expect(first.link).toBe("https://example.com/a");
    expect(first.publishedAt).toBe("2026-09-08T10:00:00.000Z");
    expect(first.summary).toBe("Text med taggar och bild.");
    expect(first.imageUrl).toBe("https://example.com/bild.jpg");
  });

  it("en post utan datum tas med men saknar publishedAt (jobbet fäller den)", () => {
    expect(parseFeed(rss)[1].publishedAt).toBeNull();
  });

  it("kastar inte på skräp", () => {
    expect(parseFeed("inte xml alls")).toEqual([]);
    expect(parseFeed("<rss><channel><item><title>utan länk</title></item></channel></rss>")).toEqual([]);
  });

  it("läser Atom-poster med rel=alternate", () => {
    const atom = `<feed><entry><title>Atomrubrik</title>
      <link rel="replies" href="https://example.com/kommentarer"/>
      <link rel="alternate" href="https://example.com/atom"/>
      <updated>2026-09-07T08:00:00Z</updated></entry></feed>`;
    const [entry] = parseFeed(atom);
    expect(entry.link).toBe("https://example.com/atom");
  });

  it("avkodar dubbelkodade entiteter", () => {
    expect(decodeEntities("Tom &amp;#39;s kort")).toBe("Tom 's kort");
    expect(stripTags("<p>a&nbsp;&amp;&nbsp;b</p>")).toBe("a & b");
  });
});

describe("kategorierna har copy på båda språken", () => {
  // ⛔ En ny kategori utan `cat<NAMN>`-nyckel KRASCHAR pillret i UI:t
  // (next-intl kastar på en saknad nyckel), och det syns först i drift eftersom
  // kategorin sätts av ett jobb — inte av koden som renderar. Testet är billigare.
  const sv = require("../../messages/sv.json") as { News: Record<string, string> };
  const en = require("../../messages/en.json") as { News: Record<string, string> };

  it.each([...NEWS_CATEGORIES, ...EVENT_CATEGORIES])("%s", (category) => {
    expect(sv.News[`cat${category}`], `sv saknar cat${category}`).toBeTruthy();
    expect(en.News[`cat${category}`], `en saknar cat${category}`).toBeTruthy();
  });
});

describe("kurerade poster (.github/feed/news.json)", () => {
  it("en app-uppdatering pekar in i appen och öppnas i samma vy", () => {
    const parsed = newsItemSchema.parse({
      id: "x",
      title: "Nyheter och evenemang finns nu i Foilio",
      url: "/nyheter",
      internal: true,
      source: "Foilio",
      category: "APP",
      publishedAt: "2026-09-09",
    });
    expect(parsed.internal).toBe(true);
    expect(parsed.category).toBe("APP");
    // Kurerade poster tillhör rss-lanen (jobbet som läser filen).
    expect(parsed.lane).toBe("rss");
  });

  it("filerna i repot går att läsa och validera", async () => {
    const { readFile } = await import("fs/promises");
    const news = JSON.parse(await readFile(".github/feed/news.json", "utf8")) as { news: unknown[] };
    const events = JSON.parse(await readFile(".github/feed/events.json", "utf8")) as { events: unknown[] };
    for (const raw of news.news) {
      expect(newsItemSchema.safeParse({ id: "x", ...(raw as object) }).success, JSON.stringify(raw).slice(0, 80)).toBe(true);
    }
    for (const raw of events.events) {
      expect(eventItemSchema.safeParse({ id: "x", ...(raw as object) }).success, JSON.stringify(raw).slice(0, 80)).toBe(true);
    }
  });
});
