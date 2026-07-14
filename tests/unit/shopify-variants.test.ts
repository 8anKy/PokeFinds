/**
 * SORTIMENTSSIDOR: en Shopify-produkt som är flera SKU:er.
 *
 * Reglerna nedan är MÄTTA mot butikernas riktiga Pokémon-kollektioner (2026-07-14), inte
 * gissade: Speltrollet har ~100 flervariant-produkter i dem och nästan alla är färgkartor
 * (sleeves, pärmar, tärningar). Splittade vi dem blev varje färg en egen annons med egen
 * huvudboksrad och ett "ny produkt"-larm. Testerna låser fast VILKA som får splittas.
 */
import { describe, it, expect } from "vitest";
import { splittableVariants, variantUrl } from "@/scrapers/adapters/shopify-adapter";
import { variantIdFromUrl } from "@/scrapers/gtin-source";
import { productsConflict } from "@/scrapers/matching";

const v = (id: number, title: string, available = false, price = "599.00") => ({ id, title, price, available });

describe("splittableVariants", () => {
  it("splittar ett karaktärssortiment — tre boxar, en sida", () => {
    const split = splittableVariants("Pokemon Ascended Heroes ex Box", [
      v(56369204953414, "Mega Emboar"),
      v(56369204986182, "Mega Meganium"),
      v(56369205018950, "Mega Feraligatr"),
    ]);
    expect(split?.map((x) => x.title)).toEqual(["Mega Emboar", "Mega Meganium", "Mega Feraligatr"]);
  });

  it("splittar battledecks (två Pokémon, en sida)", () => {
    expect(splittableVariants("Pokemon TCG: EX Battle Deck - Houndoom / Melmetal", [
      v(1, "Melmetal"), v(2, "Houndoom"),
    ])).toHaveLength(2);
  });

  it("splittar INTE en färgkarta — det var hela spam-risken", () => {
    expect(splittableVariants("Dragon Shield Classic Matte Sleeves (100-pack)", [
      v(1, "Clear"), v(2, "Black"), v(3, "Ruby"),
    ])).toBeNull();
    expect(splittableVariants("Vault X 12-Pocket Exo-Tec Zip Binder", [
      v(1, "Signature Black"), v(2, "Ocean Blue"),
    ])).toBeNull();
  });

  it("splittar INTE ett tillbehör bara för att varianterna heter Pokémon", () => {
    // Ultra Pro-pärmen finns i Charizard/Pikachu/Gengar — den ska inte bli tre produkter.
    expect(splittableVariants("Ultra Pro Pokemon Elite Series Zip PRO-Binder 12-Pocket (480 kort)", [
      v(1, "Charizard"), v(2, "Pikachu"), v(3, "Gengar"),
    ])).toBeNull();
  });

  it("splittar INTE varianter utan karaktärsnamn (VM-decks = spelarnamn, biljetter, artikelnummer)", () => {
    expect(splittableVariants("Pokémon TCG: 2025 World Championships Decks", [
      v(1, "Riley McKay (Canada)"), v(2, "Yuya Okita (Japan)"),
    ])).toBeNull();
    expect(splittableVariants("Deltagarbiljett - Pokémon TCG Pitch Black Pre-release", [
      v(1, "Deltagarbiljett - 5/7 Innan Lunch"), v(2, "Deltagarbiljett - 5/7 Efter Lunch"),
    ])).toBeNull();
    expect(splittableVariants("Pokemon Battle Figure 6-pack", [
      v(1, "PKW4099"), v(2, "PKW3614"),
    ])).toBeNull();
  });

  it("rör inte vanliga produkter: en variant, eller Shopifys 'Default Title'", () => {
    expect(splittableVariants("Prismatic Evolutions Elite Trainer Box", [v(1, "Default Title", true)])).toBeNull();
    expect(splittableVariants("Prismatic Evolutions ETB", [v(1, "Default Title"), v(2, "Mega Emboar")])).toBeNull();
  });
});

describe("variant-URL", () => {
  it("bär variant-id:t — och gtin-källan läser tillbaka det", () => {
    const url = variantUrl("https://speltrollet.se", "pokemon-ascended-heroes-ex-box", 56369204986182);
    expect(url).toBe("https://speltrollet.se/products/pokemon-ascended-heroes-ex-box?variant=56369204986182");
    expect(variantIdFromUrl(url)).toBe(56369204986182);
    expect(variantIdFromUrl("https://speltrollet.se/products/pokemon-ascended-heroes-ex-box")).toBeNull();
  });
});

describe("länkrevisionen kan skilja boxarna åt", () => {
  // Butikens variantnamn ("… - Mega Meganium") är det revisionen jämför mot. Rätt box får
  // inte larma, fel box MÅSTE larma — annars är vakten värdelös på just den här sidan.
  it("rätt box passerar, syskonet krockar", () => {
    const page = "Pokemon Ascended Heroes ex Box - Mega Meganium";
    expect(productsConflict("Ascended Heroes: Mega Meganium ex Box", page)).toBe(false);
    expect(productsConflict("Ascended Heroes: Mega Emboar ex Box", page)).toBe(true);
    expect(productsConflict("Ascended Heroes: Mega Feraligatr ex Box", page)).toBe(true);
  });
});
