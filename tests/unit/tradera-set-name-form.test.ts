import { describe, it, expect } from "vitest";
import { matchListingToProduct, matchProduct, formBeyondCandidate, singleListingContradiction, type MatchIndex } from "@/scrapers/matching";
import { normalizeTitle } from "@/lib/utils";

// 2026-10-14: setnamnet "30th Celebration: Classic Collection" bär formordet "collection".
// Annonsen "N 101/None …" lästes därför som en sealed kollektion, singel-identiteten
// hoppades över och annonsen blev skena + "60 kr" på 22 kort i setet.

const card = (name: string, number: string) => ({
  normalizedTitle: normalizeTitle(`${name} · 30th Celebration: Classic Collection ${number}/30`),
  card: { name, number },
  language: "EN" as const,
  variantLabel: null,
});
const N_LISTING = "N 101/None 30th Celebration: Classic Collection Pokemonkort";

describe("setnamn med formord ('Classic Collection')", () => {
  it("⛔ annonsen om N binds aldrig till ett annat kort i setet", () => {
    for (const [name, num] of [["Rayquaza-EX", "85"], ["Palkia LV.X", "106"], ["Erika's Jigglypuff", "69"], ["Pikachu", "58"]]) {
      expect(matchListingToProduct(N_LISTING, card(name, num))).toBeNull();
    }
  });

  it("annonsen om N träffar N (kort namn + rätt nummer)", () => {
    expect(matchListingToProduct(N_LISTING, card("N", "101"))).not.toBeNull();
  });

  it("⛔ ett kort namn utan rätt nummer bevisar inget", () => {
    expect(matchListingToProduct("N 30th Celebration Classic Collection", card("N", "101"))).toBeNull();
    expect(matchListingToProduct("N 55 30th Celebration Classic Collection", card("N", "101"))).toBeNull();
  });

  it("en riktig singelannons ur setet träffar sitt kort", () => {
    expect(matchListingToProduct("Rayquaza EX 85/30 Classic Collection", card("Rayquaza-EX", "85"))).not.toBeNull();
    expect(matchListingToProduct("Rayquaza-EX 30th Celebration Classic Collection", card("Rayquaza-EX", "85"))).not.toBeNull();
  });

  it("formen räknas utan kortets egna ord — men en ÄKTA sealed-form står kvar", () => {
    const own = card("Pikachu", "58").normalizedTitle;
    expect(formBeyondCandidate(normalizeTitle("Pikachu 58/30 Classic Collection"), own)).toBeNull();
    expect(formBeyondCandidate(normalizeTitle("Classic Collection Booster Box"), own)).toBe("display");
  });

  it("katalogbreda matchningen tar singeln i stället för att kasta den", async () => {
    const index: MatchIndex = [
      { id: "ray", ...card("Rayquaza-EX", "85") },
      { id: "pika", ...card("Pikachu", "58") },
      { id: "n", ...card("N", "101") },
    ] as MatchIndex;
    const t = "Pikachu 58/30 30th Celebration: Classic Collection";
    expect((await matchProduct(normalizeTitle(t), index, t))?.productId).toBe("pika");
    expect((await matchProduct(normalizeTitle(N_LISTING), index, N_LISTING))?.productId ?? null).not.toBe("ray");
  });
});

describe("städningens dom (singleListingContradiction)", () => {
  const p = (name: string, number: string, set = "Ascended Heroes") => ({
    normalizedTitle: normalizeTitle(`${name} · ${set} ${number}/217`),
    card: { name, number },
  });
  it("bevisat fel kort flaggas", () => {
    expect(singleListingContradiction(N_LISTING, p("Rayquaza-EX", "85"))).not.toBeNull();
    expect(singleListingContradiction("Pikachu #55 - Ascended Heroes", p("Pikachu ex", "277"))).not.toBeNull();
    expect(singleListingContradiction("Rare pokemonkort", p("Rare Candy", "69"))).not.toBeNull();
  });
  it("rätt kort med stavfel, genitiv eller promokod flaggas inte", () => {
    expect(singleListingContradiction("Cornestone Mask Ogerpon ex 58 Prismatic", p("Cornerstone Mask Ogerpon ex", "58"))).toBeNull();
    expect(singleListingContradiction("Ho-Oh-GX SM57 - SM Black Star Promos", p("Ho-Oh-GX", "SM57"))).toBeNull();
    expect(singleListingContradiction("Team Rockets Ampharos Uncommon 074/182", p("Team Rocket's Ampharos", "74"))).toBeNull();
    expect(singleListingContradiction("Iono's Bellibolt ex Japanese", p("Ionos Bellibolt ex", "30"))).toBeNull();
    expect(singleListingContradiction("Skolpojke 261/264 Fusion Strike", p("Schoolboy", "261"))).toBeNull();
  });
});

describe("Celebrations (2021) ≠ 30th Celebration (2026)", () => {
  it("en 30th-annons når aldrig 2021-setets kort och tvärtom", () => {
    const old = { normalizedTitle: normalizeTitle("Gardevoir ex δ · Celebrations: Classic Collection 93/25"), card: { name: "Gardevoir ex δ", number: "93" }, language: "EN" as const, variantLabel: null };
    expect(matchListingToProduct("M Gardevoir Classic collection 30th Celebration", old)).toBeNull();
    expect(matchListingToProduct("Gardevoir ex 93 Celebrations Classic Collection", old)).not.toBeNull();
  });
});

describe("skenans felklasser (mätta 2026-10-14)", () => {
  const sealed = (t: string) => ({ normalizedTitle: normalizeTitle(t), card: null, language: "EN" as const, variantLabel: null });
  it("⛔ generisk ETB-annons når inte Pokémon Center-boxen", () => {
    expect(matchListingToProduct("Pitch black elite trainer box etb", sealed("Pitch Black Center Elite Trainer Box"))).toBeNull();
    expect(matchListingToProduct("Pitch Black Pokemon Center Elite Trainer Box", sealed("Pitch Black Center Elite Trainer Box"))).not.toBeNull();
  });
  it("⛔ generisk mini tin når ingen karaktärs-tin", () => {
    expect(matchListingToProduct("Pokémon 30th Celebration Mini Tin", sealed("30th Celebration: Espeon and Meowth Mini Tin"))).toBeNull();
  });
  it("⛔ rätt nummer men annat set (total + setnamn saknas)", () => {
    const svi = { normalizedTitle: normalizeTitle("Toxtricity · Scarlet & Violet 72/198"), card: { name: "Toxtricity", number: "72" }, language: "EN" as const, variantLabel: null };
    expect(matchListingToProduct("Toxtricity 72 Holo Pokémon OBF EN 072/197 Obsidian Flames Pokemon Kort", svi)).toBeNull();
    const pre = { normalizedTitle: normalizeTitle("Amarys · Prismatic Evolutions 132/131"), card: { name: "Amarys", number: "132" }, language: "EN" as const, variantLabel: null };
    expect(matchListingToProduct("Amarys 132/191 [S&V Prismatic Evolutions]", pre)).not.toBeNull();
  });
  it("⛔ en vanlig annons når inte 1st Edition-posten", () => {
    const first = { normalizedTitle: normalizeTitle("Chikorita Neo Genesis 53/111 1st Edition"), card: { name: "Chikorita", number: "53" }, language: "EN" as const, variantLabel: null };
    expect(matchListingToProduct("Chikorita 53/111 Neo Genesis Pokemonkort", first)).toBeNull();
    expect(matchListingToProduct("Chikorita 53/111 Neo Genesis Pokemonkort 1st edition", first)).not.toBeNull();
  });
});

describe("promokoder", () => {
  const promo = (name: string, number: string) => ({ normalizedTitle: normalizeTitle(`${name} · Black Star Promos ${number}`), card: { name, number }, language: "EN" as const, variantLabel: null });
  it("⛔ annan promokod = annat kort", () => {
    expect(matchListingToProduct("Tapu Lele Black Star Promo SM45 Sun & Moon", promo("Tapu Lele", "SM152"))).toBeNull();
    expect(matchListingToProduct("Arceus LV.X DP56 - DP Black Star Promos", promo("Arceus LV.X", "DP53"))).toBeNull();
    expect(singleListingContradiction("Celebi SM224 - SM Black Star Promos", { normalizedTitle: normalizeTitle("Celebi XY Black Star Promos XY111"), card: { name: "Celebi", number: "XY111" } })).not.toBeNull();
  });
  it("rätt promokod går igenom", () => {
    expect(matchListingToProduct("Tapu Lele SM152 Black Star Promo", promo("Tapu Lele", "SM152"))).not.toBeNull();
  });
});
