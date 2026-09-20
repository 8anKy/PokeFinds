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

// Regression 2026-09-20: pokemontcg.io delar "30th Celebration" i huvudset (me55) +
// underset "30th Celebration: Classic Collection" (me55c), medan RapidAPI publicerar
// hela släppet som EN episod där Classic-korten bär ursprungssetets kod i numret
// ("BS004" = Base Set Charizard). Ingen nyckel nådde dem: tcgid null, episodnamnet
// pekar på huvudsetet, "bs4" finns inte där. 30 singlar, 0 CM-offers → körningen röd.
import { cmSubsetParentKey, cmNumberKeyOriginCode, pickSubsetCandidate, pickBestSubsetHit } from "../../src/jobs/cardmarket-refresh";

describe("cmSubsetParentKey", () => {
  it("prefixet före kolon är episodens namn", () => {
    expect(cmSubsetParentKey("30th Celebration: Classic Collection")).toBe(cmSetNameKey("30th Celebration"));
    expect(cmSubsetParentKey("Celebrations: Classic Collection")).toBe(cmSetNameKey("Celebrations"));
  });
  it("utan kolon är setet inget underset", () => {
    expect(cmSubsetParentKey("30th Celebration")).toBe("");
    expect(cmSubsetParentKey(null)).toBe("");
  });
});

describe("cmNumberKeyOriginCode", () => {
  it("ursprungssetets kod skalas av även UTAN separator — det är hela poängen", () => {
    expect(cmNumberKeyOriginCode("BS004")).toBe("4");
    expect(cmNumberKeyOriginCode("PLB097")).toBe("97");
    expect(cmNumberKeyOriginCode("TM 99")).toBe("99");
    expect(cmNumberKeyOriginCode("004")).toBe("4");
  });
  it("bokstavssuffix står kvar", () => {
    expect(cmNumberKeyOriginCode("BS115a")).toBe("115a");
  });
});

describe("pickSubsetCandidate", () => {
  const me55c = [
    { entry: "charizard", cardName: "Charizard", numKey: "4" },
    { entry: "pikachu", cardName: "Pikachu", numKey: "58" },
    { entry: "pikazek", cardName: "Pikachu & Zekrom-GX", numKey: "33" },
    { entry: "genesect", cardName: "Genesect-EX", numKey: "11" },
    { entry: "metagross", cardName: "Metagross", numKey: "11" },
    { entry: "celebi", cardName: "Shining Celebi", numKey: "106" },
    { entry: "gardevoir", cardName: "M Gardevoir-EX", numKey: "106" },
    { entry: "palkia", cardName: "Palkia LV.X", numKey: "106" },
    { entry: "n", cardName: "N", numKey: "101" },
    { entry: "mewvmax", cardName: "Mew VMAX", numKey: "114" },
  ];
  const pick = (name: string, num: string) => pickSubsetCandidate(me55c, name, cmNumberKeyOriginCode(num));

  it("nummer + namn", () => {
    expect(pick("Charizard", "BS004")).toEqual({ entry: "charizard", viaNumber: true, exact: true });
    expect(pick("Pikachu", "BS058")).toEqual({ entry: "pikachu", viaNumber: true, exact: true });
    expect(pick("N", "NVI101")).toEqual({ entry: "n", viaNumber: true, exact: true });
    // Prefixregeln gäller MED nummer: leverantören skriver ut mer än vi ("Uxie Lv.55" mot "Uxie").
    expect(pickSubsetCandidate([{ entry: "uxie", cardName: "Uxie", numKey: "43" }], "Uxie Lv.55", "43"))
      .toEqual({ entry: "uxie", viaNumber: true, exact: false });
  });
  it("dubblettnummer avgörs av namnet — me55c har tre kort med nummer 106", () => {
    expect(pick("Metagross δ Delta Species", "DS011")?.entry).toBe("metagross");
    expect(pick("Palkia LV.X", "GE106")?.entry).toBe("palkia");
    expect(pick("Shining Celebi", "NDE106")?.entry).toBe("celebi");
  });
  it("numret oense (Genesect 11 mot PLB097) ⇒ EXAKT namn ensamt duger när det är entydigt", () => {
    expect(pick("Genesect EX", "PLB097")).toEqual({ entry: "genesect", viaNumber: false, exact: true });
    expect(pick("MGardevoir EX", "PRC108")).toEqual({ entry: "gardevoir", viaNumber: false, exact: true });
    expect(pick("Pikachu", "999")?.entry).toBe("pikachu");
  });
  it("⛔ utan nummerträff räcker inte ett PREFIX — 'N' är prefix till varje Nidoran, 'Mew' till 'Mew VMAX'", () => {
    expect(pick("Nidoran [F]", "87")).toBeNull();
    expect(pick("Mew", "B/RGB")).toBeNull();
    expect(pick("Pikachu ex", "999")).toBeNull(); // inget kort heter exakt så, prefix räcker inte
  });
  it("samma nummer i två set: nummer slår namn, exakt namn slår prefix, lika ⇒ inget", () => {
    const main = { viaNumber: true, exact: false, id: "me55 Pikachu #33" };
    const sub = { viaNumber: true, exact: true, id: "me55c Pikachu & Zekrom-GX #33" };
    expect(pickBestSubsetHit([main, sub])?.id).toBe(sub.id);
    expect(pickBestSubsetHit([{ viaNumber: false, exact: true, id: "a" }, { viaNumber: true, exact: false, id: "b" }])?.id).toBe("b");
    expect(pickBestSubsetHit([main, { ...main, id: "x" }])).toBeNull();
    expect(pickBestSubsetHit([])).toBeNull();
  });
  it("fel namn ⇒ ingen match oavsett nummer", () => {
    expect(pick("Blastoise", "4")).toBeNull();
    expect(pickSubsetCandidate([], "Charizard", "4")).toBeNull();
  });
});
