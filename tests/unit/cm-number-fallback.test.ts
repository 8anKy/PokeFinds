import { describe, it, expect } from "vitest";
import {
  cmNumberKey,
  cmNumberKeyNoSetCode,
  cmSetNameKey,
  cmCardNameAgrees,
} from "../../src/jobs/cardmarket-refresh";

// Regression 2026-07-26: `tcgid` var singel-fasens enda nyckel och räckte inte —
// Pitch Black (me5) hade tcgid=null på alla 120 korten, Perfect Order/Chaos Rising
// bar CM:s setkod ("POR-1"/"CRI-1") i stället för pokemontcg.io:s ("me3-1").
// 366 singlar i tre nya set fick därför ingen CM-offer, inget pris och ingen
// historikpunkt. Reserven matchar på set + samlarnummer + kortnamn.

describe("cmNumberKey", () => {
  it("nollutfyllnad spelar ingen roll", () => {
    expect(cmNumberKey("001")).toBe(cmNumberKey("1"));
    expect(cmNumberKey("084")).toBe(cmNumberKey(84));
    expect(cmNumberKey("MEP 001")).toBe(cmNumberKey("MEP001"));
  });

  it("behåller bokstavssuffix — 115a är ett ANNAT kort än 115", () => {
    expect(cmNumberKey("115a")).not.toBe(cmNumberKey("115"));
    expect(cmNumberKey("115a")).toBe(cmNumberKey("115A"));
  });

  it("tomt nummer ger tom nyckel (anroparen ska avstå)", () => {
    expect(cmNumberKey(null)).toBe("");
    expect(cmNumberKey(undefined)).toBe("");
    expect(cmNumberKey("  ")).toBe("");
  });
});

// Regression 2026-08-05: MEP 023 "Mega Charizard X ex" bar `cardmarket_id` 873704,
// som hos Cardmarket heter "N's Zekrom". Korten i promo-seten saknar tcgid, så när
// det fältet ljuger fanns ingen väg alls fram till produkten: kortet föll ur
// körningen och guide-reserven publicerade en UPPSKATTNING (59,09 €) märkt
// "Sold out" — fast feedens egen rad bar rätt From (38,00 €) hela tiden.
// Reserven matchar därför på set + nummer + namn, med setkoden avskalad.
describe("cmNumberKeyNoSetCode", () => {
  it("setkoden faller när den står som EGET ORD — det var hela buggen", () => {
    expect(cmNumberKeyNoSetCode("MEP 023")).toBe(cmNumberKeyNoSetCode("023"));
    expect(cmNumberKeyNoSetCode("MEP 023")).toBe("23");
    expect(cmNumberKeyNoSetCode("SWSH-045")).toBe("45");
  });

  it("⛔ men ALDRIG när bokstäverna ÄR numret", () => {
    // "TG10" → "10" hade krockat med kort 10 i samma set.
    expect(cmNumberKeyNoSetCode("TG10")).toBe(cmNumberKey("TG10"));
    expect(cmNumberKeyNoSetCode("GG08")).toBe(cmNumberKey("GG08"));
    expect(cmNumberKeyNoSetCode("SWSH034")).toBe(cmNumberKey("SWSH034"));
    expect(cmNumberKeyNoSetCode("SV075")).toBe(cmNumberKey("SV075"));
    expect(cmNumberKeyNoSetCode("TG10")).not.toBe("10");
  });

  it("bokstavssuffix står kvar — 115a är ett annat kort än 115", () => {
    expect(cmNumberKeyNoSetCode("MEP 115a")).not.toBe(cmNumberKeyNoSetCode("MEP 115"));
    expect(cmNumberKeyNoSetCode("MEP 115a")).toBe("115a");
  });

  it("tomt nummer ger tom nyckel (anroparen ska avstå)", () => {
    expect(cmNumberKeyNoSetCode(null)).toBe("");
    expect(cmNumberKeyNoSetCode("  ")).toBe("");
  });
});

describe("cmSetNameKey", () => {
  it("skiljer inte på skiftläge, skiljetecken eller diakriter", () => {
    expect(cmSetNameKey("Pitch Black")).toBe(cmSetNameKey("pitch black"));
    expect(cmSetNameKey("Pokémon products")).toBe(cmSetNameKey("Pokemon Products"));
    expect(cmSetNameKey("Celebrations: Classic Collection")).toBe(
      cmSetNameKey("Celebrations Classic Collection")
    );
  });

  it("olika set får olika nyckel", () => {
    expect(cmSetNameKey("Chaos Rising")).not.toBe(cmSetNameKey("Perfect Order"));
  });
});

describe("cmCardNameAgrees", () => {
  it("accepterar CM:s längre attack-form", () => {
    expect(cmCardNameAgrees("Mega Darkrai ex", "Mega Darkrai ex [Dusk Raid | Abyss Eye]")).toBe(true);
    expect(cmCardNameAgrees("Tropius", "Tropius")).toBe(true);
  });

  it("AVVISAR CM:s felnumrerade kort — vakten är hela poängen", () => {
    // Chaos Rising 77/78: CM och pokemontcg.io har bytt plats på korten. Numret
    // ensamt hade prissatt Emma som Great Haul Net.
    expect(cmCardNameAgrees("Emma", "Great Haul Net")).toBe(false);
    expect(cmCardNameAgrees("Great Haul Net", "Emma")).toBe(false);
    expect(cmCardNameAgrees("AZ's Tranquility", "Energy Retrieval")).toBe(false);
  });

  it("saknat namn = ingen match (reserven kräver bevisad identitet)", () => {
    expect(cmCardNameAgrees(null, "Tropius")).toBe(false);
    expect(cmCardNameAgrees("Tropius", null)).toBe(false);
    expect(cmCardNameAgrees("", "")).toBe(false);
  });

  it("energityp som symbol vs utskriven är samma kort", () => {
    expect(cmCardNameAgrees("Shadowy Darkness Energy", "Shadowy [D] Energy")).toBe(true);
    expect(cmCardNameAgrees("Voltaic Lightning Energy", "Voltaic [L] Energy")).toBe(true);
    // CM escapar ibland klamrarna
    expect(cmCardNameAgrees("Bubbly Water Energy", "Bubbly \\[W\\] Energy")).toBe(true);
    expect(cmCardNameAgrees("Nitro Fire Energy", "Nitro \\[R\\] Energy")).toBe(true);
  });

  it("men TVÅ OLIKA specialenergier matchar aldrig varandra", () => {
    expect(cmCardNameAgrees("Shadowy Darkness Energy", "Voltaic [L] Energy")).toBe(false);
    expect(cmCardNameAgrees("Nitro Fire Energy", "Bubbly [W] Energy")).toBe(false);
  });

  it("energi-undantaget gäller bara energikort", () => {
    expect(cmCardNameAgrees("Darkrai", "Metagross")).toBe(false);
    expect(cmCardNameAgrees("Fire Reader", "Water Reader")).toBe(false);
  });
});
