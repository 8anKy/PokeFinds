/**
 * Tradera-reglerna 2026-11-21 — riktiga annonstitlar ur de handgranskade stickproven
 * (`.spike/tradera-eval/live-sample-2026-11-{13,21}.json`) och ur en körning över alla levande offers.
 * Varje regel prövas åt BÅDA hållen: felet den fångar och den äkta annonsen den måste släppa.
 */
import { describe, expect, it } from "vitest";
import { sealedIdentityProblem } from "@/lib/tradera-sealed-identity";
import { matchListingToProduct, nameSuffixContradicts, noNumberSetMissing } from "@/scrapers/matching";
import { reprintMarkerMissing } from "@/jobs/tradera-sweep";
import { variantInTitle, titleSaysStamped } from "@/lib/print-variant";
import { normalizeTitle } from "@/lib/utils";

const SETS = ["Lost Origin", "Silver Tempest", "Evolving Skies", "Sword & Shield", "Mega Evolution", "Chaos Rising"];
const sealed = (cat: string, catalog: string, listing: string) => sealedIdentityProblem(catalog, cat, listing, SETS);

function single(title: string, name: string, number: string, variantLabel: string | null = null) {
  return { normalizedTitle: normalizeTitle(title), card: { name, number }, language: "EN" as const, variantLabel };
}
const fits = (listing: string, p: ReturnType<typeof single>) =>
  matchListingToProduct(listing, p) != null && !reprintMarkerMissing(p.normalizedTitle, listing);

describe("förseglat: produktens särdrag måste stå i annonsen", () => {
  it("Fun Pack ↔ booster/blister", () => {
    expect(sealed("BOOSTER_PACK", "Perfect Order Fun Pack (3 Cards)", "Mega Evolution Perfect Order Booster Pack")).toMatch(/Fun Pack/);
    expect(sealed("BOOSTER_PACK", "Astral Radiance Fun Pack (3 Cards)", "Pokémon Astral Radiance 3-pack blister")).toMatch(/Fun Pack/);
    expect(sealed("BOOSTER_PACK", "Journey Together Booster", "Scarlet & Violet Journey Together Fun Pack")).toMatch(/Fun Pack/);
    expect(sealed("BOOSTER_PACK", "Temporal Forces Fun Pack (3 Cards)", "Pokémon Scarlet & Violet Temporal Forces Fun Pack")).toBeNull();
    expect(sealed("BOOSTER_PACK", "Burning Shadows Sampling Pack (3 Cards)", "SEALED - Sun & Moon Burning Shadows sampling pack")).toBeNull();
  });

  it("mini-tins: serie och karaktär", () => {
    expect(sealed("TIN", "Kanto Power Mini Tins: Pikachu & Vulpix Tin", "SEALED Kanto Friends Mini Tin: Pikachu")).toMatch(/tin-serie/);
    expect(sealed("TIN", "Pokémon GO: Pikachu Mini Tin", "Pokémon 30th Celebration Pikachu Mini Tin")).toMatch(/tin-serie/);
    expect(sealed("TIN", "Paldean Fates: Great Tusk ex Tin", "Paldean Fates Iron Treads EX tin sealed")).toMatch(/karaktär/);
    expect(sealed("TIN", "Pokémon GO: Poké Ball Tin", "Pokémon Clip 'N' Go - Minccino & Poké Ball")).toMatch(/tin saknas/);
    expect(sealed("TIN", "Celebrations Mini Tins: Unova Starters Tin", "Pokémon Trading Card Game 10 Mini Tins - Celebrations")).toMatch(/flera tins/);
    // Äkta:
    expect(sealed("TIN", "Kanto Friends Mini Tins: Pikachu Tin", "SEALED Kanto Friends Mini Tin: Pikachu")).toBeNull();
    expect(sealed("TIN", "30th Celebration: Mewtwo & Scraggy Mini Tin", "Pokémon 30th Celebration Mini Tin Mewtwo")).toBeNull();
    expect(sealed("TIN", "30th Celebration: Mew & Alolan Exeggutor Mini Tin", "Pokémon 30th anniversary Celebrations Mini Tin - Mew & Exeggutor")).toBeNull();
    expect(sealed("TIN", "Mega Moonlit Tins: Mega Gengar ex Tin", "Pokemon Mega tin Gengar")).toBeNull();
    expect(sealed("TIN", "Mega Moonlit Tins: Mega Clefable ex Tin", "Pokémon Mega Clefable EX samlarburk (Moonlit Tin)")).toBeNull();
    expect(sealed("TIN", "Hidden Potential Tins: Giratina V Tin", "Pokémon Hidden Potential Tin – Giratina V")).toBeNull();
  });

  it("tin-version EU ↔ US", () => {
    expect(sealed("TIN", "Paradox Clash Tins: Iron Leaves ex Tin (EU Version)", "Iron Leaves ex Tin Box (USA Version)")).toMatch(/version/);
    expect(sealed("TIN", "Paradox Clash Tins: Walking Wake ex Tin (US Version)", "Walking Wake ex Tin Box (USA Version)")).toBeNull();
  });

  it("boxens kvalificerare", () => {
    expect(sealed("BOOSTER_BOX", "Surging Sparks Booster Box (18 Boosters)", "Pokémon Scarlet & Violet Surging Sparks Booster Box")).toMatch(/18/);
    expect(sealed("BOOSTER_BOX", "Pitch Black Booster Box", "Pitch Black 18 pack booster box")).toMatch(/18/);
    expect(sealed("BOOSTER_BOX", "Journey Together Enhanced Booster Box", "Scarlet & Violet—Journey Together Booster Box")).toMatch(/Enhanced/);
    expect(sealed("ETB", "Stellar Crown Pokémon Center Elite Trainer Box", "Stellar Crown Elite Trainer Box")).toMatch(/Pokémon Center/);
    expect(sealed("BOOSTER_BOX", "Surging Sparks Booster Box", "Pokémon Scarlet & Violet Surging Sparks Booster Box")).toBeNull();
    expect(sealed("ETB", "Pitch Black Pokémon Center Elite Trainer Box", "Pitch Black Pokémon Center ETB, ny och förseglad")).toBeNull();
  });

  it("Ultra/Super-Premium måste stå — men 'ex box' ÄR en Premium Collection", () => {
    expect(sealed("COLLECTION_BOX", "Charizard ex Super-Premium Collection", "Charizard ex Premium Collection")).toMatch(/Super/);
    expect(sealed("COLLECTION_BOX", "Charizard ex Super-Premium Collection", "Charizard ex Super Premium Collection")).toBeNull();
    expect(sealed("COLLECTION_BOX", "Mega Zygarde ex Premium Collection", "Pokémon / Mega Zygarde EX Box")).toBeNull();
  });

  it("lösa kort på en förseglad vara", () => {
    expect(sealed("TIN", "30th Celebration Greninja ex Tin", "Pokémon 30th Celebrations Greninja EX 021 & Fuecoco EX 015")).toMatch(/kortnummer/);
    expect(sealed("BOOSTER_PACK", "Obsidian Flames Booster", "Charizard ex 125/197 Obsidian Flames")).toMatch(/kortnummer/);
  });

  it("annat set på en set-bunden Build & Battle — men aldrig en era-produkt", () => {
    expect(sealed("COLLECTION_BOX", "Lost Origin: Build & Battle Stadium Box", "Sword & Shield Silver Tempest Build & Battle Stadium")).toMatch(/annat set/);
    expect(sealed("COLLECTION_BOX", "Sword & Shield: Build & Battle Kit", "Sword & Shield Evolving Skies Build & Battle kit")).toBeNull();
  });
});

describe("singlar", () => {
  it("reverse-stavningar räknas som reverse", () => {
    for (const t of ["Shinx Reverese Holo", "Metang δ stämplat/reverserat", "Onix 57/95 revers holo", "Azelf 19/146 omvänt holografiskt", "Zapdos – omvänd holo"]) {
      expect(variantInTitle(t)).toBe("Reverse Holo");
    }
    expect(variantInTitle("Pokémon Reversal 14/102 Base Set")).toBeNull();
  });

  it("stämplat på det vanliga kortet fälls, men inte i set där kortet SJÄLVT är stämplat", () => {
    expect(titleSaysStamped("Azelf 19/146 League Stamp")).toBe(true);
    expect(titleSaysStamped("Bayleef δ 26/101 Dragon Frontiers STÄMPLAT.")).toBe(true);
    expect(fits("Charizard ex - League Stamp 125/197 - Obsidian Flames", single("Charizard ex · Obsidian Flames 125/197", "Charizard ex", "125"))).toBe(false);
    expect(fits("Mimikyu Holo Rare 097/193 Trick or Trade Stamp", single("Mimikyu · Trick or Trade 2023 097", "Mimikyu", "097"))).toBe(true);
    expect(fits("Metal Frying Pan Uncommon 112a/131 League Stamp", single("Metal Frying Pan · Forbidden Light 112a/131", "Metal Frying Pan", "112a"))).toBe(true);
  });

  it("Oversized kräver jumbo/oversized i annonsen", () => {
    const p = single("Umbreon-GX · SM Black Star Promos SM36/248 · Oversized", "Umbreon-GX", "SM36", "Oversized");
    expect(fits("Umbreon GX SM36 Holo SM Black Star Promos Pokemon", p)).toBe(false);
    expect(fits("Umbreon GX SM36 Oversized Jumbo - SM Black Star Promos", p)).toBe(true);
  });

  it("mekaniksuffix direkt efter namnet", () => {
    expect(nameSuffixContradicts("Banette", normalizeTitle("Banette GX - Ultra Rare - Celestial Storm"))).toBe(true);
    expect(nameSuffixContradicts("Jirachi", normalizeTitle("Jirachi V SWSH299 Holo"))).toBe(true);
    expect(nameSuffixContradicts("Typhlosion", normalizeTitle("Typhlosion Prime HGSS09 i EX!"))).toBe(false);
    expect(nameSuffixContradicts("Arceus V", normalizeTitle("Arceus V 122/172 Brilliant Stars"))).toBe(false);
  });

  it("annons utan nummer måste nämna setet — om den inte bär vårt nummer i någon form", () => {
    const energy = { name: "Lightning Energy", number: "163" };
    expect(noNumberSetMissing(energy, normalizeTitle("Lightning Energy · Expedition Base Set 163/165"), normalizeTitle("Lightning Energy 2017 - Sun & Moon Base Set"))).toBe(true);
    expect(noNumberSetMissing({ name: "Trubbish", number: "48" }, normalizeTitle("Trubbish · Noble Victories 48/101"), normalizeTitle("Trubbish - Noble Victories"))).toBe(false);
    expect(noNumberSetMissing({ name: "Eevee", number: "SWSH175" }, normalizeTitle("Eevee · SWSH Black Star Promos SWSH175/307"), normalizeTitle("Eevee #SWSH175 - Black Star Promo"))).toBe(false);
    expect(noNumberSetMissing({ name: "Torchic", number: "MEP 056" }, normalizeTitle("Torchic · MEP Black Star Promos MEP 056/93"), normalizeTitle("Torchic 056 [Mega Evolution Black Star Promos]"))).toBe(false);
    expect(noNumberSetMissing({ name: "Rescue Board", number: "159" }, normalizeTitle("Rescue Board · Temporal Forces 159/162"), normalizeTitle("Rescue Board 159 Reverse TEF"))).toBe(false);
  });

  it("World Championship-leken: året måste stämma när annonsen anger ett", () => {
    const p = "nest ball world championship decks 2025 wcd 2025";
    expect(reprintMarkerMissing(p, "Nest Ball World Championship 2024")).toBe(true);
    expect(reprintMarkerMissing(p, "Nest Ball World Championship 2025 Riley")).toBe(false);
    expect(reprintMarkerMissing(p, "Nest Ball World Championship deck")).toBe(false);
  });
});
