import { describe, expect, it } from "vitest";
import {
  buildMarketEmbed,
  buildMarketMessage,
  MAX_MARKET_PHOTOS,
  photoFileName,
  type MarketThreadPost,
} from "@/lib/discord-market";

function post(over: Partial<MarketThreadPost> = {}): MarketThreadPost {
  return {
    id: "p1",
    title: "Mega Kangaskhan ex (JP)",
    content: "Skick: Near Mint\nSpråk: Japanska",
    listingKind: "SELL",
    priceOre: 45000,
    condition: "NEAR_MINT",
    authorName: "Noah",
    productSlug: null,
    ...over,
  };
}

describe("buildMarketEmbed", () => {
  it("bär annonstyp, pris, skick och säljare", () => {
    const e = buildMarketEmbed(post());
    expect(e.title).toBe("Säljes — Mega Kangaskhan ex (JP)");
    expect(e.url).toContain("/forum/t/p1");
    expect(e.fields.map((f) => f.name)).toEqual(["Pris", "Skick", "Säljare"]);
  });

  it("byte har inget pris och länkar marknadspriset när produkten är känd", () => {
    const e = buildMarketEmbed(post({ listingKind: "TRADE", priceOre: null, productSlug: "kangaskhan" }));
    expect(e.title.startsWith("Bytes — ")).toBe(true);
    expect(e.fields.some((f) => f.name === "Pris")).toBe(false);
    expect(e.fields.find((f) => f.name === "Marknadspris")?.value).toContain("/produkter/kangaskhan");
  });

  it("behåller radbrytningar men slår ihop tomrader", () => {
    const e = buildMarketEmbed(post({ content: "Skick: NM\n\n\n\nSpråk:   Japanska" }));
    expect(e.description).toBe("Skick: NM\n\nSpråk: Japanska");
  });

  it("kortet ensamt bär ingen bild — galleriet läggs på i buildMarketMessage", () => {
    const e = buildMarketEmbed(post()) as Record<string, unknown>;
    expect(e.image).toBeUndefined();
    expect(e.thumbnail).toBeUndefined();
  });
});

describe("buildMarketMessage", () => {
  it("fram + bak ligger INNE i kortet som ett galleri", () => {
    const m = buildMarketMessage(post(), [{ contentType: "image/jpeg" }, { contentType: "image/png" }]);
    expect(m.attachments).toEqual([
      { id: 0, filename: "foilio-1.jpg" },
      { id: 1, filename: "foilio-2.png" },
    ]);
    expect(m.embeds).toHaveLength(2);
    expect(m.embeds[0]).toMatchObject({ title: expect.stringContaining("Säljes"), image: { url: "attachment://foilio-1.jpg" } });
    // Samma url som huvudkortet är det som får Discord att slå ihop bilderna.
    expect(m.embeds[1]).toEqual({ url: m.embeds[0].url, image: { url: "attachment://foilio-2.png" } });
    expect(m.allowed_mentions).toEqual({ parse: [] });
    expect(m.components[0].components[0]).toMatchObject({ style: 5, url: expect.stringContaining("/forum/t/p1") });
  });

  it("utan foton: bara kortet", () => {
    const m = buildMarketMessage(post(), []);
    expect(m.embeds).toHaveLength(1);
    expect((m.embeds[0] as Record<string, unknown>).image).toBeUndefined();
    expect(m.attachments).toEqual([]);
  });

  it("kapar vid galleriets fyra och säger hur många som finns kvar", () => {
    const many = Array.from({ length: 6 }, () => ({ contentType: "image/jpeg" }));
    const m = buildMarketMessage(post({ photoCount: 6 }), many);
    expect(MAX_MARKET_PHOTOS).toBe(4);
    expect(m.attachments).toHaveLength(4);
    expect(m.embeds).toHaveLength(4);
    expect((m.embeds[0] as ReturnType<typeof buildMarketEmbed>).fields.find((f) => f.name === "Fler bilder")?.value).toBe("+2 bilder i annonsen på Foilio");
  });

  it("okänd bildtyp blir jpg", () => {
    expect(photoFileName(2, "image/heic")).toBe("foilio-3.jpg");
  });
});
