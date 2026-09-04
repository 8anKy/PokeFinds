/**
 * `learnConvention`: lär butikens URL-konvention ur dess EGNA befintliga länkar, i
 * stället för att hårdkoda en per butik (som vore fel i samma sekund en butik byter tema).
 *
 * Reglerna som måste hålla:
 *   - prefix/suffix härleds genom att hitta `slugify(katalogtiteln)` i sista URL-segmentet
 *   - par där butikens namn skiljer sig från katalogens lär oss INGET (de hoppas över)
 *   - köpgränserna (`-max-1-kund`) går inte att lära sig — de sitter på PRODUKTEN, inte
 *     butiken — och läggs därför till som fasta kandidater DIREKT efter det tomma suffixet
 *   - för få par ⇒ null, hellre ingen gissning än en gissning byggd på ett enda exempel
 */
import { describe, expect, it } from "vitest";
import { learnConvention } from "../../scripts/probe-store-handles";

const pair = (title: string, handle: string) => ({
  title,
  url: `https://butiken.se/products/${handle}`,
});

describe("learnConvention", () => {
  it("hittar butikens prefix ur flera länkar", () => {
    const c = learnConvention([
      pair("Ascended Heroes Elite Trainer Box", "pokemon-ascended-heroes-elite-trainer-box"),
      pair("Destined Rivals Booster Bundle", "pokemon-destined-rivals-booster-bundle"),
      pair("Mega Evolution Booster Box", "pokemon-mega-evolution-booster-box"),
    ]);
    expect(c).not.toBeNull();
    expect(c!.prefixes[0]).toBe("pokemon-");
    expect(c!.pathPrefix).toBe("/products");
    expect(c!.learnedFrom).toBe(3);
  });

  it("hittar suffix lika bra som prefix", () => {
    const c = learnConvention([
      pair("Mega Dream ex Booster Box", "pokemon-mega-dream-ex-booster-box-japansk"),
      pair("Mega Brave Booster Box", "pokemon-mega-brave-booster-box-japansk"),
      pair("Mega Symphonia Booster Box", "pokemon-mega-symphonia-booster-box-japansk"),
    ]);
    expect(c!.suffixes).toContain("-japansk");
  });

  it("provar ALLTID köpgränserna, även när butiken aldrig använt dem", () => {
    const c = learnConvention([
      pair("Ascended Heroes Elite Trainer Box", "pokemon-ascended-heroes-elite-trainer-box"),
      pair("Destined Rivals Booster Bundle", "pokemon-destined-rivals-booster-bundle"),
      pair("Mega Evolution Booster Box", "pokemon-mega-evolution-booster-box"),
    ]);
    expect(c!.suffixes).toContain("-max-1-kund");
    // ⛔ Direkt efter det tomma suffixet — ordningen ÄR budgeten (se `rank` i skriptet).
    expect(c!.suffixes[0]).toBe("");
    expect(c!.suffixes[1]).toBe("-max-1-kund");
  });

  it("lär sig INGET av par där butiken har ett eget produktnamn", () => {
    const c = learnConvention([
      pair("Pitch Black Booster Box", "pokemon-mega-evolution-pitch-black-booster-display-36-pack-eng"),
      pair("Mega Evolution Booster Bundle", "pokemon-chaos-rising-booster-bundle"),
    ]);
    expect(c).toBeNull(); // 0 användbara par → för få
  });

  it("ger null vid för få par — hellre ingen gissning än en byggd på ett exempel", () => {
    expect(learnConvention([pair("Ascended Heroes Elite Trainer Box", "pokemon-ascended-heroes-elite-trainer-box")])).toBeNull();
    expect(learnConvention([])).toBeNull();
  });

  it("förkastar orimligt långa affix — de är setnamn, inte konvention", () => {
    // "pokemon-scarlet-violet-10-" är 26 tecken: butikens serienamn för EN produkt,
    // som aldrig generaliserar och bara hade bränt budgeten på omöjliga gissningar.
    const c = learnConvention([
      pair("Destined Rivals Booster Box", "pokemon-scarlet-violet-10-destined-rivals-booster-box"),
      pair("Ascended Heroes Elite Trainer Box", "pokemon-ascended-heroes-elite-trainer-box"),
      pair("Mega Evolution Booster Box", "pokemon-mega-evolution-booster-box"),
    ]);
    expect(c!.prefixes).not.toContain("pokemon-scarlet-violet-10-");
    expect(c!.prefixes).toContain("pokemon-");
  });

  it("tål trasiga URL:er utan att kasta", () => {
    const c = learnConvention([
      { title: "Ascended Heroes Elite Trainer Box", url: "inte-en-url" },
      pair("Destined Rivals Booster Bundle", "pokemon-destined-rivals-booster-bundle"),
      pair("Mega Evolution Booster Box", "pokemon-mega-evolution-booster-box"),
      pair("Phantasmal Flames Booster Box", "pokemon-phantasmal-flames-booster-box"),
    ]);
    expect(c!.learnedFrom).toBe(3);
  });
});
