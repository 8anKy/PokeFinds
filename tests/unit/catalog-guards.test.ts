import { describe, expect, it } from "vitest";
import {
  blisterCharacterMismatch,
  isStoreBundleListing,
  isAccessoryListing,
} from "@/scrapers/matching";

/**
 * Vakterna som avgör VAD som får bli en katalogprodukt och VILKA två titlar som är
 * samma vara. Alla exempel är riktiga titlar ur produktionsdatan 2026-08-07.
 */
describe("isStoreBundleListing", () => {
  it("stoppar butikens egna hopsättningar", () => {
    expect(isStoreBundleListing("Swepoke Mystery Pack 1.0 (4 Booster Packs)")).toBe(true);
    expect(isStoreBundleListing("Pokémon - Mini Tin - Luminose City: Alla fem tins")).toBe(true);
    expect(isStoreBundleListing("Pokemon Mystery Box 2024")).toBe(true);
  });

  it("rör ALDRIG riktiga kort som råkar heta Mystery", () => {
    // ⛔ Katalogen har tre kortfamiljer med "Mystery" i namnet. En bred regel hade
    //    raderat dem — därför krävs mystery + box/pack.
    expect(isStoreBundleListing("Mystery Garden · Ascended Heroes 194/217 · Reverse Holo")).toBe(false);
    expect(isStoreBundleListing("Mystery Plate β · Skyridge 134/144")).toBe(false);
    expect(isStoreBundleListing("Mystery Energy · Phantom Forces 112/119")).toBe(false);
    // Och inte heller riktiga sealed-SKU:er.
    expect(isStoreBundleListing("151: Mini Tin Display")).toBe(false);
    expect(isStoreBundleListing("Temporal Forces: Cleffa 3-Pack Blister")).toBe(false);
  });
});

describe("isAccessoryListing", () => {
  it("stoppar plastfodralen", () => {
    expect(isAccessoryListing("Evoretro PET Protectors for Pokemon Elite Trainer Boxes (5-Pack)")).toBe(true);
    expect(isAccessoryListing("Evoretro PET Protectors for Pokemon Booster Display Boxes (5-Pack)")).toBe(true);
  });
});

describe("blisterCharacterMismatch", () => {
  it("ENSIDIG karaktär är en motsägelse för blistrar", () => {
    // Detta band ihop fel produkter på 0,95 — över auto-link-gränsen — innan vakten
    // fanns: katalogtiteln nämner ingen Pokémon alls.
    expect(
      blisterCharacterMismatch(
        "Pokemon Scarlet & Violet 9: Journey Together Checklane Blister Scraggy",
        "scarlet violet journey together premium checklane blister"
      )
    ).toBe(true);
  });

  it("olika karaktär är en motsägelse", () => {
    expect(
      blisterCharacterMismatch(
        "Pokemon Scarlet & Violet 7: Stellar Crown Premium Checklane Blister Roaring Moon",
        "stellar crown koraidon premium checklane blister"
      )
    ).toBe(true);
  });

  it("samma karaktär i annan ordföljd är SAMMA vara", () => {
    // Hela poängen: butiken skriver karaktären sist, katalogen i mitten.
    expect(
      blisterCharacterMismatch(
        "Pokemon Scarlet & Violet 5: Temporal Forces 3-Pack Blister Cleffa",
        "temporal forces cleffa 3-pack blister"
      )
    ).toBe(false);
    expect(
      blisterCharacterMismatch(
        "Pokemon Sword & Shield 5: Battle Styles Blister Pack - Arrokuda",
        "battle styles arrokuda 1-pack blister"
      )
    ).toBe(false);
  });

  it("gäller BARA blistrar", () => {
    // En ETB-titel får nämna en Pokémon som katalogen utelämnar (omslagskonst) —
    // där vore vetot fel.
    expect(
      blisterCharacterMismatch("Mega Evolution Elite Trainer Box Charizard", "mega evolution elite trainer box")
    ).toBe(false);
  });
});

describe("AMBIGUITY_MARGIN (matchProduct)", () => {
  /**
   * Marginalvakten kan inte testas utan databas — den bor i matchProduct, som slår
   * upp kandidater. Det HÄR testet vaktar i stället premissen den vilar på: att de
   * två titlarna verkligen är olika varor, dvs att identitetsorden skiljer sig.
   * Håller den premissen inte längre är vakten meningslös och måste tänkas om.
   */
  it("Crown Zenith och Stellar Crown är olika identiteter", async () => {
    const { identicalIdentity } = await import("@/scrapers/matching");
    const { normalizeTitle } = await import("@/lib/utils");
    expect(
      identicalIdentity(
        normalizeTitle("Crown Zenith Elite Trainer Box"),
        normalizeTitle("Stellar Crown Elite Trainer Box")
      )
    ).toBe(false);
    // …och att annonstiteln som ställde till det är LIKA nära båda: den saknar
    // ordet som skiljer dem åt.
    const { scoreSimilarity } = await import("@/scrapers/matching");
    const listing = normalizeTitle("Crown Elite Trainer Box (ETB)");
    const a = scoreSimilarity(listing, normalizeTitle("Crown Zenith Elite Trainer Box"));
    const b = scoreSimilarity(listing, normalizeTitle("Stellar Crown Elite Trainer Box"));
    expect(Math.abs(a - b)).toBeLessThan(0.03);
  });
});
