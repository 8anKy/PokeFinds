import { describe, expect, it } from "vitest";
import { buildProductFacts, jpBoosterBoxPacks, sealedContents, type FactsInput } from "@/lib/product-facts";
import { CURATED_SEALED_CONTENTS } from "@/data/sealed-contents-curated";

const set = (series: string, name = "Set") => ({ name, series, releaseDate: new Date("2026-09-16T00:00:00Z"), totalCards: 128, totalCardsFull: 161 });

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
  it("booster box: EN 36 (enhanced +1 promo); JP efter setkoden i namnet", () => {
    expect(sealedContents(sealed("BOOSTER_BOX", "Surging Sparks Booster Box"))).toEqual([{ qty: 36, key: "boosters" }]);
    expect(sealedContents(sealed("BOOSTER_BOX", "Mega Evolution Enhanced Booster Box"))).toEqual([{ qty: 36, key: "boosters" }, { qty: 1, key: "promoCard" }]);
    const jp = (name: string) => ({ ...sealed("BOOSTER_BOX", `${name} Booster Box`, "Scarlet & Violet", "JP"), set: set("Scarlet & Violet", name) });
    expect(sealedContents(jp("Storm Emeralda (M6)"))).toEqual([{ qty: 30, key: "boosters" }]);
    expect(sealedContents(jp("White Flare (SV11W)"))).toEqual([{ qty: 20, key: "boosters" }]);
    expect(sealedContents(jp("Terastal Festival ex (SV8a)"))).toEqual([{ qty: 10, key: "boosters" }]);
    expect(sealedContents(jp("Ultra Force"))).toBeNull();
  });
  it("jpBoosterBoxPacks: parsplit-suffix = huvudset, a/b/W/B = enhanced, high class-lista = 10", () => {
    expect(jpBoosterBoxPacks("Mega Brave (M1L)")).toBe(30);
    expect(jpBoosterBoxPacks("Wild Force (SV5K)")).toBe(30);
    expect(jpBoosterBoxPacks("30th Celebration (M6A)")).toBe(20);
    expect(jpBoosterBoxPacks("Pokémon Card 151 (SV2a)")).toBe(20);
    expect(jpBoosterBoxPacks("MEGA Dream ex (M2a)")).toBe(10);
    expect(jpBoosterBoxPacks("Shiny Star V (S4a)")).toBe(10);
  });
  it("blister: 3-pack = 3 + promo + kodkort, 1-pack = 1 + promo + mynt, sleeved = 1; okänd form ⇒ null", () => {
    expect(sealedContents(sealed("BLISTER", "Surging Sparks 3-Pack Blister", "Scarlet & Violet"))).toEqual([
      { qty: 3, key: "boosters" },
      { qty: 1, key: "promoCard" },
      { qty: 1, key: "codeCard" },
    ]);
    expect(sealedContents(sealed("BLISTER", "Mega Evolution: Drifloon 1-Pack Blister"))).toEqual([
      { qty: 1, key: "boosters" },
      { qty: 1, key: "promoCard" },
      { qty: 1, key: "coin" },
    ]);
    expect(sealedContents(sealed("BLISTER", "Surging Sparks Sleeved Booster"))).toEqual([{ qty: 1, key: "boosters" }]);
    expect(sealedContents(sealed("BLISTER", "Surging Sparks Blister"))).toBeNull();
    expect(sealedContents(sealed("BLISTER", "Phantasmal Flames: Blaziken Premium Checklane Blister"))).toBeNull();
    // 2-pack är bara verifierad i Mega Evolution-eran.
    expect(sealedContents(sealed("BLISTER", "Prismatic Evolutions: Eevee 2-Pack Blister", "Scarlet & Violet"))).toBeNull();
  });
  it("tins: mini tin / Poké Ball-tin / ex-tin är familjer; display och övriga ⇒ null", () => {
    expect(sealedContents(sealed("TIN", "Lumiose City: Emboar Mini Tin"))).toEqual([
      { qty: 2, key: "boosters" },
      { qty: 1, key: "stickerSheet" },
      { qty: 1, key: "artCard" },
    ]);
    expect(sealedContents(sealed("TIN", "October Poké Ball Tin 2024", "Scarlet & Violet"))).toEqual([
      { qty: 3, key: "boosters" },
      { qty: 2, key: "stickerSheet" },
    ]);
    expect(sealedContents(sealed("TIN", "Mega Moonlit Tins: Mega Gengar ex Tin"))).toEqual([
      { qty: 1, key: "promoCard" },
      { qty: 4, key: "boosters" },
      { qty: 1, key: "codeCard" },
    ]);
    expect(sealedContents(sealed("TIN", "30th Celebration: Mini Tin Display"))).toBeNull();
    expect(sealedContents(sealed("TIN", "Tag Team Tins: Eevee & Snorlax GX Tin", "Sun & Moon"))).toBeNull();
  });
  it("collection box: ex box / tech sticker / first partner är familjer; premium collections ⇒ null utan kurering", () => {
    expect(sealedContents(sealed("COLLECTION_BOX", "Ascended Heroes: Mega Meganium ex Box"))).toEqual([
      { qty: 1, key: "promoCard" },
      { qty: 1, key: "oversizeCard" },
      { qty: 4, key: "boosters" },
    ]);
    expect(sealedContents(sealed("COLLECTION_BOX", "30th Celebration: Lucario Tech Sticker Collection"))?.[2]).toEqual({ qty: 3, key: "boosters" });
    expect(sealedContents(sealed("COLLECTION_BOX", "Charizard ex Premium Collection"))).toBeNull();
  });
  it("kurerad tabell vinner över familjeregeln (30th-ETB:n har foliaenergier, inte 40 energikort)", () => {
    const f = buildProductFacts({ ...sealed("ETB", "30th Celebration Elite Trainer Box"), slug: "30th-celebration-elite-trainer-box" });
    expect(f?.contents).toContainEqual({ qty: 16, key: "foilEnergyCards" });
    expect(f?.contents?.some((l) => l.key === "energyCards")).toBe(false);
  });
  it("kurerade nycklar ser ut som slugs och varje post bär källa + minst en rad", () => {
    for (const [slug, entry] of Object.entries(CURATED_SEALED_CONTENTS)) {
      expect(slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(entry.source).toMatch(/^https:\/\//);
      expect(entry.lines.length).toBeGreaterThan(0);
      for (const l of entry.lines) expect(l.qty).toBeGreaterThan(0);
    }
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
    expect(f?.contents?.length).toBe(10);
  });
  it("inget att visa ⇒ null (panelen renderas inte)", () => {
    expect(buildProductFacts({ category: "ACCESSORY", language: "EN", title: "Sleeves", releaseDate: null, set: null, card: null })).toBeNull();
  });
});
