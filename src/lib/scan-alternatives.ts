/**
 * Vilka "kan det vara det här i stället?"-rader skanningens detaljvy visar.
 *
 * Egen ren modul för att regeln har FELAT I FÄLT en gång och är svår att se
 * konsekvenserna av: den avgör om en felmatchning går att rätta eller inte.
 * Utan test blir nästa justering av trösklarna en gissning.
 */

export interface AlternativeLike {
  cardId: string;
  productId: string | null;
  name: string;
  score: number;
  /** Samma KONST som träffen (referensavtrycken nästan identiska). */
  sameArt?: boolean;
  /** Plats i BILDENS egen topplista (1 = bildens bästa gissning). */
  artRank?: number;
}

/**
 * Hur många kort som visas. Taket var 6 och satt för en LODRÄT lista, där varje
 * extra rad sköt ner innehållet under vikningen. Listan är sedan 2026-08-04 en
 * VÅGRÄT rad man sveper i — där kostar längden ingen höjd alls, bara ett svep —
 * så taket finns nu bara för att raden ska vara ändlig.
 */
export const MAX_ALTERNATIVES = 12;

/**
 * Ett alternativ med ANNAN konst visas bara om det ligger nära träffen i poäng.
 * Ett kort långt under träffen delade oftast bara ett namn-token ("Iron Valiant
 * ex" drog in varje Iron Hands) och är ingen förväxlingsrisk — att visa det får
 * användaren att tvivla på en träff som var rätt.
 */
export const ALT_SCORE_WINDOW = 0.2;

/**
 * @param candidates Hela kandidatlistan från servern (inklusive träffen).
 * @param match      Den valda träffen, eller null vid "ingen träff".
 *
 * ⛔ Gallrar VISNINGEN, aldrig matchningen: kandidaterna räknas fram precis som
 * förut och anroparen kan fortfarande välja vilken som helst av dem.
 */
export function pickAlternatives<T extends AlternativeLike>(
  candidates: readonly T[],
  match: { cardId: string; productId: string | null; score: number; name?: string } | null
): T[] {
  // SAMMA NAMN VISAS ALLTID — annars var de reserverade platserna en illusion.
  //
  // Servern reserverar med flit fyra platser åt namnsyskonen (SIBLING_RESERVED)
  // och ger dem poäng 0, för att "poängen kom inte ur en matchning" är sant om
  // dem. Filtret nedan mätte avståndet till träffen, och 0 ligger per definition
  // utanför varje fönster — så VARENDA syskon kastades här, varje gång.
  //
  // MÄTT mot prod 2026-08-04 (Mudbray #107 · Destined Rivals, bildavgjord
  // skanning): servern skickade alla fyra andra Mudbray, och användaren fick se
  // Terrakion #54 och Tyrunt #44 — två orelaterade kort som råkade vara bildens
  // tvåa och trea på 0,26 mot träffens 1,45. Listan visade alltså brus och
  // gömde precis de kort en felmatchning troligen ÄR.
  const matchName = match?.name?.toLowerCase();
  const sameName = (c: AlternativeLike) =>
    matchName != null && c.name.toLowerCase() === matchName;
  // Jämför på TRYCKNINGEN, inte bara kortet: de tre Base-produkterna delar
  // cardId, så ett `cardId !==`-filter hade slängt ut precis de alternativ
  // användaren behöver ("min är 1st Edition, inte Unlimited").
  const others = candidates.filter((c) =>
    match ? c.productId !== match.productId || c.cardId !== match.cardId : true
  );
  // Referensen är TRÄFFENS poäng när det finns en träff — inte listans topp.
  // Frågan alternativen svarar på är "kan skannern ha tagit fel på just DET här
  // kortet?", och det avgörs av avståndet till träffen.
  const reference = match?.score ?? others[0]?.score ?? 0;

  return (
    others
      .filter((c) => {
        // SAMMA KONST VISAS ALLTID. Omtryck med identisk konst är precis de kort
        // bildmatchningen inte KAN skilja åt — bara samlarnumret skiljer dem, och
        // det är det svåraste att läsa på en skärmfotografering. Känner sig bilden
        // säker får vinnaren dessutom en förtroendebonus (ART_TRUST 1,15), som
        // sköt omtrycket långt utanför poängfönstret: rätt kort försvann ur listan
        // och felmatchningen gick inte att rätta (Raboot #27/#37, fält 2026-08-02).
        if (c.sameArt) return true;
        // BILDENS TOPP VISAS OCKSÅ ALLTID. När modellen läser ett TRUNKERAT namn
        // ("Komala" på ett kort som heter "Larry's Komala") matchar texten ett
        // HELT ANNAT kort exakt och slår bilden. Vinnaren delar då varken namn
        // eller konst med rätt kort, så inget av villkoren ovan räddar det.
        // MÄTT 2026-08-02: bilden hade rätt i alla tre observerade fallen.
        if (c.artRank != null) return true;
        if (sameName(c)) return true;
        return reference - c.score <= ALT_SCORE_WINDOW;
      })
      // Ordning: omtryck först (troligaste rättelsen), sedan bildens egen
      // rangordning, sedan namnsyskonen, sist övriga på poäng.
      //
      // ⛔ Namnsyskonen ligger EFTER bildens topp, inte före. När modellen läser
      // ett trunkerat namn är syskonen en lista över fel kort medan bilden pekar
      // rätt (Komala/Beldum/Gloom, mätt 2026-08-02) — den ordningen är bevisad
      // och ska inte kastas om för att göra plats åt en ny regel.
      .sort(
        (a, b) =>
          Number(b.sameArt ?? false) - Number(a.sameArt ?? false) ||
          (a.artRank ?? Number.POSITIVE_INFINITY) - (b.artRank ?? Number.POSITIVE_INFINITY) ||
          Number(sameName(b)) - Number(sameName(a)) ||
          b.score - a.score
      )
      .slice(0, MAX_ALTERNATIVES)
  );
}
