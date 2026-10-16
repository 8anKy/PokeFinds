/**
 * "Ladda ner Scoutr"-raden (2026-10-16) — sist i varje larm boten skickar, som ett
 * FÄLT (Discord renderar inga länkar i sidfoten).
 */
import { describe, expect, it } from "vitest";
import { DISCORD_APP_FIELD } from "@/lib/discord-app-field";
import { buildRestockEmbed, type RestockPost } from "@/lib/discord-restock";
import { buildAlertDmEmbed } from "@/lib/discord-dm";

const POST: RestockPost = {
  key: "k",
  title: "Pitch Black ETB",
  storeName: "Speltrollet",
  storeUrl: "https://speltrollet.se/products/etb",
  priceOre: 64900,
  imageUrl: null,
  setName: null,
  series: null,
  productUrl: "https://scoutr.se/produkter/pitch-black-etb",
};

describe("DISCORD_APP_FIELD", () => {
  it("länkar till båda butikerna med Scoutr-adressen hos Apple, utan emoji", () => {
    expect(DISCORD_APP_FIELD.name).toBe("Ladda ner Scoutr");
    expect(DISCORD_APP_FIELD.value).toContain("https://apps.apple.com/se/app/scoutr-kortpriser-larm/id6783443245");
    expect(DISCORD_APP_FIELD.value).toContain("https://play.google.com/store/apps/details?id=se.foilio.app");
    expect(/\p{Extended_Pictographic}/u.test(DISCORD_APP_FIELD.name + DISCORD_APP_FIELD.value)).toBe(false);
  });

  it("står SIST i påfyllnings-, pris- och butiksinläggen", () => {
    for (const post of [POST, { ...POST, previousPriceOre: 74900 }, { ...POST, storeOnly: true }]) {
      expect(buildRestockEmbed(post).fields.at(-1)).toEqual(DISCORD_APP_FIELD);
    }
  });

  it("står sist i larm-DM:en, även utan prisrader", () => {
    const dm = buildAlertDmEmbed({ title: "Åter i lager!", body: "…", url: null });
    expect(dm.fields.at(-1)).toEqual(DISCORD_APP_FIELD);
  });
});
