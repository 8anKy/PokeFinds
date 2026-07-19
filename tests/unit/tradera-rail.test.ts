/**
 * Tester för Tradera-skenans Fas 0-urval (pickRailCandidates, #19): produktsidans
 * "Fler annonser på Tradera" får BARA annonser som passerar samtliga vakter —
 * avvisade LLM-domar, kategori-grupp, språk och riktad titelmatch. Med upp till
 * 20 synliga annonser per produkt är varje matcher-miss 20x mer synlig än när
 * bara billigast-offerten visades.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ prisma: {} }));

import { pickRailCandidates, type TraderaItem } from "@/jobs/tradera-sweep";

const swshPack = {
  id: "prod-1",
  category: "BOOSTER_PACK",
  language: "EN",
  normalizedTitle: "sword shield booster pack",
  card: null,
};

function item(overrides: Partial<TraderaItem>): TraderaItem {
  return {
    itemId: "1",
    title: "Sword & Shield Booster Pack förseglad",
    priceOre: 5900,
    url: "https://www.tradera.com/item/0/1/",
    categoryId: 1001339, // Boosterpaket
    ...overrides,
  };
}

describe("pickRailCandidates", () => {
  it("behåller annonser som matchar produkten", () => {
    const kept = pickRailCandidates(
      [item({ itemId: "1" }), item({ itemId: "2", priceOre: 6900 })],
      swshPack,
      new Set()
    );
    expect(kept.map((k) => k.itemId)).toEqual(["1", "2"]);
  });

  it("avvisar annons i fel kategori-grupp (boosterbox mot pack)", () => {
    const kept = pickRailCandidates(
      [item({ categoryId: 1001340 })],
      swshPack,
      new Set()
    );
    expect(kept).toEqual([]);
  });

  it("avvisar LLM-dömd felmatch (TraderaMatch ok=false)", () => {
    const kept = pickRailCandidates(
      [item({ itemId: "666" })],
      swshPack,
      new Set(["666|prod-1"])
    );
    expect(kept).toEqual([]);
  });

  it("avvisar JP-annons på EN-produkt (EN och JP är separata katalogspår)", () => {
    const kept = pickRailCandidates(
      [item({ title: "Sword & Shield Booster Pack Japanese japansk" })],
      swshPack,
      new Set()
    );
    expect(kept).toEqual([]);
  });

  it("avvisar annons vars titel inte matchar produkten", () => {
    const kept = pickRailCandidates(
      [item({ title: "Evolving Skies Elite Trainer Box" })],
      swshPack,
      new Set()
    );
    expect(kept).toEqual([]);
  });

  it("dedupar samma itemId (kan förekomma flera gånger i ett sök-svar)", () => {
    const kept = pickRailCandidates(
      [item({ itemId: "7" }), item({ itemId: "7", priceOre: 4900 })],
      swshPack,
      new Set()
    );
    expect(kept).toHaveLength(1);
    expect(kept[0].priceOre).toBe(5900);
  });
});
