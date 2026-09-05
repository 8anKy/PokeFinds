/**
 * ORDFILTRET. Två fel är lika allvarliga: ett grovt ord som slinker igenom och
 * ett vanligt ord som stoppas. Testet vaktar båda sidorna — särskilt de svenska
 * vardagsorden som råkar likna svordomar.
 */
import { describe, expect, it } from "vitest";
import { containsProfanity, findProfanity, normalizeForProfanity } from "@/lib/profanity";

describe("findProfanity", () => {
  it("fäller grova ord på svenska och engelska, oavsett skiftläge", () => {
    expect(findProfanity("Vilken FITTA du är")).toBe("fitta");
    expect(findProfanity("jävla idiot")).toBe("javla");
    expect(findProfanity("this is bullshit")).toBe("bullshit");
    expect(findProfanity("Fuck off")).toBe("fuck");
    // Skiljetecken efter ordet är inte leetspeak — "Fuck!" blev "fucki" och slank förbi.
    expect(findProfanity("Fuck!")).toBe("fuck");
    expect(findProfanity("vilken jävla skit!")).toBe("javla");
  });

  it("ser igenom diakritiska tecken och leetspeak inne i ord", () => {
    expect(containsProfanity("jäääävla")).toBe(false); // förlängning fälls inte — det är ett annat ord
    expect(containsProfanity("javla")).toBe(true);
    expect(containsProfanity("f4n")).toBe(false); // "fan" är inte på listan
    expect(containsProfanity("sh1t")).toBe(true);
    expect(containsProfanity("fuk")).toBe(false);
    expect(containsProfanity("f u c k")).toBe(false); // bara de fyra starkaste fälls särskrivna …
    expect(containsProfanity("n i g g e r")).toBe(true); // … som den här
  });

  it("fäller sammansättningar via stammar", () => {
    expect(containsProfanity("kukhuvud")).toBe(true);
    expect(containsProfanity("fittstim")).toBe(true);
    expect(containsProfanity("helvetesjobbigt")).toBe(true);
  });

  it("⛔ stoppar INTE vardagsord som liknar svordomar", () => {
    for (const ok of [
      "Jag är ett stort Pokémon-fan",
      "skitbra pulls idag!",
      "på pricken",
      "assess the class",
      "Scunthorpe United",
      "fagott och kontrabas",
      "hell of a pull, damn",
      "Kissade nästan på mig av glädje",
      "Charizard ex 199/165 i NM, 2 500 kr",
      "rov och rovdjur",
      "cocktail",
      "Dickinson",
    ]) {
      expect(findProfanity(ok), ok).toBeNull();
    }
  });

  it("tom text är ren", () => {
    expect(findProfanity("")).toBeNull();
    expect(findProfanity("   ")).toBeNull();
  });

  it("normaliseringen tar bort diakritiska tecken men behåller ordgränser", () => {
    expect(normalizeForProfanity("Jävla Röv-hål!")).toBe("javla rov-hal!");
    // Siffror som står för sig själva förblir siffror — kortnummer ska inte bli bokstäver.
    expect(normalizeForProfanity("199/165")).toBe("199/165");
  });
});
