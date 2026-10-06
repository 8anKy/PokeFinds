import { describe, expect, it } from "vitest";
import {
  GRADED_MIN_DAYS_AFTER_RELEASE,
  detectGrading,
  gradedTooSoonAfterRelease,
  gradingVerdictFor,
  isAspirationalGradeTitle,
  isGradedListing,
} from "@/lib/graded-listing";

/**
 * ⛔ TVÅSIDIG VAKT. Ett för snävt filter släpper in slabbar i den råa kurvan
 * (felet vi mätte: 591 prisobservationer och 16 offers på RAW produkter var
 * graderade kort). Ett för brett filter kastar bort riktiga råa prispunkter —
 * "PSA10 Kandidat" är ett OGRADERAT kort. Båda riktningarna måste testas, och
 * varje titel nedan är hämtad ur verklig Tradera-data 2026-09-04.
 */
describe("isGradedListing", () => {
  it("ser graderade kort ur titeln", () => {
    const graded = [
      "PSA 10 – Voltorb SV13 - Holo - Hidden Fates",
      "Pokemon TCG PSA 9 Celebrations Zacian V 016/025 ENG-MINT",
      "Zekrom EX #166 BGS 9.5 - Pokémon Black Bolt",
      "Mega Charizard X EX CGC Gem Mint 10",
      "Sylveon TG14/30 Brilliant stars Rauk 8",
      "Lillie's determination 184/132 rauk 10 från Mega Evolution.",
      "Arbok Temporal Forces 176 Pokemon Graded Card 9 RaukCard",
      "Toedscool 201 Scarlet & Violet Pokemon Graded Card 9 Globalgrading",
      "Psyduck 226/217 BECKETT 9 Ascended Heroes Pokemonkort",
      "Glaceon V alternate art 175/203 - Evolving Skies - ACE 10",
      "Mewtwo 12/18 Graderad 7",
      "Eevee 74/110 Legendary Collection Pokemonkort Pristine 10",
      "Latias & Latios-GX 170/181 Team Up Pokemonkort CGC 6",
    ];
    for (const title of graded) {
      expect(isGradedListing({ title }), title).toBe(true);
    }
  });

  it("släpper igenom RÅA kort som bara NÄMNER gradering", () => {
    const raw = [
      // Säljaren gissar ett framtida betyg — kortet är ograderat.
      "PSA10 Kandidat - Cubone 60/112 Common Vintage – EX FireRed & LeafGreen",
      "Clefairy 094/088 möjligen psa 10",
      "Pokémonkort Dark Blastoise 20 Team Rocket WOTC perfekt för gradering",
      // ⛔ Aspirationen namnger BOLAGET, inte ordet "gradering" — och Tradera har
      // dessutom kapat slugen mitt i "psa-10". Verklig offer i produktionen.
      "pokémonkort dark blastoise 20 team rocket wotc perfekt for psa 1",
      "Charizard 4/102 Base Set — bra för PSA, aldrig spelad",
      "Charizard 4/102 Base Set - ograderad, skulle få PSA 8",
      "Mewtwo 10/102 Base Set – ungraded",
      // Kortmekaniker som råkar heta som graderingsbolag.
      "Reshiram & Charizard GX Tag Team 20/214 Unbroken Bonds",
      "Hero's Cape ACE SPEC 152/162 Temporal Forces",
      // Vanliga råa annonser utan minsta graderingssignal.
      "Blaine's Arcanine 1/132 Gym Challenge Pokemonkort",
      "Charmeleon 079 English Promo Pokemonkort",
      "Poliwrath 13/102 Base set Pokemonkort",
    ];
    for (const title of raw) {
      expect(isGradedListing({ title }), title).toBe(false);
    }
  });

  it("litar på Traderas attribut även när titeln är tyst", () => {
    // Mätt: en PSA-slab i kategori 1001337 vars titel inte nämner gradering alls.
    expect(
      isGradedListing({
        title: "Dragonite [Master Ball] #149 Pokemon Japanese Scarlet & Violet",
        attrIssuer: "PSA",
      })
    ).toBe(true);
  });

  it("aspirationsvetot slår även attribut-vägen (2026-10-06)", () => {
    // Säljaren som skriver "PSA 10 Contender" fyller också i PSA/10 i fältet —
    // titeln som säger "inte graderad" vinner.
    expect(isGradedListing({ title: "PSA 10-kandidat", attrIssuer: "PSA", attrGrade: "10" })).toBe(false);
    expect(
      isGradedListing({ title: "Mew ex 152/128 30th Celebration Pokemonkort PSA 10 Contender", attrIssuer: "PSA", attrGrade: "10" })
    ).toBe(false);
  });

  it("fäller råa kort med betyg som förhoppning (30th Celebration, 2026-10-06)", () => {
    for (const title of [
      "Mew ex 152/128 30th Celebration Pokemonkort PSA 10 Contender",
      "Mew ex 152/128 30-årsjubileum Pokémonkort - PSA 10 potential",
      "Articuno 132/128 30-årsfirande PSA 10-utmanare",
      'Pikachu Ex 149/128 "PSA 10 lockande kort"',
      "Pikachu ex 150/128 Raw möjligen PSA 10 30th Celebration Pokemonkort",
      "Gengar ex 154/128 (PSA 10 kandidat?!)",
      "Mega Chandelure ex 115/084 – Pokémon – Near Mint / PSA 10?",
      "1999 Pokémon Base Set 1st Edition Machamp Holo 8/102 WOTC NM Raw PSA 8 Contender",
      "TEAM ROCKET’S DUGTRIO 239/217 FULL ART ASCENDED HEROES PSA 10 POTEN",
    ]) {
      expect(isGradedListing({ title }), title).toBe(false);
      expect(isAspirationalGradeTitle(title), title).toBe(true);
    }
  });

  it("vetot rör inte riktiga slabbar", () => {
    for (const title of [
      "2002 mewtwo expedition 56/165 Non Holo PSA 8, Very Clean Regrade Candidate",
      "Chansey 187/167 Sv06: Twilight Masquerade Holo PSA 9",
      "Togekiss IR 235/217 Ascended Heroes CGC 10 Pristine 2026",
      "2004 Pokemon TCG Sceptile 4/17 Pop Series 1 Holo Rare Card PSA 9 Possible PSA 10",
      "Typhlosion 17/111 Holo Neo Genesis Pokemon WOTC CGC 8(PSA 8?)",
      "Pokemon Ascended Hero’s Holo Psyduck IR 226/217 BGS 9.5!🔥(Possible Crossover)",
      "2013 Pokemon Plasma Blast Dialga EX #99 TAG 8 Potential PSA 9 Check DIG Report",
      "Meowth 10/53 Wotc Promo Holo CGC 9 - Cross Grade Candidate for PSA - New Cert",
    ]) {
      expect(isAspirationalGradeTitle(title), title).toBe(false);
      expect(isGradedListing({ title }), title).toBe(true);
    }
  });
});

describe("gradedTooSoonAfterRelease", () => {
  const release = new Date("2026-09-16T00:00:00Z");
  it("fäller affärer innan kortet hunnit graderas", () => {
    expect(gradedTooSoonAfterRelease(release, "2026-09-17T12:00:00Z")).toBe(true);
    expect(gradedTooSoonAfterRelease(release, "2026-10-02T17:00:00Z")).toBe(true);
    // Före släppet (förhandsförsäljning) är lika omöjligt.
    expect(gradedTooSoonAfterRelease(release, "2026-09-01T00:00:00Z")).toBe(true);
  });
  it("släpper igenom efter fönstret", () => {
    expect(gradedTooSoonAfterRelease(release, new Date(release.getTime() + GRADED_MIN_DAYS_AFTER_RELEASE * 86_400_000))).toBe(false);
    // Äkta slabbar mätta 29 dygn efter släpp — måste klara sig.
    expect(gradedTooSoonAfterRelease("2026-01-30", "2026-02-28")).toBe(false);
  });
  it("okänt släppdatum ⇒ ingen dom", () => {
    expect(gradedTooSoonAfterRelease(null, "2026-09-17")).toBe(false);
    expect(gradedTooSoonAfterRelease(undefined, "2026-09-17")).toBe(false);
  });
});

describe("detectGrading", () => {
  it("läser bolag och betyg ur attributen först", () => {
    expect(detectGrading({ title: "Mew ex 205/165 Hyper Rare", attrIssuer: "ACE", attrGrade: "10" })).toEqual({
      issuer: "ACE",
      gradeTenths: 100,
      from: "attribute",
    });
  });

  it("normaliserar Traderas 'Beckett' till BGS och 'Raukcard' till RAUKCARD", () => {
    expect(detectGrading({ title: "x", attrIssuer: "Beckett", attrGrade: "9.5" })?.issuer).toBe("BGS");
    expect(detectGrading({ title: "x", attrIssuer: "Raukcard", attrGrade: "9" })?.issuer).toBe("RAUKCARD");
  });

  it("hämtar bolaget ur titeln när attributet säger 'Övriga'", () => {
    // Traderas vokabulär saknar SGC/TAG/HGA/GMA — alla hamnar i "Övriga".
    const info = detectGrading({
      title: "Mega Gengar EX #240 Mega Dream TAG grading 10 Gem Mint",
      attrIssuer: "Övriga",
      attrGrade: "10",
    });
    expect(info?.issuer).toBe("TAG");
    expect(info?.gradeTenths).toBe(100);
  });

  it("ger OTHER när betyget är känt men bolaget inte", () => {
    const info = detectGrading({ title: "Mewtwo 12/18 Graderad 7" });
    expect(info?.issuer).toBe("OTHER");
    expect(info?.gradeTenths).toBe(70);
  });

  it("ger betyg null i stället för 0 när betyget saknas", () => {
    // ⛔ "0" skulle läsas som betyg noll. Okänt är okänt.
    const info = detectGrading({ title: "Celebi Gold Star Japanese PSA", attrIssuer: "PSA" });
    expect(info?.issuer).toBe("PSA");
    expect(info?.gradeTenths).toBeNull();
  });

  it("räknar halvsteg i tiondelar och avvisar skalfel", () => {
    expect(detectGrading({ title: "Zekrom EX BGS 9.5" })?.gradeTenths).toBe(95);
    expect(detectGrading({ title: "Charizard PSA 11" })).toBeNull();
    expect(detectGrading({ title: "Charizard 4/102 PSA 0" })).toBeNull();
  });

  it("vägrar döma när titeln nämner två bolag", () => {
    // "PSA 10 / CGC 9,5" är en lott eller en jämförelse, inte en identifierad slab.
    const info = detectGrading({ title: "Lot: Charizard PSA 10 och Blastoise CGC 9" });
    expect(info?.issuer).toBe("OTHER");
  });

  it("returnerar null för ograderade kort", () => {
    expect(detectGrading({ title: "Poliwrath 13/102 Base set Pokemonkort" })).toBeNull();
    expect(detectGrading({ title: "PSA10 Kandidat - Cubone 60/112" })).toBeNull();
  });
});

/**
 * ⛔ FÖRSEGLAT HAR INGEN GRADERAD SERIE (2026-09-22). Titlarna är verkliga
 * Tradera-affärer som låg i `GradedSale` på boosterpaket och ETB:er — säljaren
 * hade fyllt i graderingsfältet ("Övriga") på en förseglad vara.
 */
describe("gradingVerdictFor", () => {
  it("förseglat + bara attributet ⇒ vanlig förseglad affär", () => {
    for (const title of [
      "Pokemon 1x Pitch Black booster pack sealed",
      "Pokemon Elite Trainer Box Mega Evolution Pitch Black",
      "Pokemon \"Ascended Heroes\" Boosterpaket",
    ]) {
      expect(gradingVerdictFor("BOOSTER_PACK", { title, attrIssuer: "Övriga", attrGrade: "10" })).toEqual({ kind: "raw" });
    }
  });

  it("förseglat + graderat i titeln ⇒ skippas helt", () => {
    expect(gradingVerdictFor("BOOSTER_PACK", { title: "PSA 9 Evolving Skies booster pack" })).toEqual({ kind: "skip" });
  });

  it("kort ⇒ samma dom som förut", () => {
    const v = gradingVerdictFor("SINGLE_CARD", { title: "Charizard 4/102", attrIssuer: "PSA", attrGrade: "10" });
    expect(v.kind).toBe("graded");
    expect(gradingVerdictFor("SINGLE_CARD", { title: "Charizard 4/102" })).toEqual({ kind: "raw" });
  });
});
