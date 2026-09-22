import { describe, expect, it } from "vitest";
import { buildProductFacts, sealedContents, type FactsInput } from "@/lib/product-facts";

const set = (series: string) => ({ series, releaseDate: new Date("2026-09-16T00:00:00Z"), totalCards: 128, totalCardsFull: 161 });

const sealed = (category: FactsInput["category"], title: string, series = "Mega Evolution", language: FactsInput["language"] = "EN"): FactsInput => ({
  category,
  language,
  title,
  releaseDate: null,
  set: set(series),
  card: null,
});

describe("sealedContents — era-tabellen", () => {
  it("ETB i S&V/Mega-eran bär 9 paket, Pokémon Center 11", () => {
    expect(sealedContents(sealed("ETB", "30th Celebration Elite Trainer Box"))?.[0]).toEqual({ qty: 9, key: "boosters" });
    expect(sealedContents(sealed("ETB", "Pokémon Center Elite Trainer Box", "Scarlet & Violet"))?.[0]).toEqual({ qty: 11, key: "boosters" });
  });
  it("ETB i SWSH-eran bär 8 paket, Pokémon Center 10", () => {
    expect(sealedContents(sealed("ETB", "Evolving Skies Elite Trainer Box", "Sword & Shield"))?.[0]).toEqual({ qty: 8, key: "boosters" });
    expect(sealedContents(sealed("ETB", "Pokémon Center Evolving Skies ETB", "Sword & Shield"))?.[0]).toEqual({ qty: 10, key: "boosters" });
  });
  it("okänd era ⇒ ingen lista (aldrig ett gissat antal)", () => {
    expect(sealedContents(sealed("ETB", "Mystery ETB", "Neo"))).toBeNull();
  });
  it("booster box: 36 bara på engelska — japanska boxar varierar", () => {
    expect(sealedContents(sealed("BOOSTER_BOX", "Surging Sparks Booster Box"))).toEqual([{ qty: 36, key: "boosters" }]);
    expect(sealedContents(sealed("BOOSTER_BOX", "Terastal Festival ex Box", "Scarlet & Violet", "JP"))).toBeNull();
  });
  it("blister: antal ur titeln, promokort utom sleeved; okänd form ⇒ null", () => {
    expect(sealedContents(sealed("BLISTER", "Surging Sparks 3-Pack Blister"))).toEqual([
      { qty: 3, key: "boosters" },
      { qty: 1, key: "promoCard" },
    ]);
    expect(sealedContents(sealed("BLISTER", "Surging Sparks Sleeved Booster"))).toEqual([{ qty: 1, key: "boosters" }]);
    expect(sealedContents(sealed("BLISTER", "Surging Sparks Blister"))).toBeNull();
  });
  it("collection box och tin varierar per produkt ⇒ inget innehåll härifrån", () => {
    expect(sealedContents(sealed("COLLECTION_BOX", "Charizard ex Premium Collection"))).toBeNull();
    expect(sealedContents(sealed("TIN", "Surging Sparks Mini Tin"))).toBeNull();
  });
});

describe("buildProductFacts", () => {
  const single = (card: FactsInput["card"]): FactsInput => ({
    category: "SINGLE_CARD",
    language: "EN",
    title: "Exeggcute · Surging Sparks 192/191",
    releaseDate: null,
    set: { series: "Scarlet & Violet", releaseDate: "2024-11-08T00:00:00.000Z", totalCards: 191, totalCardsFull: 252 },
    card,
  });
  it("singel: kortfält + tryckt nummer, inget innehåll", () => {
    const f = buildProductFacts(
      single({ artist: "Yuriko Akase", rarity: "Illustration Rare", subtype: "Basic", hp: 30, number: "192", types: ["Grass"], weaknessType: "Fire", weaknessValue: "×2", retreatCost: 1, regulationMark: "H", dexId: 102 })
    );
    expect(f?.card).toMatchObject({ artist: "Yuriko Akase", stage: "Basic", hp: 30, number: "192", printedTotal: 191, types: ["Grass"], weakness: { type: "Fire", value: "×2" }, retreatCost: 1, regulationMark: "H", dexId: 102, flavorText: null });
    expect(f?.contents).toBeNull();
    expect(f?.releaseDate).toBe("2024-11-08T00:00:00.000Z");
    expect(f?.setCards).toEqual({ printed: 191, full: 252 });
  });
  it("singel med färre än fyra fakta ⇒ ingen panel (hellre ingen än en gles)", () => {
    expect(buildProductFacts(single({ artist: null, rarity: "Common", subtype: "Basic", hp: 30, number: "1" }))).toBeNull();
    expect(buildProductFacts(single({ artist: "X", rarity: "Common", subtype: "Basic", hp: 30, number: "1" }))).not.toBeNull();
  });
  it("förseglat: produktens eget datum vinner över setets; 0 kort = okänt ⇒ ingen rad", () => {
    const f = buildProductFacts({ ...sealed("ETB", "X Elite Trainer Box"), releaseDate: new Date("2026-10-01T00:00:00Z"), set: { ...set("Mega Evolution"), totalCards: 0 } });
    expect(f?.releaseDate).toBe("2026-10-01T00:00:00.000Z");
    expect(f?.setCards).toBeNull();
    expect(f?.contents?.length).toBe(9);
  });
  it("inget att visa ⇒ null (panelen renderas inte)", () => {
    expect(buildProductFacts({ category: "ACCESSORY", language: "EN", title: "Sleeves", releaseDate: null, set: null, card: null })).toBeNull();
  });
});
