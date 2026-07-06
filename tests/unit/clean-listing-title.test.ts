import { describe, expect, it } from "vitest";
import { cleanListingTitle } from "@/scrapers/matching";

describe("cleanListingTitle", () => {
  it("tar bort köpbegränsningar", () => {
    expect(
      cleanListingTitle("Pokemon SV10.5 - Black Bolt & White Flare - Black Bolt Elite Trainer Box (MAX 1 per kund)")
    ).toBe("Pokemon SV10.5 - Black Bolt & White Flare - Black Bolt Elite Trainer Box");
    expect(cleanListingTitle("Pokémon TCG: Lumiose City Mini Tin (Max 5st/kund!)")).toBe(
      "Pokémon TCG: Lumiose City Mini Tin"
    );
    expect(cleanListingTitle("Pokémon - Booster Pack - Chaos Rising (Max 12st per kund)")).toBe(
      "Pokémon - Booster Pack - Chaos Rising"
    );
    expect(cleanListingTitle("Mini Tin - Alla fem tins (Max 1st per hushåll)")).toBe(
      "Mini Tin - Alla fem tins"
    );
  });

  it("tar bort förhandsboknings- och kopie-markörer", () => {
    expect(cleanListingTitle("Pokemon Ascended Heroes Mini Tin Förhandsbokning")).toBe(
      "Pokemon Ascended Heroes Mini Tin"
    );
    expect(cleanListingTitle("Pokemon Black Bolt Booster Box Display (Japansk) (Copy)")).toBe(
      "Pokemon Black Bolt Booster Box Display (Japansk)"
    );
    expect(cleanListingTitle("Pokemon Abyss Eye Booster Pack - kopia")).toBe(
      "Pokemon Abyss Eye Booster Pack"
    );
    expect(cleanListingTitle("Black Bolt & White Flare Mini Tin (1 pcs)")).toBe(
      "Black Bolt & White Flare Mini Tin"
    );
  });

  it("rör INTE produktidentitet eller språkmarkörer", () => {
    expect(cleanListingTitle("Pokémon VMAX Climax Booster Box (Japansk)")).toBe(
      "Pokémon VMAX Climax Booster Box (Japansk)"
    );
    expect(cleanListingTitle("First Partner Illustration Collection Series 2")).toBe(
      "First Partner Illustration Collection Series 2"
    );
    expect(cleanListingTitle("Mega Charizard X Pin 3-Pack Blister")).toBe(
      "Mega Charizard X Pin 3-Pack Blister"
    );
  });

  it("kollapsar dubbla mellanslag och trailing-skräp", () => {
    expect(cleanListingTitle("Pokémon TCG - Sword & Shield  Rebel Clash Booster")).toBe(
      "Pokémon TCG - Sword & Shield Rebel Clash Booster"
    );
    expect(cleanListingTitle("Enhanced 2-Pack Blister: Genie Trio ")).toBe(
      "Enhanced 2-Pack Blister: Genie Trio"
    );
  });
});
