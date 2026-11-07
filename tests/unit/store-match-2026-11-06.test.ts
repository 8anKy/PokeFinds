import { describe, it, expect } from "vitest";
import { matchProduct, applySetAliases, scoreSimilarity, type MatchIndex } from "@/scrapers/matching";
import { normalizeTitle } from "@/lib/utils";

/**
 * 2026-11-06 (ägarens Discord-skärmbilder): butiksannonser för Delta Reign-blistrar,
 * 30th Celebration UPC Day/Night och Super-Premium Collections länkades inte till
 * katalogen. Titlarna nedan är riktiga butikstitlar; katalogposterna Cardmarkets namn
 * normaliserade med `normalizeTitle` (som renormalize-product-titles.ts skriver).
 */
let n = 0;
const sealed = (title: string, language: "EN" | "JP" = "EN") => ({
  id: `p${++n}`,
  title,
  normalizedTitle: normalizeTitle(title),
  card: null,
  language,
  variantLabel: null,
});
const CATALOG = [
  sealed("Delta Reign: Seel 3-Pack Blister"),
  sealed("Delta Reign: Spritzee 1-Pack Blister"),
  sealed("Delta Reign: Keldeo & Delibird Premium Checklane Blister"),
  sealed("Delta Reign: Xerneas & Deoxys Premium Checklane Blister"),
  sealed("Delta Reign: Delphox Premium Checklane Blister"),
  sealed("Delta Reign: Ampharos Premium Checklane Blister"),
  sealed("Delta Reign Build & Battle Box"),
  sealed("Delta Reign Elite Trainer Box"),
  sealed("Mega Evolution: Psyduck 3-Pack Blister"),
  sealed("Chilling Reign: Build & Battle Kit"),
  sealed("30th Celebration: Espeon Ultra-Premium Collection"),
  sealed("30th Celebration: Umbreon Ultra-Premium Collection"),
  sealed("Prismatic Evolutions Super-Premium Collection"),
  sealed("Charizard ex Super-Premium Collection"),
  sealed("Prismatic Evolutions Premium Figure Collection"),
];
const INDEX: MatchIndex = CATALOG.map(({ title: _t, ...c }) => c);
const titleOf = (id: string | undefined) => CATALOG.find((c) => c.id === id)?.title ?? null;
const match = async (listing: string) => {
  const m = await matchProduct(normalizeTitle(listing), INDEX, listing);
  return m && m.confidence >= 0.85 ? titleOf(m.productId) : null;
};

describe("butikstitlar utan karaktär → setets enda blister av slaget", () => {
  it.each([
    "Mega Evolution - Delta Reign 3-pack Blister",
    "Pokemon ME06 Delta Reign 3-pack Booster Blister",
    "Pokémon - 3-Pack Blister - Mega Evolution 6.0: Delta Reign",
    "Pokemon TCG: Delta Reign 3-Pack Blister",
  ])("%s → Seel", async (t) => {
    expect(await match(t)).toBe("Delta Reign: Seel 3-Pack Blister");
  });

  it("⛔ Premium Checklane utan karaktär är tvetydig (fyra i setet) ⇒ ingen länk", async () => {
    expect(await match("Mega Evolution - Delta Reign Premium Checklane Blister")).toBeNull();
  });

  it("⛔ Checklane utan karaktär är tvetydig (Keldeo & Delibird / Xerneas & Deoxys) ⇒ ingen länk", async () => {
    expect(await match("Pokemon ME06 Delta Reign Checklane Blister Booster")).toBeNull();
  });

  it("annonsen som namnger karaktären tar den", async () => {
    expect(await match("MEGA EVOLUTION - DELTA REIGN PREMIUM CHECKLANE DELPHOX")).toBe("Delta Reign: Delphox Premium Checklane Blister");
  });
});

describe("Build & Battle: setnamnet vinner över ett delat ord", () => {
  it("Delta Reign, inte Chilling Reign", async () => {
    expect(await match("Mega Evolution - Delta Reign Build & Battle Box")).toBe("Delta Reign Build & Battle Box");
  });
});

describe("30th Celebration UPC: Day = Espeon, Night = Umbreon", () => {
  it.each([
    ["30th Celebration Ultra Premium Collection Day", "30th Celebration: Espeon Ultra-Premium Collection"],
    ["30th Celebration Ultra Premium Collection Night - av Day eller Night", "30th Celebration: Umbreon Ultra-Premium Collection"],
    ["Pokemon 30th Celebration Ultra Premium Collection Box - Night", "30th Celebration: Umbreon Ultra-Premium Collection"],
    ["Pokémon Mega: 30th Celebration Ultra Premium Collection Box – Day Espeon", "30th Celebration: Espeon Ultra-Premium Collection"],
  ])("%s", async (listing, want) => {
    expect(await match(listing)).toBe(want);
  });

  it("⛔ inget val ('Day / Night', 'Day & Night') ⇒ inget alias", () => {
    for (const t of ["30th Celebration Ultra Premium Collection Box – Day / Night (ENG)", "30th Celebration Ultra-Premium Collection Day & Night"]) {
      expect(applySetAliases(normalizeTitle(t))).not.toMatch(/espeon|umbreon/);
    }
  });
});

describe("Super-Premium: bindestreck och mellanslag är samma ord", () => {
  it.each([
    ["Prismatic Evolutions Super-Premium Collection (SPC) – Engelska", "Prismatic Evolutions Super-Premium Collection"],
    ["Pokemon Prismatic Evolutions Super Premium Collection", "Prismatic Evolutions Super-Premium Collection"],
    ["Pokémon: Charizard ex Super-Premium Collection", "Charizard ex Super-Premium Collection"],
  ])("%s", async (listing, want) => {
    expect(await match(listing)).toBe(want);
  });

  it("poängen skiljer inte på 'super premium' och 'super-premium'", () => {
    expect(scoreSimilarity("super premium collection", "super-premium collection")).toBe(1);
  });
});

describe("⛔ ett startset utan kortnummer är däcket, inte ett kort ur det", () => {
  it("MEGA Starter Set ex ⇒ inget kort", async () => {
    const card = {
      id: "card1",
      normalizedTitle: normalizeTitle("Meowscarada ex (JP) · MEGA Starter Set Sprigatito & Meowscarada ex 005 · mEM"),
      card: { name: "Meowscarada ex (JP)", number: "005" },
      language: "JP" as const,
      variantLabel: null,
    };
    const m = await matchProduct(
      normalizeTitle("Pokémon TCG: MEGA Starter Set ex Sprigatito & Meowscarada ex (JP)"),
      [card],
      "Pokémon TCG: MEGA Starter Set ex Sprigatito & Meowscarada ex (JP)"
    );
    expect(m).toBeNull();
  });
});
