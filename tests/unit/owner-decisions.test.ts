import { describe, expect, it } from "vitest";
import { parseDecisions, slugOf, slugsOf, validateDecisions } from "../../scripts/lib/owner-decisions";

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
    expect(validateDecisions([{ kind: "merge", drop: ["stub-a"], keep: "kanonisk", line: 1 }], known).errors).toEqual([]);
  });

  it("fäller okänd slug", () => {
    const { errors: errs } = validateDecisions([{ kind: "merge", drop: ["stavfel"], keep: "kanonisk", line: 3 }], known);
    expect(errs[0]).toContain("stavfel");
  });

  it("fäller mål som också står i bort-listan", () => {
    const { errors: errs } = validateDecisions([{ kind: "merge", drop: ["kanonisk"], keep: "kanonisk", line: 2 }], known);
    expect(errs.some((e) => e.includes("målet står också"))).toBe(true);
  });

  it("fäller en produkt som förekommer i två beslut", () => {
    // Utan den här hade första beslutet mergat bort raden och det andra kraschat —
    // eller värre, mergat in i en produkt som just raderats.
    const { errors: errs } = validateDecisions(
      [
        { kind: "merge", drop: ["stub-a"], keep: "kanonisk", line: 1 },
        { kind: "delete", drop: ["stub-a"], keep: null, line: 5 },
      ],
      known
    );
    expect(errs.some((e) => e.includes("både slås ihop"))).toBe(true);
  });

  it("fäller dubblettgrupp utan mål", () => {
    const { errors: errs } = validateDecisions([{ kind: "merge", drop: ["stub-a"], keep: null, line: 1 }], known);
    expect(errs.some((e) => e.includes("utan mål"))).toBe(true);
  });
});

/**
 * ÄGARENS FÖRSTA RIKTIGA LISTA (2026-08-13). Formerna nedan är hämtade ORDAGRANT ur
 * den — och två av dem avslöjade fel i parsern innan något kördes:
 *
 *   · FLERA LÄNKAR PÅ SAMMA RAD ("These <A> <B>"). Parsern läste bara den FÖRSTA,
 *     så B hade tyst blivit kvar i katalogen — en dubblett ingen visste fanns kvar.
 *     Tyst bortfall är det farligaste utfallet av alla här.
 *   · "Go to" (inte "Goes to"). Markören matchade inte, så MÅLET hamnade i
 *     bort-listan. Det failade visserligen högt på "grupp utan mål", men bara av tur.
 */
describe("ägarens riktiga skrivsätt (13 aug)", () => {
  const P = (s: string) => `https://www.foilio.se/en/produkter/${s}`;
  // Slugs måste vara ≥3 tecken (SLUG_RE) — korta platshållare hade testat fel sak.

  it("läser BÅDA länkarna när två står på samma rad", () => {
    const { decisions } = parseDecisions(`These ${P("pack-a")} ${P("pack-b")}\n${P("pack-c")}\nGo to ${P("kanonisk-pack")}\n`);
    expect(decisions).toHaveLength(1);
    expect(decisions[0].drop).toEqual(["pack-a", "pack-b", "pack-c"]);
    expect(decisions[0].keep).toBe("kanonisk-pack");
  });

  it('förstår "Go to" lika väl som "Goes to"', () => {
    for (const marker of ["Go to", "Goes to", "Go To", "go to"]) {
      const { decisions } = parseDecisions(`This ${P("pack-a")}\n${marker} ${P("kanonisk-pack")}\n`);
      expect(decisions[0]?.keep, marker).toBe("kanonisk-pack");
      expect(decisions[0]?.drop, marker).toEqual(["pack-a"]);
    }
  });

  it('klarar "Go to" ensamt på raden med målet under', () => {
    const { decisions } = parseDecisions(`These ${P("pack-a")} ${P("pack-b")}\nGo to \n${P("kanonisk-pack")}\n`);
    expect(decisions[0].drop).toEqual(["pack-a", "pack-b"]);
    expect(decisions[0].keep).toBe("kanonisk-pack");
  });

  it("läser /en/-prefixet i länkarna", () => {
    expect(slugsOf(`${P("heat-wave-arena-booster-pack-japansk")}`)).toEqual(["heat-wave-arena-booster-pack-japansk"]);
  });

  it("en raderingsrubrik med text efter sig är fortfarande en rubrik", () => {
    const { decisions } = parseDecisions(`DELETE and make it not come back\n${P("pack-a")}\n${P("pack-b")}\n`);
    expect(decisions).toEqual([{ kind: "delete", drop: ["pack-a", "pack-b"], keep: null, line: 1 }]);
  });

  it("upprepad rad i raderingslistan stoppar INTE körningen", () => {
    // Ägarens lista hade samma URL två gånger. Harmlöst — men en naiv
    // "förekommer två gånger"-regel hade stoppat hela körningen på det.
    const { decisions } = parseDecisions(`DELETE\n${P("pack-a")}\n${P("pack-b")}\n${P("pack-a")}\n`);
    const { errors, notes, cleaned } = validateDecisions(decisions, new Set(["pack-a", "pack-b"]));
    expect(errors).toEqual([]);
    expect(notes.length).toBeGreaterThan(0);
    expect(cleaned.flatMap((d) => d.drop)).toEqual(["pack-a", "pack-b"]);
  });

  it("samma produkt i två OLIKA mergar är däremot ett fel", () => {
    const { errors } = validateDecisions(
      [
        { kind: "merge", drop: ["a"], keep: "x", line: 1 },
        { kind: "merge", drop: ["a"], keep: "y", line: 5 },
      ],
      new Set(["a", "x", "y"])
    );
    expect(errors.some((e) => e.includes("vilket mål gäller"))).toBe(true);
  });

  it("ett mål som också raderas någon annanstans fälls", () => {
    const { errors } = validateDecisions(
      [
        { kind: "merge", drop: ["a"], keep: "x", line: 1 },
        { kind: "delete", drop: ["x"], keep: null, line: 5 },
      ],
      new Set(["a", "x"])
    );
    expect(errors.some((e) => e.includes("men raderas"))).toBe(true);
  });

  it("en set-filterlänk är INTE en produkt och blir inget mål", () => {
    // Ägaren klistrade in "…/produkter?set=cmsj3qf6s…" som mål för Inferno X.
    // Den får aldrig tolkas som en produkt — då hade fel rad överlevt.
    expect(slugsOf("https://www.foilio.se/en/produkter?set=cmsj3qf6s000214oinl6dk20h")).toEqual([]);
    const { decisions } = parseDecisions(
      `These ${P("pack-a")}\nGo to https://www.foilio.se/en/produkter?set=cmsj3qf6s000214oinl6dk20h\n`
    );
    const { errors } = validateDecisions(decisions, new Set(["pack-a"]));
    expect(errors.some((e) => e.includes("utan mål"))).toBe(true);
  });
});
