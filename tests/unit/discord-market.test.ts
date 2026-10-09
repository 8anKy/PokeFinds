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

  it("bäddar aldrig in en bild — fotona är bilagor", () => {
    const e = buildMarketEmbed(post()) as Record<string, unknown>;
    expect(e.image).toBeUndefined();
    expect(e.thumbnail).toBeUndefined();
  });
});

describe("buildMarketMessage", () => {
  it("en bilaga per foto (fram + bak) och aldrig en ping", () => {
    const m = buildMarketMessage(post(), [{ contentType: "image/jpeg" }, { contentType: "image/png" }]);
    expect(m.attachments).toEqual([
      { id: 0, filename: "foilio-1.jpg" },
      { id: 1, filename: "foilio-2.png" },
    ]);
    expect(m.allowed_mentions).toEqual({ parse: [] });
    expect(m.components[0].components[0]).toMatchObject({ style: 5, url: expect.stringContaining("/forum/t/p1") });
  });

  it("kapar vid Discords tak", () => {
    const many = Array.from({ length: MAX_MARKET_PHOTOS + 3 }, () => ({ contentType: "image/jpeg" }));
    expect(buildMarketMessage(post(), many).attachments).toHaveLength(MAX_MARKET_PHOTOS);
  });

  it("okänd bildtyp blir jpg", () => {
    expect(photoFileName(2, "image/heic")).toBe("foilio-3.jpg");
  });
});
