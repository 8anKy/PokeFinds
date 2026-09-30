import { describe, it, expect } from "vitest";
import {
  cleanListingTitle,
  decodeTitleEntities,
  isUnselectedVariantListing,
  resolveVariantPick,
} from "@/scrapers/matching";

// Dubblettstubbarna i september 2026 — varje fall här blev en egen katalogprodukt
// bredvid den riktiga innan reglerna fanns.
describe("resolveVariantPick", () => {
  it("parentes-listan ersätts med det valda alternativet", () => {
    expect(resolveVariantPick("Ascended Heroes ex Box (Mega Meganium / Emboar / Feraligatr) - Meganium")).toBe(
      "Ascended Heroes ex Box (Mega Meganium)"
    );
    expect(resolveVariantPick("Ascended Heroes - Premium Poster Collection (Lucario ex / Gardevoir ex) - Lucario")).toBe(
      "Ascended Heroes - Premium Poster Collection (Lucario ex)"
    );
  });
  it("streck-segmentet ersätts med det valda alternativet", () => {
    expect(resolveVariantPick("30th Celebration ex Tin – Greninja ex / Sylveon ex - Sylveon ex")).toBe(
      "30th Celebration ex Tin – Sylveon ex"
    );
    expect(resolveVariantPick("Pokemon TCG: Deluxe Battle Deck - Meowscarada / Quaquaval - Quaquaval")).toBe(
      "Pokemon TCG: Deluxe Battle Deck - Quaquaval"
    );
  });
  it("rör inget när valet inte är exakt ett av alternativen", () => {
    const t = "Scarlet & Violet - Twilight Masquerade Booster Box";
    expect(resolveVariantPick(t)).toBe(t);
    expect(resolveVariantPick("Box (Pikachu / Eevee) - Snorlax")).toBe("Box (Pikachu / Eevee) - Snorlax");
  });
});

describe("isUnselectedVariantListing", () => {
  it("fäller 'or'/'eller'-listor utan val", () => {
    expect(isUnselectedVariantListing("Pokémon Ascended Heroes - EX Box Mega Meganium, Feraligtr or Emboar")).toBe(true);
    expect(isUnselectedVariantListing("30th Celebration Ultra-Premium Collection Night or Day")).toBe(true);
    expect(isUnselectedVariantListing("ex Box Sylveon eller Greninja")).toBe(true);
  });
  it("snedstreck är INTE ett val (synonymer, tag team, två i en)", () => {
    expect(isUnselectedVariantListing("Pokémon, Sword & Shield: Astral Radiance, Display / Booster Box")).toBe(false);
    expect(isUnselectedVariantListing("2019 Tag Team Tin Pikachu/Zekrom")).toBe(false);
    expect(isUnselectedVariantListing("Cyrus / Klara Premium Tournament Collection Display")).toBe(false);
  });
  it("Trick or Trade är en produktlinje", () => {
    expect(isUnselectedVariantListing("Trick or Trade BOOster Bundle 2024")).toBe(false);
  });
});

describe("cleanListingTitle — butiksbrus", () => {
  it("avkodar numeriska HTML-entiteter (WooCommerce)", () => {
    expect(decodeTitleEntities("Mega Evolution &#8211; Pitch Black")).toBe("Mega Evolution – Pitch Black");
    expect(decodeTitleEntities("Cynthia&#039;s Garchomp")).toBe("Cynthia's Garchomp");
    expect(cleanListingTitle("Mega Evolution &#8211; Pitch Black 2-pack Blister (Zarude)")).toBe(
      "Mega Evolution – Pitch Black 2-pack Blister (Zarude)"
    );
  });
  it("tar bort (Förbeställning) och (med/utan plast)", () => {
    expect(cleanListingTitle("Pokémon 30th Celebration: Booster Bundle (Förbeställning)")).toBe(
      "Pokémon 30th Celebration: Booster Bundle"
    );
    expect(cleanListingTitle("30th ETB (utan plast)")).toBe("30th Celebration ETB");
  });
  it("'30th' först i titeln = 30th Celebration, men bara där", () => {
    expect(cleanListingTitle("30th ETB")).toBe("30th Celebration ETB");
    expect(cleanListingTitle("30th Celebration ETB")).toBe("30th Celebration ETB");
    expect(cleanListingTitle("Pokemon 30th Aniversary Elite Trainer Box")).toBe("Pokemon 30th Aniversary Elite Trainer Box");
    expect(cleanListingTitle("Pokémon, Celebrations - 30th, Display / Booster Box (Japansk)")).toBe(
      "Pokémon, Celebrations - 30th, Display / Booster Box (Japansk)"
    );
  });
});
