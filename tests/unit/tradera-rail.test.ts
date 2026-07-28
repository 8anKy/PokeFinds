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
  variantLabel: null,
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

// TRYCKNINGSVAKTEN FAILADE ÖPPET (2026-07-28). Vakten fanns i matchListingToProduct,
// men `variantLabel` var ett VALFRITT fält som ingen anropare valde ut ur databasen →
// `undefined` föll rakt igenom `isPrintVariantLabel` och varje Base-annons matchade
// alla tre tryckningarna. Uppmätt i produktion morgonen efter uppdelningen: 84
// Shadowless- och 39 1st Edition-produkter fick en offer från en annons som bara sålde
// det ordinarie kortet — Blastoise 1st Edition visade 119 kr, och två av annonserna
// sa uttryckligen "base set unlimited" i titeln. Fältet är nu OBLIGATORISKT, så samma
// miss blir ett typfel i stället för en tyst felmatchning.
describe("pickRailCandidates — tryckningar (Base)", () => {
  const base = { id: "prod-2", category: "SINGLE_CARD", language: "EN", card: { name: "Blastoise", number: "2" } };
  const unlimited = { ...base, normalizedTitle: "blastoise base 2 102 unlimited", variantLabel: "Unlimited" };
  const shadowless = { ...base, normalizedTitle: "blastoise base 2 102 shadowless", variantLabel: "Shadowless" };
  const firstEd = { ...base, normalizedTitle: "blastoise base 2 102 1st edition", variantLabel: "1st Edition" };
  const single = (title: string) =>
    item({ itemId: "10", title, categoryId: 1001337, priceOre: 11900 });

  const plainAd = "Blastoise 2/102 Base Set Pokemonkort";

  it("annons som inte nämner tryckningen är den ORDINARIE — inte Shadowless", () => {
    expect(pickRailCandidates([single(plainAd)], shadowless, new Set())).toEqual([]);
  });

  it("och inte heller 1st Edition (119 kr-annonsen som visades där)", () => {
    expect(pickRailCandidates([single(plainAd)], firstEd, new Set())).toEqual([]);
  });

  it("den landar på Unlimited", () => {
    expect(pickRailCandidates([single(plainAd)], unlimited, new Set())).toHaveLength(1);
  });

  it("en annons som SÄGER tryckningen landar rätt", () => {
    expect(pickRailCandidates([single("Blastoise 2/102 Base Set Shadowless")], shadowless, new Set())).toHaveLength(1);
    expect(pickRailCandidates([single("Blastoise 2/102 Base Set 1st Edition")], firstEd, new Set())).toHaveLength(1);
    // ...och INTE på de andra två.
    expect(pickRailCandidates([single("Blastoise 2/102 Base Set 1st Edition")], unlimited, new Set())).toEqual([]);
    expect(pickRailCandidates([single("Blastoise 2/102 Base Set Shadowless")], firstEd, new Set())).toEqual([]);
  });

  it("annons som säger 'unlimited' hamnar inte på 1st Edition (Dragonair-fallet)", () => {
    expect(pickRailCandidates([single("Blastoise 2/102 Base Set Unlimited vintage")], firstEd, new Set())).toEqual([]);
  });
});
