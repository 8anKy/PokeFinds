import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ALT_SCORE_WINDOW,
  MAX_ALTERNATIVES,
  pickAlternatives,
  pickSameArtRail,
  type AlternativeLike,
  type RailLike,
  type RailVariant,
} from "@/lib/scan-alternatives";

function card(over: Partial<AlternativeLike> & { cardId: string; score: number }): AlternativeLike {
  return { productId: null, name: "Raboot", sameArt: false, ...over };
}

const std = { productId: "p-std", label: null, slug: "mudbray-107", estimatedValue: 22 };
const rev = {
  productId: "p-rev",
  label: "Reverse Holo",
  slug: "mudbray-107-reverse-holo",
  estimatedValue: 198,
};
const rail = (over: Partial<RailLike> & { cardId: string; score: number }): RailLike => ({
  productId: "p-std",
  name: "Mudbray",
  ...over,
});

/** Ordinarie + reverse holo för ETT kort — formen som åt syskonens platser. */
const pair = (id: string): RailVariant[] => [
  { productId: `${id}-std`, label: null, slug: id, estimatedValue: 22 },
  { productId: `${id}-rev`, label: "Reverse Holo", slug: `${id}-rev`, estimatedValue: 198 },
];

/** Ett kort med båda tryckningarna, `productId` satt till den ordinarie. */
const withPair = (over: Partial<RailLike> & { cardId: string; score: number }): RailLike =>
  rail({ productId: `${over.cardId}-std`, variants: pair(over.cardId), ...over });

describe("pickAlternatives", () => {
  const match = { cardId: "raboot-27", productId: null, score: 1.15 };

  it("visar omtryck med SAMMA KONST även när poängen ligger långt under träffen", () => {
    // Fältfallet: träffen fick förtroendebonusen (ART_TRUST 1,15) och syskonet
    // hamnade långt utanför fönstret. Utan den här regeln gick #37 inte att välja.
    const out = pickAlternatives(
      [
        card({ cardId: "raboot-27", score: 1.15 }),
        card({ cardId: "raboot-37", score: 0.31, sameArt: true }),
      ],
      match
    );
    expect(out.map((c) => c.cardId)).toEqual(["raboot-37"]);
  });

  it("visar BILDENS topplista även när texten vann på ett trunkerat namn", () => {
    // Fältfallet: modellen läste "Komala" på ett kort som heter "Larry's
    // Komala". Texten matchade Komala 185 EXAKT och slog bilden. Vinnaren delar
    // varken namn eller konst med rätt kort, så bara artRank räddar det.
    const out = pickAlternatives(
      [
        card({ cardId: "komala-185", name: "Komala", score: 1.2 }),
        card({ cardId: "larrys-komala-175", name: "Larry's Komala", score: 0.3, artRank: 1 }),
      ],
      { cardId: "komala-185", productId: null, score: 1.2 }
    );
    expect(out.map((c) => c.cardId)).toEqual(["larrys-komala-175"]);
  });

  it("sorterar bildens topp efter dess EGEN rangordning, inte efter slutpoäng", () => {
    const out = pickAlternatives(
      [
        card({ cardId: "m", score: 1.2 }),
        card({ cardId: "art2", score: 0.9, artRank: 2 }),
        card({ cardId: "art1", score: 0.3, artRank: 1 }),
      ],
      { cardId: "m", productId: null, score: 1.2 }
    );
    expect(out.map((c) => c.cardId)).toEqual(["art1", "art2"]);
  });

  it("gallrar bort ORELATERADE kort som ligger utanför poängfönstret", () => {
    const out = pickAlternatives(
      [
        card({ cardId: "raboot-27", score: 1.15 }),
        // Annat namn, annan konst, långt under → ingen förväxlingsrisk.
        card({ cardId: "scorbunny", name: "Scorbunny", score: 0.4, sameArt: false }),
      ],
      { ...match, name: "Raboot" }
    );
    expect(out).toHaveLength(0);
  });

  it("visar SAMMA NAMN i andra set — de har poäng 0 och föll ur varje fönster", () => {
    // MÄTT mot prod 2026-08-04: en bildavgjord skanning av Mudbray #107 gav
    // Terrakion #54 och Tyrunt #44 (bildens tvåa och trea, 0,26 mot träffens
    // 1,45) medan syskonen kastades — servern skickade dem, med poäng 0 just för
    // att poängen inte kom ur en matchning, och fönstret mäter avstånd till
    // träffen. 0 ligger per definition utanför.
    const out = pickAlternatives(
      [
        card({ cardId: "mudbray-107", name: "Mudbray", score: 1.45 }),
        card({ cardId: "terrakion-54", name: "Terrakion", score: 0.267, artRank: 2 }),
        card({ cardId: "mudbray-91", name: "Mudbray", score: 0 }),
        card({ cardId: "mudbray-96", name: "Mudbray", score: 0 }),
      ],
      { cardId: "mudbray-107", productId: null, score: 1.45, name: "Mudbray" }
    );
    expect(out.map((c) => c.cardId)).toEqual(["terrakion-54", "mudbray-91", "mudbray-96"]);
  });

  it("bildens topp ligger FÖRE namnsyskonen — den ordningen är fältbevisad", () => {
    // Komala-fallet: med ett trunkerat namn är syskonen en lista över FEL kort
    // medan bilden pekar rätt. Namnregeln får inte tränga undan den.
    const out = pickAlternatives(
      [
        card({ cardId: "komala-185", name: "Komala", score: 1.2 }),
        card({ cardId: "komala-annat-set", name: "Komala", score: 0 }),
        card({ cardId: "larrys-komala", name: "Larry's Komala", score: 0.3, artRank: 1 }),
      ],
      { cardId: "komala-185", productId: null, score: 1.2, name: "Komala" }
    );
    expect(out[0].cardId).toBe("larrys-komala");
  });

  it("behåller kort med annan konst som ligger INOM fönstret", () => {
    const inside = match.score - ALT_SCORE_WINDOW + 0.01;
    const out = pickAlternatives(
      [card({ cardId: "raboot-27", score: 1.15 }), card({ cardId: "nära", score: inside })],
      match
    );
    expect(out.map((c) => c.cardId)).toEqual(["nära"]);
  });

  it("lägger omtrycken FÖRST, även när ett annat kort har högre poäng", () => {
    const out = pickAlternatives(
      [
        card({ cardId: "raboot-27", score: 1.15 }),
        card({ cardId: "hög-poäng", score: 1.1 }),
        card({ cardId: "omtryck", score: 0.2, sameArt: true }),
      ],
      match
    );
    expect(out[0].cardId).toBe("omtryck");
  });

  it("skiljer TRYCKNINGAR av samma kort — träffen filtreras på produkt, inte bara cardId", () => {
    // Base-korten delar cardId över tre produkter. Ett `cardId !==`-filter hade
    // slängt ut precis de rader användaren behöver för att säga "min är 1st Ed".
    const out = pickAlternatives(
      [
        card({ cardId: "base-4", productId: "unlimited", score: 1.0, sameArt: true }),
        card({ cardId: "base-4", productId: "shadowless", score: 0.99, sameArt: true }),
      ],
      { cardId: "base-4", productId: "unlimited", score: 1.0 }
    );
    expect(out.map((c) => c.productId)).toEqual(["shadowless"]);
  });

  it("bär träffens ÖVRIGA varianter — men aldrig träffens egen produkt", () => {
    // Servern skickar ETT objekt per KORT (attachVariants), så reverse holon
    // finns bara i `variants`. Utan expansionen här hade den fallit bort ur den
    // enda rättningsvägen som finns när ingen kandidat delar konst med träffen.
    // ⛔ Träffens egen post måste utebli: anroparen sätter träffen först, och två
    // likadana kort i raden är en fråga användaren inte kan svara på.
    const out = pickAlternatives(
      [rail({ cardId: "mudbray-107", score: 1.45, sameArt: true, variants: [std, rev] })],
      { cardId: "mudbray-107", productId: "p-std", score: 1.45, name: "Mudbray" }
    );
    expect(out.map((c) => c.productId)).toEqual(["p-rev"]);
    expect(out[0].estimatedValue).toBe(198);
  });

  it("kapar listan vid MAX_ALTERNATIVES — räknat i KORT", () => {
    const many = Array.from({ length: 20 }, (_, i) =>
      card({ cardId: `x${i}`, score: 0.1, sameArt: true })
    );
    const out = pickAlternatives([card({ cardId: "m", score: 1 }), ...many], {
      cardId: "m",
      productId: null,
      score: 1,
    });
    // Kort utan tryckningar ⇒ en post per kort, så taket syns direkt i längden.
    expect(out).toHaveLength(MAX_ALTERNATIVES);
    expect(new Set(out.map((c) => c.cardId)).size).toBe(MAX_ALTERNATIVES);
  });

  it("utan träff (ingen match) mäts fönstret mot listans bästa kandidat", () => {
    const out = pickAlternatives(
      [card({ cardId: "a", score: 0.8 }), card({ cardId: "b", score: 0.75 }), card({ cardId: "c", score: 0.2 })],
      null
    );
    expect(out.map((c) => c.cardId)).toEqual(["a", "b"]);
  });

  it("saknad sameArt-flagga (bildmatchning kördes inte) faller tillbaka på fönstret", () => {
    const out = pickAlternatives(
      [
        { cardId: "m", productId: null, name: "Raboot", score: 1.0 },
        { cardId: "lågt", productId: null, name: "Raboot", score: 0.1 },
      ],
      { cardId: "m", productId: null, score: 1.0 }
    );
    expect(out).toHaveLength(0);
  });
});

/**
 * TAKET RÄKNAR KORT, INTE POSTER — granskningens BLOCKER 2026-08-29.
 *
 * `flatMap(expandVariants)` låg FÖRE `.slice(MAX_ALTERNATIVES)`, så reverse
 * holo-poster konsumerade samma platser som korten. Filens egen regel säger att
 * SAMMA NAMN VISAS ALLTID (fältfall 2026-08-04, Mudbray #107) — den regeln var
 * upphävd av taket så fort korten hade tryckningar.
 *
 * ⛔ Testerna nedan ska FAILA på den gamla ordningen. Byter någon tillbaka till
 * "expandera först, kapa sedan" är det de här som säger till.
 */
describe("variantexpansionen får aldrig äta kortens platser", () => {
  it("ALLA namnsyskon når raden trots att varje kort bär två tryckningar", () => {
    // REPRODUCERAT 2026-08-29 mot den gamla koden: träff + 6 namnsyskon +
    // bildens topp-2 och topp-3, alla med reverse holo — 9 kort in, och ut kom
    // 12 poster men bara 7 DISTINKTA KORT och 4 av 6 syskon. De två sist
    // rankade syskonen fanns inte i raden alls.
    // ⛔ Formen är vardaglig, inte konstruerad: servern reserverar
    // SIBLING_RESERVED = 6 syskonplatser av MAX_CANDIDATES = 12.
    const siblings = Array.from({ length: 6 }, (_, i) =>
      withPair({ cardId: `mudbray-s${i + 1}`, name: "Mudbray", score: 0 })
    );
    const out = pickAlternatives(
      [
        withPair({ cardId: "mudbray-107", name: "Mudbray", score: 1.45, sameArt: true }),
        ...siblings,
        withPair({ cardId: "terrakion-54", name: "Terrakion", score: 0.267, artRank: 2 }),
        withPair({ cardId: "tyrunt-44", name: "Tyrunt", score: 0.26, artRank: 3 }),
      ],
      { cardId: "mudbray-107", productId: "mudbray-107-std", score: 1.45, name: "Mudbray" }
    );

    const reached = new Set(out.map((c) => c.cardId));
    // Nio kort ryms under taket (12) — alla ska nå raden, oavsett tryckningar.
    expect(reached.size).toBe(9);
    for (const s of siblings) expect(reached.has(s.cardId)).toBe(true);
    // Utdatalängden får överstiga taket: 9 kort × 2 tryckningar − träffens egen.
    expect(out).toHaveLength(17);
  });

  it("en RÄTTAD kandidats tryckningar går också att välja, inte bara träffens", () => {
    // ⛔ Fältrapporten 2026-08-04 gäller inte bara träffen: kan man välja fel
    // kort men inte dess reverse holo är rättelsen halv. Expansionen ligger sist
    // och gäller varje kort som nådde raden.
    const out = pickAlternatives(
      [
        withPair({ cardId: "mudbray-107", name: "Mudbray", score: 1.45, sameArt: true }),
        withPair({ cardId: "terrakion-54", name: "Terrakion", score: 0.267, artRank: 2 }),
      ],
      { cardId: "mudbray-107", productId: "mudbray-107-std", score: 1.45, name: "Mudbray" }
    );
    expect(out.filter((c) => c.cardId === "terrakion-54").map((c) => c.productId)).toEqual([
      "terrakion-54-std",
      "terrakion-54-rev",
    ]);
    // Ordinarie före reverse holo — serverns ordning, bevarad av en stabil sort.
    expect(out.find((c) => c.cardId === "terrakion-54")?.variantLabel).toBeNull();
  });

  it("svep-raden kapar också på KORT — omtryckssyskonen trängs inte ut", () => {
    // Samma bugg i pickSameArtRail: 8 kort × 2 tryckningar = 16 poster, och en
    // kapning på poster hade tappat de två sist rankade OMTRYCKEN — precis de
    // kort raden finns för.
    const cards = [
      withPair({ cardId: "mudbray-107", score: 1.45, sameArt: true }),
      ...Array.from({ length: 7 }, (_, i) =>
        withPair({ cardId: `omtryck-${i + 1}`, score: 0.9 - i * 0.01, sameArt: true })
      ),
    ];
    const out = pickSameArtRail(cards, {
      cardId: "mudbray-107",
      productId: "mudbray-107-std",
    });
    expect(new Set(out.map((c) => c.cardId)).size).toBe(8);
    expect(out).toHaveLength(16);
    expect(out.map((c) => c.cardId)).toContain("omtryck-7");
  });

  it("svep-raden kapar VID taket när korten saknar tryckningar", () => {
    const cards = Array.from({ length: 20 }, (_, i) =>
      rail({ cardId: `x${i}`, productId: `p-${i}`, score: 1 - i * 0.01, sameArt: true })
    );
    const out = pickSameArtRail(cards, { cardId: "x0", productId: "p-0" });
    expect(out).toHaveLength(MAX_ALTERNATIVES);
  });
});

describe("pickSameArtRail — svep-radens innehåll", () => {
  it("REVERSE HOLON ÄR ETT EGET KORT I RADEN — den delar Card med det ordinarie", () => {
    // Fältrapport 2026-08-04: reverse holon fanns bara i en rullgardin och gick
    // inte att välja där användaren letade efter den.
    const out = pickSameArtRail(
      [
        rail({ cardId: "mudbray-107", score: 1.45, sameArt: true, variants: [std, rev] }),
        rail({ cardId: "mudbray-91", productId: "p-91", score: 0.3, sameArt: true }),
      ],
      { cardId: "mudbray-107", productId: "p-std" }
    );
    expect(out.map((c) => c.productId)).toEqual(["p-std", "p-rev", "p-91"]);
    expect(out[1].estimatedValue).toBe(198);
  });

  it("TOM när inget ANNAT kort delar konst med träffen — annars är fallbacken död kod", () => {
    // ⛔ VÄNT 2026-08-29. Testet förväntade sig förut raden ["mudbray-107"] här,
    // och låste därmed fast felet: filtret `sameArt || cardId === match.cardId`
    // uppfylls ALLTID av träffens eget kort, så raden blev aldrig tom så snart
    // det fanns en träff — och anroparens fallback var död kod. En felmatchning
    // till ett kort med ANNAN konst gick inte att rätta i appen alls, vilket
    // gjorde 0 av 142 rättelser i den art-avgjorda hinken OFALSIFIERBART.
    const out = pickSameArtRail(
      [
        rail({ cardId: "mudbray-107", score: 1.45, sameArt: true }),
        rail({ cardId: "mienfoo-83", productId: "p-mienfoo", name: "Mienfoo", score: 0.26, artRank: 2 }),
        rail({ cardId: "mudbray-91", productId: "p-91", score: 0 }),
      ],
      { cardId: "mudbray-107", productId: "p-std" }
    );
    expect(out).toEqual([]);
  });

  it("träffens EGET kort räknas aldrig som ett same-art-alternativ", () => {
    // Servern sätter sameArt=true på vinnaren själv (likheten mot sig själv är
    // 1). Ett bart `c.sameArt` i grinden hade därför behållit exakt samma bugg —
    // och varianterna räddar den inte heller: de är samma KORT.
    const out = pickSameArtRail(
      [rail({ cardId: "mudbray-107", score: 1.45, sameArt: true, variants: [std, rev] })],
      { cardId: "mudbray-107", productId: "p-std" }
    );
    expect(out).toEqual([]);
  });

  it("kort med ANNAN konst hör inte hemma i raden när den ANVÄNDS", () => {
    // Skärmdumpen 2026-08-04: Mienfoo och Bulbasaur låg i raden för att de var
    // bildens tvåa och trea (0,26 mot träffens 1,45) — rent brus. Har raden
    // något att säga (ett omtryck med samma konst) säger den bara det.
    const out = pickSameArtRail(
      [
        rail({ cardId: "mudbray-107", score: 1.45, sameArt: true }),
        rail({ cardId: "mienfoo-83", productId: "p-mienfoo", name: "Mienfoo", score: 0.26, artRank: 2 }),
        rail({ cardId: "mudbray-91", productId: "p-91", score: 0.3, sameArt: true }),
      ],
      { cardId: "mudbray-107", productId: "p-std" }
    );
    expect(out.map((c) => c.cardId)).toEqual(["mudbray-107", "mudbray-91"]);
  });

  it("omtryck med identisk konst är kvar, träffens eget kort först", () => {
    const out = pickSameArtRail(
      [
        rail({ cardId: "omtryck", productId: "p-omtryck", score: 0.3, sameArt: true }),
        rail({ cardId: "mudbray-107", score: 1.45, sameArt: true }),
      ],
      { cardId: "mudbray-107", productId: "p-std" }
    );
    expect(out.map((c) => c.cardId)).toEqual(["mudbray-107", "omtryck"]);
  });

  it("tom när bildmatchningen inte kördes — anroparen faller tillbaka", () => {
    // Utan konstpoäng finns ingen konst att gruppera på. En tom rad här är
    // signalen att visa poäng-/namnregeln i stället, inte att visa ingenting.
    expect(pickSameArtRail([rail({ cardId: "a", score: 1 })], null)).toEqual([]);
  });
});

/**
 * ANROPARENS FOG — MEKANISK VAKT (samma mönster som `bulk-cap-sync.test.ts` och
 * `cron-chain-sync.test.ts`).
 *
 * Buggen 2026-08-29 låg i FOGEN mellan de två funktionerna, inte i någon av dem
 * var för sig: båda gjorde vad deras egna test sa, men den första returnerade
 * aldrig [] och den andra kördes därför aldrig.
 *
 * ⛔ EN LOKAL KOPIA AV ANROPAREN KAN INTE FÅNGA DET. Modellen `railFor` längre
 * ner är just en kopia — den failar aldrig när ORIGINALET glider, den vaktar
 * sig själv. Sidmodulen går inte att importera i en unittest (Next-klientmodul
 * som drar in hela skanner-sidan), så formen läses ur källan i stället.
 * Ett textprov är trubbigt men fångar exakt den drift det är till för: att
 * `item.match` slutar sättas FÖRST, eller att fallbacken kopplas bort.
 * ⛔ Läs bara filen — den ägs av skanner-sidan, inte av det här testet.
 */
const PAGE = "src/app/[locale]/(scan)/skanna/page.tsx";

function railSource(): string {
  const src = readFileSync(resolve(process.cwd(), PAGE), "utf8");
  const start = src.indexOf("const rail = useMemo(");
  expect(start, `hittade inte \`const rail = useMemo(\` i ${PAGE} — omdöpt?`).toBeGreaterThanOrEqual(
    0
  );
  const end = src.indexOf("}, [", start);
  expect(end, `hittade inte beroendelistans slut i ${PAGE}`).toBeGreaterThan(start);
  // Formen, inte formateringen: en ombruten rad ska inte fälla vakten.
  return src.slice(start, end).replace(/\s+/g, " ");
}

describe("skanna/page.tsx sätter fortfarande ihop raden som modellen nedan", () => {
  it("använder DEN HÄR modulen — inte en lokal kopia av regeln", () => {
    const src = readFileSync(resolve(process.cwd(), PAGE), "utf8");
    expect(src).toContain('from "@/lib/scan-alternatives"');
    expect(src).toContain("pickSameArtRail");
    expect(src).toContain("pickAlternatives");
  });

  it("frågar same-art-raden FÖRST och faller tillbaka bara när den är tom", () => {
    // Ordningen är hela mekanismen: raden är strikt bättre när den har något att
    // säga, och [] är signalen — inte ett fel.
    const body = railSource();
    expect(body).toContain("pickSameArtRail(item.candidates, item.match)");
    expect(body).toMatch(/if \(sameArt\.length > 0\) return sameArt;/);
    expect(body).toContain("pickAlternatives(item.candidates, item.match)");
  });

  it("PREPENDAR träffen före pickAlternatives — annars saknas den i fallbacken", () => {
    // ⛔ `pickAlternatives` filtrerar bort exakt träffens egen post just för att
    // anroparen sätter den först. Slutar anroparen göra det försvinner
    // användarens egen träff ur raden; gör den det TVÅ gånger står kortet
    // dubblerat. Båda är tysta i drift.
    expect(railSource()).toMatch(/return item\.match \? \[item\.match, \.\.\.alts\] : alts;/);
  });
});

/**
 * BETEENDEMODELL av anroparen — samma tre rader, körda som en enhet.
 * Trohet mot originalet vaktas av describe-blocket ovan; det här blocket säger
 * vad kompositionen ska GÖRA.
 */
describe("svep-raden som anroparen sätter ihop den", () => {
  const railFor = (candidates: RailLike[], match: RailLike | null): RailLike[] => {
    const sameArt = pickSameArtRail(candidates, match);
    if (sameArt.length > 0) return sameArt;
    const alts = pickAlternatives(candidates, match);
    return match ? [match, ...alts] : alts;
  };

  const match = rail({ cardId: "mudbray-107", score: 1.45, sameArt: true });
  const mienfoo = rail({
    cardId: "mienfoo-83",
    productId: "p-mienfoo",
    name: "Mienfoo",
    score: 0.26,
    artRank: 2,
  });

  it("EN FELMATCHNING TILL ANNAN KONST GÅR ATT RÄTTA — fallbacken aktiveras", () => {
    // Det här är hela poängen med ändringen. MÄTT 2026-08-29: bilden ser INTE
    // att det är ett annat kort (likheten till det kort användaren valde ligger
    // på slumpbaslinje, median 0,624 mot 0,610), så raden MÅSTE erbjuda kortet.
    const out = railFor([match, mienfoo], match);
    expect(out.map((c) => c.cardId)).toEqual(["mudbray-107", "mienfoo-83"]);
  });

  it("träffens varianter finns kvar även när fallbacken tar över", () => {
    // ⛔ Upplåsningen får inte kosta reverse holon (fältrapport 2026-08-04) —
    // den är ofta den enda meningsfulla rättelsen.
    const withVariants = rail({
      cardId: "mudbray-107",
      score: 1.45,
      sameArt: true,
      variants: [std, rev],
    });
    const out = railFor([withVariants, mienfoo], withVariants);
    expect(out.map((c) => c.productId)).toEqual(["p-std", "p-rev", "p-mienfoo"]);
    expect(out[1].estimatedValue).toBe(198);
  });

  it("ingen DUBBLETT av träffen när fallbacken slår till", () => {
    // Anroparen sätter träffen först och `pickAlternatives` filtrerar bort exakt
    // träffens egen produkt. Glider de isär står samma kort två gånger i raden —
    // en fråga användaren inte kan svara på.
    const withVariants = rail({
      cardId: "mudbray-107",
      score: 1.45,
      sameArt: true,
      variants: [std, rev],
    });
    const out = railFor([withVariants, mienfoo], withVariants);
    const keys = out.map((c) => `${c.cardId}:${c.productId}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.filter((k) => k === "mudbray-107:p-std")).toHaveLength(1);
  });

  it("RADEN VINNER när ett annat kort delar konst — och brus släpps inte in", () => {
    // Same-art-syskonet är fortfarande den troligaste rättelsen och kommer först
    // efter träffen; bildens tvåa (Mienfoo, 0,26 mot 1,45) hör inte hemma här.
    const sibling = rail({ cardId: "mudbray-91", productId: "p-91", score: 0.3, sameArt: true });
    const out = railFor([match, mienfoo, sibling], match);
    expect(out.map((c) => c.cardId)).toEqual(["mudbray-107", "mudbray-91"]);
  });

  it("utan träff faller anroparen tillbaka utan att hitta på en träff", () => {
    const a = rail({ cardId: "a", productId: "p-a", score: 0.8 });
    const b = rail({ cardId: "b", productId: "p-b", score: 0.75 });
    const out = railFor([a, b], null);
    expect(out.map((c) => c.cardId)).toEqual(["a", "b"]);
  });
});
