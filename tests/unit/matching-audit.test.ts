/**
 * REGRESSIONSTEST FRÅN KATALOGREVISIONEN 2026-07-13.
 *
 * Varje butikslänk i katalogen hämtades live, jämfördes mot produkten vi kopplat den
 * till, och varje påstådd felmatchning granskades av en andra agent med uppdrag att
 * MOTBEVISA den (68 av 144 anklagelser föll där). Kvar blev 76 verifierat felaktiga
 * länkar av 1 275 — 6 % av katalogens butikslänkar pekade på fel produkt.
 *
 * Fixturen (tests/fixtures/link-audit-2026-07-13.json) är facit:
 *   wrong   = par som ALDRIG får matcha (feed-titel + produkten den felaktigt kopplades till)
 *   correct = par som MÅSTE fortsätta matcha
 *
 * Testet skyddar båda riktningarna. En ny vakt som fångar fler felaktiga men börjar
 * blockera korrekta länkar är INTE en förbättring — den gör bara skadan tystare.
 * (En tidig version blockerade 178 korrekta länkar innan den mättes.)
 */
import { describe, expect, it } from "vitest";
import fixture from "../fixtures/link-audit-2026-07-13.json";
import { normalizeTitle } from "@/lib/utils";
import { POKEMON_NAMES } from "@/scrapers/pokemon-names";
import {
  blisterMismatch,
  cardSuffixMismatch,
  characterMismatch,
  characterNames,
  isAccessoryListing,
  isSingleCardListing,
  setCodeMismatch,
  unitCountMismatch,
  yearMismatch,
} from "@/scrapers/matching";

/** Vakterna som revisionen gav upphov till, körda på RÅtiteln (som i matchProduct). */
function auditGuards(feed: string, ours: string): string | null {
  if (yearMismatch(feed, ours)) return "ar";
  if (isSingleCardListing(feed) && !isSingleCardListing(ours)) return "singel-kort";
  if (isAccessoryListing(feed) && !isAccessoryListing(ours)) return "tillbehor";
  if (blisterMismatch(feed, ours)) return "blister-form";
  if (unitCountMismatch(feed, ours)) return "antal-enheter";
  // Uppföljningen 2026-07-14 (se nedan).
  if (setCodeMismatch(feed, ours)) return "set-kod";
  if (cardSuffixMismatch(feed, ours)) return "kortsuffix";
  if (characterMismatch(feed, ours)) return "karaktar";
  return null;
}

describe("katalogrevisionen 2026-07-13 — vakterna får inte skada korrekta länkar", () => {
  // DEN VIKTIGA RIKTNINGEN. Att felaktigt blockera en korrekt butikslänk tar bort ett
  // verkligt köpalternativ och kan dölja marknadens lägsta pris — värre än att släppa
  // igenom en felmatch, för det syns aldrig. MÅSTE vara noll.
  it("blockerar INGEN av de verifierat korrekta länkarna", () => {
    const broken = fixture.correct
      .map((p) => ({ ...p, guard: auditGuards(p.feed, p.ours) }))
      .filter((p) => p.guard);
    expect(
      broken.map((b) => `[${b.guard}] "${b.feed}" -> "${b.ours}"`),
      "en vakt blockerar en KORREKT butikslänk"
    ).toEqual([]);
  });
});

describe("katalogrevisionen 2026-07-13 — de felaktiga länkarna fångas", () => {
  // Vakterna fångar inte alla 68 på egen hand (resten stoppas av form-/språk-/
  // setnummer-vakterna och av att kandidatpoolen inte längre trunkeras). Golvet
  // låser fast det vi bevisat: sjunker det har någon tagit bort en vakt.
  it("fångar minst 24 av de 68 felaktiga länkarna", () => {
    const caught = fixture.wrong.filter((p) => auditGuards(p.feed, p.ours));
    expect(caught.length).toBeGreaterThanOrEqual(24);
  });
});

/**
 * UPPFÖLJNING 2026-07-14 — de tre vakter som stängde resten av revisionens luckor.
 *
 * Bakgrund: planen var att sluta matcha på titlar och i stället matcha på tillverkarens
 * artikelnummer (POK…). Den planen är UTREDD OCH DÖD — mätt live mot alla fem Shopify-
 * feedar (1 431 produkter): POK-koden finns i ≥2 butiker för bara 13 produkter, ~20 % av
 * dem är feltypade av butikerna, EAN-koderna överlappar inte alls mellan butiker, och
 * Dragon's Lair — vår största felkälla (19 av 68) — saknar koden både i feeden OCH på
 * produktsidan. Återuppliva den inte utan att mäta om täckningen först.
 *
 * De 26 kvarvarande felen visade sig i stället alla vara avgörbara ur TITELN. Alla tre
 * vakter är TVÅSIDIGA: de fäller bara när BÅDA titlarna anger något och det KROCKAR.
 * En ENSIDIG variant ("kandidaten har ett ord annonsen saknar") är precis den
 * reverse-coverage-vakt som blockerade 178 KORREKTA länkar — bygg den aldrig.
 *
 * Resultat end-to-end genom riktiga matchProduct, mätt mot facit:
 *   felaktiga förhindrade  46/68 → 51/68
 *   korrekta bevarade     199/217 → 199/217  (oförändrat — noll skada)
 */
describe("uppföljning 2026-07-14 — set-kod, kortsuffix, karaktär", () => {
  it("set-kod: sv1S ≠ sv2P, ME02 ≠ ME04 (japanska displayer har nästan identisk Dice)", () => {
    expect(setCodeMismatch(
      "Pokémon, Scarlet & Violet: Scarlet ex - sv1S, Display / Booster Box (Japansk)",
      "Pokémon, Scarlet & Violet: Snow Hazard - sv2P, Display / Booster Box (Japansk)"
    )).toBe(true);
    expect(setCodeMismatch("Pokémon ME02 Phantasmal Flames ETB", "Pokemon ME04 Chaos Rising ETB")).toBe(true);
    // Ledande nollor är inte identitet: ME02 === ME2.
    expect(setCodeMismatch("Pokémon ME02 Phantasmal Flames", "Pokemon ME2 Phantasmal Flames")).toBe(false);
    // ENSIDIGT (bara ena titeln har kod) → vet vi ingenting → får ALDRIG fälla.
    // "Pokemon ME4 Chaos Rising ETB" -> "Chaos Rising Elite Trainer Box" är en KORREKT länk.
    expect(setCodeMismatch("Pokemon ME4 Chaos Rising Elite Trainer Box", "Pokémon TCG: Chaos Rising Elite Trainer Box")).toBe(false);
  });

  it("kortsuffix: ex ≠ V ≠ VMAX — samma karaktär, olika produkt", () => {
    expect(cardSuffixMismatch("The Pokémon TCG: Melmetal ex Battle Deck", "Pokemon TCG Pokemon GO Battle Deck Melmetal V")).toBe(true);
    expect(cardSuffixMismatch("Pokémon Rapid Strike Urshifu V Box", "Rapid Strike Urshifu VMAX Premium Collection")).toBe(true);
    // Delat suffix → ingen krock (de skiljs åt av andra vakter).
    expect(cardSuffixMismatch("Lucario ex Battle Deck", "Mega Lucario ex League Battle Deck")).toBe(false);
    // Ensidigt → får inte fälla (butiker utelämnar ofta suffixet).
    expect(cardSuffixMismatch("Charizard Premium Collection", "Charizard ex Premium Collection")).toBe(false);
  });

  it("karaktär: Checklane Porygon2 ≠ Checklane Koraidon", () => {
    expect(characterMismatch("Pokémon TCG: Stellar Crown Checklane Porygon2", "Stellar Crown: Koraidon Premium Checklane Blister")).toBe(true);
    expect(characterMismatch("Pokémon, Generations, 1 Booster (Venusaur Artwork)", "Pokémon, Generations, 1 Booster (Charizard Artwork)")).toBe(true);
    // SNITT, inte likhet: delad karaktär räcker.
    expect(characterMismatch("Pikachu & Zekrom GX Box", "Zekrom GX Box")).toBe(false);
    // Ensidigt → får inte fälla. Butikstiteln utelämnar ofta karaktären.
    expect(characterMismatch("Pokémon TCG - Phantasmal Flames Checklane", "Phantasmal Flames: Blaziken Premium Checklane Blister")).toBe(false);
  });

  // Vokabulären är den enda vakt vars falskpositiver är OSYNLIGA (en blockerad korrekt
  // länk syns aldrig). Dessa ord är SETNAMN/produkttyper/färger i riktiga titlar — de får
  // ALDRIG räknas som karaktärer, hur mycket de än liknar tränarnamn.
  it("vokabulären innehåller inga ord som kolliderar med setnamn eller vanliga ord", () => {
    for (const trap of ["lance", "blue", "red", "penny", "n", "will", "karen", "chuck", "hop", "arena"]) {
      expect(POKEMON_NAMES.has(trap), `"${trap}" i vokabulären → falsk karaktärskrock`).toBe(false);
    }
    // Bevisen från riktiga titlar: dessa får inte ge NÅGON karaktär alls.
    expect([...characterNames("Pokemon Silver Lance Booster (s6h)(Japansk)")]).toEqual([]);
    expect([...characterNames("Ultra Pro Standard Sleeves - Regular Soft Card (Penny Sleeves)")]).toEqual([]);
    expect([...characterNames("Zinnia's Resolve (s7r 079) Blue Sky Stream - PSA 10")]).toEqual([]);
    // ...men de äkta karaktärerna hittas, inkl. tränare och flerordsnamn.
    expect([...characterNames("Pokemon Cynthia's Garchomp ex Premium Collection")].sort()).toEqual(["cynthia", "garchomp"]);
    expect([...characterNames("Pokemon The Glory of Team Rocket Booster Box (Japansk)")]).toEqual(["team rocket"]);
  });
});

describe("vakterna var för sig — verkliga fall ur revisionen", () => {
  it("årtal: samma produkt olika årgång är olika SKU", () => {
    // Butikerna säljer flera årgångar samtidigt; Dice-likheten är nästan 1.
    expect(yearMismatch("Pokemon TCG Poke Ball Tin 2026", "Pokemon TCG: Poké Ball Tin 2025")).toBe(true);
    expect(yearMismatch("Pokémon TCG: Trainer's Toolkit 2023", "Pokemon TCG Trainers Toolkit 2025")).toBe(true);
    expect(yearMismatch("Pokémon TCG: Fall 2024 Mini Portfolio + Booster", "Pokémon TCG: Fall 2026 Mini Portfolio + Booster")).toBe(true);
    // Saknas årtal på ena sidan vet vi ingenting → får INTE fälla.
    expect(yearMismatch("Poké Ball Tin", "Pokemon TCG: Poké Ball Tin 2025")).toBe(false);
    expect(yearMismatch("Surging Sparks Booster Box", "Surging Sparks Booster Box")).toBe(false);
  });

  it("singelkort: ett enskilt kort får aldrig bli offer på en sealed-produkt", () => {
    expect(isSingleCardListing("Skeledirge ex - SVP081 Black Star Promo")).toBe(true);
    expect(isSingleCardListing("Reshiram & Charizard GX (sm12a 220) Tag Team GX - PSA 1")).toBe(true);
    expect(isSingleCardListing("Charizard (CEL BS 4) Celebrations - PSA 10")).toBe(true);
    expect(isSingleCardListing("Noctowl #141 Pokémon Scarlet & Violet: Stellar Crown")).toBe(true);
    // FALSKPOSITIVER som en tidig version orsakade — får aldrig återkomma:
    // japansk SETKOD i parentes är inte ett kortnummer (kräver mellanslag före siffran)
    expect(isSingleCardListing("Pokemon Ruler Of The Black Flame Booster Box (sv3)(Japansk)")).toBe(false);
    expect(isSingleCardListing("Pokemon Mask of Change Booster Box (sv6) (Japansk)")).toBe(false);
    // HTML-entiteten &#039; innehåller "#039" — inte ett kortnummer
    expect(isSingleCardListing("Pokemon Cynthia&#039;s Garchomp ex Premium Collection Box")).toBe(false);
    expect(isSingleCardListing("Pokémon TCG: Surging Sparks Booster Box")).toBe(false);
  });

  it("tillbehör: spelmatta/pärm/akryl är inte en sealed-produkt", () => {
    expect(isAccessoryListing("Mega Charizard X/Y Spelmatta - M")).toBe(true);
    expect(isAccessoryListing("Charmander Mini Pärm - 3 Pocket")).toBe(true);
    expect(isAccessoryListing("Acrylic Booster Box Display for Pokémon")).toBe(true);
    // En pärm SOM INNEHÅLLER en booster är en riktig SKU → får inte flaggas.
    expect(isAccessoryListing("Pokémon TCG: Spring 2025 Mini Portfolio + Journey Together Booster")).toBe(false);
    expect(isAccessoryListing("Surging Sparks Booster Box")).toBe(false);
  });

  it("blister: checklane ÄR en 1-pack, men 1-pack ≠ 3-pack", () => {
    // Riktiga felmatchningar
    expect(blisterMismatch("Pokémon ME03 Perfect Order - Blister (1-pack)", "Pokemon TCG Perfect Order 3-pack Blister")).toBe(true);
    expect(blisterMismatch("Pokémon TCG: Perfect Order - Checklane Makuhita", "Pokemon TCG Perfect Order 3-pack Blister")).toBe(true);
    // ...men checklane och 1-pack är SAMMA SKU. En tidig version blockerade 18 sådana
    // KORREKTA länkar innan den mättes mot facit.
    expect(blisterMismatch("Pokémon TCG: Destined Rivals Checklane Zarude", "Destined Rivals: Zarude 1-Pack Blister")).toBe(false);
    expect(blisterMismatch("Pokémon TCG: Surging Sparks Checklane Wooper", "Surging Sparks: Wooper 1-Pack Blister")).toBe(false);
  });

  it("antal: en enhet ≠ display/flerpack av samma enhet", () => {
    expect(unitCountMismatch("Pokémon TCG: Kanto Power Mini Tin", "Kanto Power Mini Tin 5-Pack Box")).toBe(true);
    expect(unitCountMismatch("Pokemon TCG - SWSH 12.5 Crown Zenith: Mini Tin", "Crown Zenith: Mini Tin Display")).toBe(true);
    // "Booster Box" ÄR en display → får inte fälla mot varandra.
    expect(unitCountMismatch("Destined Rivals Display (36 boosters)", "Destined Rivals Booster Box")).toBe(false);
  });
});

describe("HTML-entiteter i butiksfeeds", () => {
  // "&#x27;" innehåller "x27" → multipack-vakten läste det som "×27 styck" och kastade
  // hela annonsen som lot-annons. Varje produkt med apostrof drabbades.
  it("avkodas innan normalisering (annars blir apostrofen en kvantitet)", () => {
    expect(normalizeTitle("Pokemon TCG: Team Rocket&#x27;s Mewtwo ex League Battle Deck")).toContain("rocket s mewtwo");
    expect(normalizeTitle("Pokemon TCG: Team Rocket&#x27;s Mewtwo ex League Battle Deck")).not.toContain("x27");
    expect(normalizeTitle("Cynthia&#039;s Garchomp ex")).not.toContain("039");
    expect(normalizeTitle("Scarlet &amp; Violet")).toContain("scarlet violet");
  });
});

// Tillbehörsvakten missade tredjepartsmärken och skyddsplast (2026-07-14): fyra
// tillbehör låg i sealed-katalogen. classifyForm läste "Booster Pack"/"Booster
// Display" i titeln och kallade dem sealed — butikssidorna säger uttryckligen
// "Booster pack and cards not included".
describe("isAccessoryListing — tredjepartsmärken och skyddsplast", () => {
  it("fångar de fyra som faktiskt tog sig in i katalogen", () => {
    expect(isAccessoryListing("Ultra Pro Booster Pack UV ONETOUCH Magnetic Holder")).toBe(true);
    expect(isAccessoryListing("Evoretro PET Protectors for Pokemon Booster Display Boxes (5-Pack)")).toBe(true);
    expect(isAccessoryListing("Evoretro PET Protectors for Pokemon Elite Trainer Boxes (5-Pack)")).toBe(true);
    expect(isAccessoryListing("Ultimate Guard Tokens Booster")).toBe(true);
  });

  // DEN FARLIGA RIKTNINGEN. En vakt som råkar svälja riktiga sealed-SKU:er tar bort
  // produkter ur katalogen — värre än att släppa igenom ett tillbehör.
  it("rör INTE riktiga sealed-produkter med snarlika ord", () => {
    // "Booster Case" = en kartong displayer, en äkta SKU. Bart "case" får aldrig matcha.
    expect(isAccessoryListing("Paldea Evolved 24 Sleeved Booster Case")).toBe(false);
    // "Ultra" ensamt är förbjudet i märkesvakten — annars dör hela UPC-serien.
    expect(isAccessoryListing("Hidden Fates: Ultra-Premium Collection")).toBe(false);
    expect(isAccessoryListing("Mega Charizard X ex Ultra Premium Collection")).toBe(false);
    // Pärm MED booster är en riktig kombo-SKU (befintlig regel, får inte regrera).
    expect(isAccessoryListing("Pokémon TCG: Fall 2024 Mini Portfolio + Booster")).toBe(false);
    expect(isAccessoryListing("Pokémon TCG: Surging Sparks Booster Box")).toBe(false);
  });
});
