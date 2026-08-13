import { describe, expect, it } from "vitest";
import { cleanListingTitle } from "@/scrapers/matching";

describe("cleanListingTitle", () => {
  it("tar bort köpbegränsningar", () => {
    expect(
      cleanListingTitle("Pokemon SV10.5 - Black Bolt & White Flare - Black Bolt Elite Trainer Box (MAX 1 per kund)")
    ).toBe("Pokemon SV10.5 - Black Bolt & White Flare - Black Bolt Elite Trainer Box");
    // Ledande "Pokémon TCG:" strippas också (ägarbeslut 2026-07-19).
    expect(cleanListingTitle("Pokémon TCG: Lumiose City Mini Tin (Max 5st/kund!)")).toBe(
      "Lumiose City Mini Tin"
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

  it("strippar innehållsbeskrivare i parentes — (5 Cards), (30 Boosters), (20 Pack)", () => {
    expect(cleanListingTitle("Pokémon Scarlet & Violet: Stellar Miracle Booster Pack (5 Cards)")).toBe(
      "Pokémon Scarlet & Violet: Stellar Miracle Booster Pack"
    );
    expect(cleanListingTitle("Mega Symphonia Booster Japansk Display (30 Boosters)")).toBe(
      "Mega Symphonia Booster Japansk Display"
    );
    expect(cleanListingTitle("White Flare Booster Box (20 Pack) (JP)")).toBe(
      "White Flare Booster Box (JP)"
    );
    // Låga paketantal (lot-annonser) lämnas åt multipack-vakten — strippas EJ.
    expect(cleanListingTitle("Paldea Evolved (3 boosters)")).toBe("Paldea Evolved (3 boosters)");
  });

  it("kollapsar dubbla mellanslag och trailing-skräp", () => {
    expect(cleanListingTitle("Pokémon TCG - Sword & Shield  Rebel Clash Booster")).toBe(
      "Sword & Shield Rebel Clash Booster"
    );
    expect(cleanListingTitle("Enhanced 2-Pack Blister: Genie Trio ")).toBe(
      "Enhanced 2-Pack Blister: Genie Trio"
    );
  });

  it("strippar ledande TCG-prefix men inte set-identitet mitt i titeln", () => {
    expect(cleanListingTitle("Pokémon TCG: Paldea Evolved Booster Box")).toBe(
      "Paldea Evolved Booster Box"
    );
    expect(cleanListingTitle("Pokemon Trading Card Game: Silver Tempest Booster Pack")).toBe(
      "Silver Tempest Booster Pack"
    );
    // "Pokémon GO" är SET-namn — prefixet strippas, set-namnet lämnas.
    expect(cleanListingTitle("Pokemon TCG - Pokémon GO Premium Collection")).toBe(
      "Pokémon GO Premium Collection"
    );
    // Bara LEDANDE prefix — "Pokémon" utan TCG rörs inte.
    expect(cleanListingTitle("Pokemon Ascended Heroes Booster Pack")).toBe(
      "Pokemon Ascended Heroes Booster Pack"
    );
  });
});

/**
 * DANSK MOMSORDNING (2026-08-13) — 156 dubbletter ur EN butik.
 *
 * Rogerz (rogerz.dk, wave 5) listar varje begagnad vara två gånger: en gång under
 * vinstmarginalordningen för begagnat ("Brugtmoms") och en gång under vanlig moms
 * ("Alm. moms"). Auto-importen såg två olika titlar och skapade två katalogprodukter.
 * MÄTT: 331 av 898 nyimporterade titlar bar taggen, 156 var rena tvillingpar, och
 * noll av de 31 216 äldre produkttitlarna innehåller orden.
 */
describe("dansk momsordning är butiksadministration, inte identitet", () => {
  it("strippar taggen som suffix", () => {
    expect(cleanListingTitle("Jungle Booster Pack - Unlimited - Scyther / Brugtmoms")).toBe(
      "Jungle Booster Pack - Unlimited - Scyther"
    );
    expect(cleanListingTitle("Platinum Base Set Booster Pack - Shaymin / Alm. moms")).toBe(
      "Platinum Base Set Booster Pack - Shaymin"
    );
    expect(cleanListingTitle("Call of Legends Booster Pack - Deoxys / Alm moms")).toBe(
      "Call of Legends Booster Pack - Deoxys"
    );
  });

  it("strippar taggen MITT i titeln (den formen finns också)", () => {
    expect(cleanListingTitle("XY BreakThrough Elite Trainer Box - Alm. moms / Mewtwo X - Med hul i folie")).toBe(
      "XY BreakThrough Elite Trainer Box / Mewtwo X - Med hul i folie"
    );
  });

  it("kollapsar båda momsvarianterna till EXAKT samma titel", () => {
    // Det är hela mekanismen: variant två får poäng 1,00 mot variant ett och länkas
    // i stället för att bli en ny katalograd (samma självläkning som omslagskonsten).
    const a = cleanListingTitle("Neo Genesis Booster Pack - Unlimited (Neo) - Meganium / Brugtmoms");
    const b = cleanListingTitle("Neo Genesis Booster Pack - Unlimited (Neo) - Meganium / Alm. moms");
    expect(a).toBe(b);
  });

  it("rör inte titlar som bara innehåller 'moms' i annan betydelse", () => {
    expect(cleanListingTitle("Momentum Booster Box")).toBe("Momentum Booster Box");
    expect(cleanListingTitle("Alm. Mewtwo Collection")).toBe("Alm. Mewtwo Collection");
  });
});
