/**
 * detectListingLanguage / isBlockedListingLanguage: japanska = OK, kinesiska/koreanska
 * blockade "for now". Titel-baserad (vi lagrar inget separat språk på scrapade produkter).
 */
import { describe, expect, it } from "vitest";
import { detectListingLanguage, isBlockedListingLanguage, listingCardLanguage } from "@/lib/listing-language";

describe("detectListingLanguage", () => {
  it("japanska (ord + kana)", () => {
    expect(detectListingLanguage("Pokémon Abyss Eye Booster Box (Japansk)")).toBe("JP");
    expect(detectListingLanguage("Scarlet & Violet SV10 Booster Box (Japanese)")).toBe("JP");
    expect(detectListingLanguage("ナッシー[Exeggutor] Evolutions")).toBe("JP");
  });
  it("kinesiska + koreanska", () => {
    expect(detectListingLanguage("Gem Pack Vol 5 Booster Box (Simplified Chinese)")).toBe("CN");
    expect(detectListingLanguage("151 Figure Blind Collection Box (Kinesisk)")).toBe("CN");
    expect(detectListingLanguage("Mega Dream M2A Booster (Koreansk)")).toBe("KR");
  });
  it("engelska som standard", () => {
    expect(detectListingLanguage("Surging Sparks Booster Box")).toBe("EN");
  });

  it("blockar kinesiska/koreanska men inte japanska/engelska", () => {
    expect(isBlockedListingLanguage("Gem Pack (Simplified Chinese)")).toBe(true);
    expect(isBlockedListingLanguage("Shield Booster Pack (Koreansk)")).toBe(true);
    expect(isBlockedListingLanguage("Abyss Eye Booster Box (Japansk)")).toBe(false);
    expect(isBlockedListingLanguage("Surging Sparks Booster Box")).toBe(false);
  });

  it("enum-tagg: JP→JP, CN/KR→OTHER, annars EN", () => {
    expect(listingCardLanguage("Abyss Eye (Japansk)")).toBe("JP");
    expect(listingCardLanguage("Gem Pack (Simplified Chinese)")).toBe("OTHER");
    expect(listingCardLanguage("Shield Booster (Koreansk)")).toBe("OTHER");
    expect(listingCardLanguage("Surging Sparks Booster Box")).toBe("EN");
  });
});
