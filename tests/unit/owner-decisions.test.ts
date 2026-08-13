import { describe, expect, it } from "vitest";
import { parseDecisions, slugOf, validateDecisions } from "../../scripts/lib/owner-decisions";

/**
 * ÄGARENS BESLUTSFIL (2026-08-13). Formatet är ägarens eget ("Duplicates … Goes to
 * …") och parsern är avsiktligt tolerant: en människa som bläddrar i katalogen ska
 * kunna klistra in länkar och titlar huller om buller utan att lära sig en syntax.
 *
 * ⛔ TOLERANS UTAN TESTER ÄR GISSNING. Varje fall nedan är en form ägaren rimligen
 *    skriver — och den farliga riktningen är inte att parsern missar något (det syns
 *    direkt i torrkörningen), utan att den TOLKAR FEL och pekar ut fel produkt som
 *    den som ska överleva. Därför testas målvalet i varje form.
 */
describe("slugOf", () => {
  it("läser slugen ur alla länkformer ägaren kan klistra in", () => {
    const want = "jungle-booster-pack-unlimited-scyther";
    for (const form of [
      `https://www.foilio.se/produkter/${want}`,
      `https://foilio.se/produkter/${want}`,
      `https://www.foilio.se/en/produkter/${want}`,
      `/produkter/${want}`,
      `produkter/${want}`,
      `  https://www.foilio.se/produkter/${want}?utm_source=app  `,
      `https://www.foilio.se/produkter/${want}#pris`,
    ]) {
      expect(slugOf(form), form).toBe(want);
    }
  });

  it("tar INTE ord ur inklistrade titlar för slugs", () => {
    // Den här är hela skälet till bindestrecks-kravet: annars hade varje rad med
    // butikens produktnamn blivit en "produkt" och tyst hamnat i en merge.
    for (const t of ["Jungle Booster Pack", "Duplicates", "Goes to", "Alm. moms", "Charizard"]) {
      expect(slugOf(t), t).toBeNull();
    }
  });
});

describe("parseDecisions", () => {
  const A = "https://www.foilio.se/produkter/stub-a";
  const B = "https://www.foilio.se/produkter/stub-b";
  const K = "https://www.foilio.se/produkter/kanonisk";

  it("läser ägarens eget format", () => {
    const { decisions } = parseDecisions(`Duplicates\n${A}\n${B}\nGoes to\n${K}\n`);
    expect(decisions).toEqual([{ kind: "merge", drop: ["stub-a", "stub-b"], keep: "kanonisk", line: 1 }]);
  });

  it("klarar formen utan rubrik — bara länkar och ett mål", () => {
    const { decisions } = parseDecisions(`${A}\n${B}\n-> ${K}\n`);
    expect(decisions).toHaveLength(1);
    expect(decisions[0].drop).toEqual(["stub-a", "stub-b"]);
    expect(decisions[0].keep).toBe("kanonisk");
  });

  it("klarar enradsformen A -> B", () => {
    const { decisions } = parseDecisions(`${A} -> ${K}\n${B} → ${K}\n`);
    expect(decisions).toEqual([
      { kind: "merge", drop: ["stub-a"], keep: "kanonisk", line: 1 },
      { kind: "merge", drop: ["stub-b"], keep: "kanonisk", line: 2 },
    ]);
  });

  it("accepterar svenska markörer", () => {
    const { decisions } = parseDecisions(`Dubbletter\n${A}\nBehåll\n${K}\n`);
    expect(decisions[0]).toMatchObject({ kind: "merge", drop: ["stub-a"], keep: "kanonisk" });
  });

  it("läser raderingar både som rubrik och per rad", () => {
    const { decisions } = parseDecisions(`Radera\n${A}\n${B}\n\nx ${K}\n`);
    expect(decisions).toEqual([
      { kind: "delete", drop: ["stub-a", "stub-b"], keep: null, line: 1 },
      { kind: "delete", drop: ["kanonisk"], keep: null, line: 5 },
    ]);
  });

  it("tomrad avslutar gruppen — två beslut blandas aldrig ihop", () => {
    const { decisions } = parseDecisions(
      `Duplicates\n${A}\nGoes to\n${K}\n\nDuplicates\n${B}\nGoes to\nhttps://www.foilio.se/produkter/annan\n`
    );
    expect(decisions).toHaveLength(2);
    expect(decisions[0].keep).toBe("kanonisk");
    expect(decisions[1].keep).toBe("annan");
    expect(decisions[1].drop).toEqual(["stub-b"]);
  });

  it("ignorerar kommentarer och inklistrade titlar", () => {
    const { decisions } = parseDecisions(
      `# gick igenom 13 aug\nDuplicates\nJungle Booster Pack - Scyther / Brugtmoms\n${A}\n` +
        `Jungle Booster Pack - Scyther / Alm. moms\n${B}\nGoes to\nDen riktiga\n${K}\n`
    );
    expect(decisions).toEqual([{ kind: "merge", drop: ["stub-a", "stub-b"], keep: "kanonisk", line: 2 }]);
  });

  it("ett andra mål i samma grupp rapporteras i stället för att skriva över det första", () => {
    // Att TYST byta mål vore det värsta utfallet: fel produkt hade överlevt.
    const { problems } = parseDecisions(`Duplicates\n${A}\nGoes to ${K}\nGoes to https://www.foilio.se/produkter/fel\n`);
    expect(problems.length).toBeGreaterThan(0);
  });

  it("tom fil ger inga beslut", () => {
    expect(parseDecisions("\n\n# bara en kommentar\n\n").decisions).toEqual([]);
  });
});

describe("validateDecisions", () => {
  const known = new Set(["stub-a", "stub-b", "kanonisk"]);

  it("släpper igenom en korrekt fil", () => {
    expect(validateDecisions([{ kind: "merge", drop: ["stub-a"], keep: "kanonisk", line: 1 }], known)).toEqual([]);
  });

  it("fäller okänd slug", () => {
    const errs = validateDecisions([{ kind: "merge", drop: ["stavfel"], keep: "kanonisk", line: 3 }], known);
    expect(errs[0]).toContain("stavfel");
  });

  it("fäller mål som också står i bort-listan", () => {
    const errs = validateDecisions([{ kind: "merge", drop: ["kanonisk"], keep: "kanonisk", line: 2 }], known);
    expect(errs.some((e) => e.includes("målet står också"))).toBe(true);
  });

  it("fäller en produkt som förekommer i två beslut", () => {
    // Utan den här hade första beslutet mergat bort raden och det andra kraschat —
    // eller värre, mergat in i en produkt som just raderats.
    const errs = validateDecisions(
      [
        { kind: "merge", drop: ["stub-a"], keep: "kanonisk", line: 1 },
        { kind: "delete", drop: ["stub-a"], keep: null, line: 5 },
      ],
      known
    );
    expect(errs.some((e) => e.includes("står redan i beslutet"))).toBe(true);
  });

  it("fäller dubblettgrupp utan mål", () => {
    const errs = validateDecisions([{ kind: "merge", drop: ["stub-a"], keep: null, line: 1 }], known);
    expect(errs.some((e) => e.includes("utan mål"))).toBe(true);
  });
});
