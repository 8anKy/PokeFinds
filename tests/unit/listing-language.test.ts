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

  it("kinesiska produktlinjer med LATINSK titel (Gem Pack / 151C)", () => {
    // DL:s kinesiska Gem Pack — inget 'chinese' i titeln, men linjen är CN-exklusiv.
    expect(detectListingLanguage("Pokémon TCG -Gem Pack Vol 3 151 C Booster Box")).toBe("CN");
    expect(detectListingLanguage("Pokemon Collect 151 Gathering Booster Box 151C")).toBe("CN");
    // '151 Collection' får INTE felflaggas av 151C-regeln.
    expect(detectListingLanguage("Pokémon TCG: 151 Collection Alakazam ex")).toBe("EN");
  });

  it("CJK-skript: Han utan kana = CN, hangul = KR", () => {
    expect(detectListingLanguage("收集癖151 寶可夢集換式卡牌 Booster Box")).toBe("CN");
    expect(detectListingLanguage("포켓몬 카드 게임 Booster Box")).toBe("KR");
    // Kana → JP även om kanji finns med.
    expect(detectListingLanguage("ポケモンカード151 強化拡張パック")).toBe("JP");
  });

  it("URL-slugen avslöjar språket när titeln inte gör det", () => {
    const url = "https://dragonslair.se/products/pokemon-collect-151-gathering-slim-booster-box-151c-kinesisk-version-copy";
    expect(detectListingLanguage("Random Gathering Box", url)).toBe("CN");
    expect(isBlockedListingLanguage("Random Gathering Box", url)).toBe(true);
    const kr = "https://www.shinycards.se/pokemon/booster-box/pokemon-scarlet-violet-wild-force-booster-box-koreansk";
    expect(isBlockedListingLanguage("Wild Force Booster Box", kr)).toBe(true);
    // Japansk slug blockas inte.
    const jp = "https://speltrollet.se/products/pokemon-scarlet-violet-wild-force-booster-japansk";
    expect(isBlockedListingLanguage("Wild Force Booster", jp)).toBe(false);
    expect(listingCardLanguage("Wild Force Booster", jp)).toBe("JP");
  });
});
