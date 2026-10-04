import { describe, expect, it } from "vitest";
import {
  buildStoreReportEmbed,
  directionsUrl,
  discordStoreReportConfig,
  shouldPostStoreReport,
  type StoreReportPost,
} from "@/lib/discord-store-report";

const NOW = Date.parse("2026-10-04T12:00:00Z");

function post(over: Partial<StoreReportPost> = {}): StoreReportPost {
  return {
    postId: "p1",
    observation: "SEEN",
    observedAt: new Date(NOW - 5 * 60_000),
    productLabel: "Mega Evolution Elite Trainer Box",
    productSlug: "mega-evolution-etb",
    productImageUrl: "/api/cm-image/123",
    msrpOre: null,
    priceOre: 64900,
    comment: null,
    photoUrl: null,
    authorName: "Ash",
    nearbyAtSubmit: false,
    store: {
      id: "store_1",
      name: "Hemmakväll Lund",
      address: "Bankgatan 6",
      city: "Lund",
      latitude: 55.7,
      longitude: 13.19,
      logoUrl: "/retailer-logos/hemmakvall.png",
    },
    ...over,
  };
}

describe("butikslarm från communityrapporter", () => {
  it("larmar bara färska fynd och slutsålt — aldrig 'säljs inte' eller gamla besök", () => {
    expect(shouldPostStoreReport(post(), NOW)).toBe(true);
    expect(shouldPostStoreReport(post({ observation: "SOLD_OUT" }), NOW)).toBe(true);
    expect(shouldPostStoreReport(post({ observation: "NOT_CARRIED" }), NOW)).toBe(false);
    expect(shouldPostStoreReport(post({ observedAt: new Date(NOW - 13 * 3600_000) }), NOW)).toBe(false);
  });

  it("bygger ett inlägg med butik, pris, adress, länkar och absoluta bilder", () => {
    const e = buildStoreReportEmbed(post({ photoUrl: "https://bucket.example/signed.jpg" }));
    expect(e.title).toBe("Finns på hyllan: Mega Evolution Elite Trainer Box");
    expect(e.url).toBe("https://foilio.se/forum/t/p1");
    expect(e.color).toBe(0x22c55e);
    expect(e.author.icon_url).toBe("https://foilio.se/retailer-logos/hemmakvall.png");
    expect(e.thumbnail?.url).toBe("https://foilio.se/api/cm-image/123");
    expect(e.image?.url).toBe("https://bucket.example/signed.jpg");
    const byName = Object.fromEntries(e.fields.map((f) => [f.name, f.value]));
    expect(byName["Butik"]).toBe("Hemmakväll Lund");
    expect(byName["Pris i butik"]).toMatch(/649/);
    expect(byName["Adress"]).toContain("Bankgatan 6, Lund");
    expect(byName["På Foilio"]).toContain("/produkter/mega-evolution-etb");
    expect(e.footer.text).toMatch(/inget garanterat lager/);
  });

  it("säger aldrig att besöket är verifierat och citerar kommentaren", () => {
    const e = buildStoreReportEmbed(post({ observation: "SOLD_OUT", nearbyAtSubmit: true, comment: "Sista  togs nyss" }));
    expect(e.title.startsWith("Slut i butiken:")).toBe(true);
    expect(e.color).toBe(0xef4444);
    expect(e.description).toContain("> Sista togs nyss");
    const reporter = e.fields.find((f) => f.name === "Rapporterad av")!.value;
    expect(reporter).toContain("platsuppgift nära butiken");
    expect(JSON.stringify(e)).not.toMatch(/verifierat besök/i);
  });

  it("vägbeskrivningen använder koordinater och faller tillbaka på adressen", () => {
    expect(directionsUrl(post().store)).toContain(encodeURIComponent("55.7,13.19"));
    expect(directionsUrl({ ...post().store, latitude: null, longitude: null })).toContain("Bankgatan");
  });

  it("är avstängd utan bot-token eller med 'off', annars butikslarm-kanalen", () => {
    const env = { ...process.env };
    try {
      delete process.env.DISCORD_BOT_TOKEN;
      expect(discordStoreReportConfig()).toBeNull();
      process.env.DISCORD_BOT_TOKEN = "t";
      delete process.env.DISCORD_STORE_REPORTS_CHANNEL_ID;
      expect(discordStoreReportConfig()?.channelId).toBe("1551982852378337422");
      process.env.DISCORD_STORE_REPORTS_CHANNEL_ID = "off";
      expect(discordStoreReportConfig()).toBeNull();
    } finally {
      process.env = env;
    }
  });
});
