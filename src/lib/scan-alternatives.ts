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
 * Hur många KORT raden visar. Taket var 6 och satt för en LODRÄT lista, där
 * varje extra rad sköt ner innehållet under vikningen. Listan är sedan
 * 2026-08-04 en VÅGRÄT rad man sveper i — där kostar längden ingen höjd alls,
 * bara ett svep — så taket finns nu bara för att raden ska vara ändlig.
 *
 * ⛔ TAKET RÄKNAR KORT, ALDRIG POSTER, OCH KAPNINGEN SKER FÖRE
 * VARIANTEXPANSIONEN. Låg `flatMap(expandVariants)` före `.slice()` åt
 * TRYCKNINGARNA upp samma platser som KORTEN: ett kort med reverse holo tog två
 * platser, och namnsyskonen — som `pickAlternatives` längre ner slår fast
 * ALLTID ska visas — trängdes ut av dem. REPRODUCERAT 2026-08-29 mot den gamla
 * koden (träff + 6 namnsyskon + bildens topp-2 och topp-3, alla med reverse
 * holo — 9 kort): **12 poster men bara 7 distinkta kort, och 4 av 6 syskon**.
 * De två sist rankade syskonen föll bort HELT. Med kapningen på kort når alla
 * 9 korten raden (17 poster).
 *
 * ⛔ FORMEN ÄR VARDAGLIG, INTE KONSTRUERAD. Servern skickar upp till
 * `MAX_CANDIDATES` = 12 kandidater varav `SIBLING_RESERVED` = 6 är reserverade
 * åt namnsyskonen (`src/services/scanner/index.ts`), och namntunga kort är
 * regel: 92 % av katalogen delar namn med minst ett annat kort
 * (`.claude/rules/scanner.md`, mätt 2026-07-29), och 28 kort heter "Gyarados" (⚠️ talet kommer ur granskningen 2026-08-29 och är INTE omhärlett här — det finns ingen källa för det i repot). Ett namntungt kort med reverse holo
 * fyllde alltså taket med tryckningar av de första korten.
 *
 * ⚠️ FÖLJDEN: utdatalängden kan ÖVERSTIGA det här talet. Det är avsiktligt —
 * en vågrät rad kostar ingen höjd, och alternativet var att tappa KORT.
 */
export const MAX_ALTERNATIVES = 12;

/**
 * Ett alternativ med ANNAN konst visas bara om det ligger nära träffen i poäng.
 * Ett kort långt under träffen delade oftast bara ett namn-token ("Iron Valiant
 * ex" drog in varje Iron Hands) och är ingen förväxlingsrisk — att visa det får
 * användaren att tvivla på en träff som var rätt.
 */
export const ALT_SCORE_WINDOW = 0.2;

/** En variant av samma kort — se ScanVariant i services/scanner/types.ts. */
export interface RailVariant {
  productId: string;
  label: string | null;
  slug: string;
  estimatedValue: number | null;
}

export interface RailLike extends AlternativeLike {
  variants?: RailVariant[];
  slug?: string | null;
  variantLabel?: string | null;
  estimatedValue?: number | null;
}

/**
 * EN POST PER VARIANT — delad av BÅDA listorna, med flit.
 *
 * Servern skickar ETT objekt per KORT (`attachVariants`): reverse holon och det
 * ordinarie kortet delar `Card` men är olika `Product`, så tryckningarna finns
 * bara i `variants`. Utan uppdelningen låg de i en rullgardin och användaren
 * kunde inte VÄLJA dem där hen letade (fältrapport 2026-08-04: reverse holon
 * gick inte att välja alls).
 *
 * ⛔ EN ENDA implementation, för raden och fallbacken är SAMMA vågräta rad i
 * gränssnittet. Glider expansionen isär blir "vilka tryckningar går att välja?"
 * ett svar som beror på vilken av två kodvägar som råkade köra.
 *
 * ⛔ ANROPAS SIST I BÅDA VÄGARNA, efter `.slice(MAX_ALTERNATIVES)` — se taket.
 */
function expandVariants<T extends AlternativeLike>(c: T): T[] {
  // `variants` bor på RailLike. Typparametern behöver inte deklarera fältet för
  // att det ska få LÄSAS — anroparen skickar hela kandidaten, och att kräva
  // RailLike i `pickAlternatives` hade smalnat av dess signatur för anropare som
  // bara har poäng och namn.
  const variants = (c as Partial<RailLike>).variants;
  if (!variants || variants.length <= 1) return [c];
  return variants.map((v) => ({
    ...c,
    productId: v.productId,
    variantLabel: v.label,
    slug: v.slug,
    estimatedValue: v.estimatedValue,
  }));
}

/**
 * KORTEN MED IDENTISK KONST — svep-radens innehåll (ägarbeslut 2026-08-04,
 * DELVIS UPPHÄVT 2026-08-29; historiken står kvar, beslutet var rimligt då).
 *
 * Raden svarar på EN fråga: "vilken version av det här kortet håller jag i?"
 * Det är precis den fråga skannern inte kan besvara själv — identisk konst är
 * definitionen av vad bildmatchningen inte KAN skilja åt — och därför den enda
 * som var värd användarens uppmärksamhet där. Skälet att stänga ute kort som ser
 * annorlunda ut var: "syns det på bilden att det är ett annat kort behövs ingen
 * rad för att upptäcka det."
 *
 * ⛔ DET SKÄLET ÄR MOTBEVISAT (mätt 2026-08-29) — bilden ser INTE att det är ett
 * annat kort: på missraderna ligger bildens likhet till det kort användaren
 * VALDE på slumpbaslinje, median 0,624 mot 0,610.
 *
 * ⛔ OCH AVSMALNINGEN LÅSTE IN FELET. Filtret var
 * `sameArt || cardId === match.cardId`, och träffens eget kort uppfyller ALLTID
 * det andra ledet ⇒ raden blev aldrig tom så snart det fanns en träff ⇒
 * anroparens fallback (`pickAlternatives` i skanna/page.tsx) var DÖD KOD. En
 * felmatchning till ett kort med ANNAN konst gick alltså inte att rätta i appen
 * över huvud taget. Följderna, mätta:
 *  · 0 av 142 rättelser i den ART-AVGJORDA hinken är OFALSIFIERBART —
 *    mätapparaten kunde strukturellt inte registrera det fel den ska fånga.
 *    (Hinken är dessutom grindad på svaret: där ÄR bildens topp-1 svaret per
 *    konstruktion, och den summeras aldrig med vision-hinken.)
 *  · TVÅ rättelser har registrerats i prod över huvud taget — **2 av 649
 *    domar** — och båda hade rätt kort på plats 2 MED samma konst. ⛔ Två
 *    observationer bär ingen andel och beskriver ingen population: de säger att
 *    de rättelser vi HAR sett är av den enda sort raden gjorde möjlig, inte att
 *    rättelser typiskt ser ut så. Skriv aldrig "dvs exakt de fall där…" om n=2.
 *  · Vision-hinken (n=507, de svåra fallen): topp-1 39,8 %, topp-3 58,2 %,
 *    topp-15 67,9 %.
 *
 * ⛔ TALET SOM STÖDER UPPLÅSNINGEN ÄR BANDET I-LISTAN-MEN-INTE-FÖRST:
 * 67,9 − 39,8 = **28,1 procentenheter** av vision-hinken där rätt kort ligger
 * bland serverns kandidater men inte är träffen. Det är precis den mängd en
 * rättningsrad kan fånga — och som en rad med bara samma konst missade.
 * ⛔ De 32,1 % som ligger UTANFÖR topp-15 är ORTOGONALA mot beslutet och får
 * inte användas som skäl: de ligger också utanför serverns kandidatlista
 * (`MAX_CANDIDATES` = 12) och går inte att rätta med den vidgade raden heller.
 * Argumentet stod så här fram till granskningen 2026-08-29 — skriv inte
 * tillbaka det.
 *
 * NU: raden visas bara när den tillför ett ANNAT kort med samma konst. Gör den
 * inte det returneras [] och anroparen faller tillbaka på `pickAlternatives`.
 *
 * ⛔ ATT FALLA TILLBAKA ÄR EN OBEMÄTT VADSLAGNING, INTE ETT FÄLTBEVISAT URVAL.
 * `pickAlternatives` ordning valdes på TRE observationer 2026-08-02
 * (Komala/Beldum/Gloom) för en väg som i praktiken aldrig kördes. Nu är den
 * MAJORITETSVÄGEN: `.claude/rules/scanner.md` bokför att **378 av 649 domar
 * (58,2 %)** hade exakt ETT kort i raden, dvs inget same-art-syskon ⇒ fallback.
 * Det är en NEDRE gräns för hur ofta den fyrar, inte ett urval av gränsfall.
 *
 * ⛔ OCH BRUSET ÅTERKOMMER HÅRDAST DÄR TRÄFFEN OFTAST ÄR RÄTT. För den
 * ART-AVGJORDA hinken (31,6 % av enkelskanningarna med den nämnaren, mätt
 * 2026-08-29) fyrar fallbacken nästan alltid: `artConfidentFrom` kräver en
 * MARGINAL mellan bildens etta och tvåa, medan ett same-art-syskon per
 * definition har parvis likhet ≥ `SAME_ART_MIN` (0,9) mot träffen och därmed
 * nästan identisk likhet mot frågebilden. Ett syskon i listan trycker alltså ner
 * marginalen mot noll, och grinden säger nej ⇒ tom rad ⇒ fallback.
 * ⛔ **MEN DET ÄR EN TENDENS, INTE EN KONSTRUKTION — och den rättelsen kostade
 * en granskningsrunda.** Ett tidigare utkast här skrev "kan inte ligga 0,1 isär
 * ⇒ per konstruktion inget syskon". Två fel i en mening: (1) grinden är
 * TVÅGRENAD (`src/services/scanner/index.ts`) — `margin >= ART_TRUST_MARGIN`
 * ELLER `allAgree && margin >= ART_AGREE_MARGIN`, så det effektiva golvet för en
 * flerrutefångst är 0,05, inte 0,1; (2) det är MÄTT falsifierat samma dag —
 * 5 av 81 art-avgjorda rader kom via agree-grenen, med minsta marginal 0,056.
 * ⛔ Hårdkoda aldrig ett tröskelvärde i en kommentar: importera konstanten eller
 * namnge den. Det är samma defektklass som recall-skriptets kopierade 0,70.
 * Det är hur som helst samma hink där bilden oftast har rätt, så där betalar
 * användaren med brus (Mienfoo och Bulbasaur i raden på 0,26 mot träffens 1,45,
 * skärmdumpen 2026-08-04) för en rättningsväg hen sällan behöver.
 * ⚠️ Vadet är att bruset är värt de 28,1 procentenheterna ovan. MÄT DET —
 * korrigeringsfrekvens per hink, art-avgjord mot vision — innan det tas för
 * avgjort. Före 2026-08-29 fanns ingen mätning alls: fallbacken var död kod.
 *
 * ⚠️ RADEN VAR INTE TOM I DE FLESTA FALLEN — rättelsen av en tidigare slutsats
 * hör hit. `flatMap` ger en post per VARIANT, och just de 378 av 649 domar
 * (58,2 %) som hade ett enda KORT i raden hade flera VARIANTER av det kortet
 * (`.claude/rules/scanner.md`, 2026-08-29). Knappen fanns alltså oftare än det
 * såg ut; den erbjöd bara aldrig ett ANNAT kort.
 * ⛔ Här stod tidigare "≥2 valbara poster i 54,0 % av alla rader och 76,0 % av
 * de dömda". De talen går inte att belägga ur repot och är STRUKNA vid
 * granskningen 2026-08-29 — skriv aldrig tillbaka ett tal utan en körning att
 * peka på.
 *
 * ⛔ TRÄFFENS VARIANTER MÅSTE FINNAS I BÅDA LÄGENA. En reverse holo är ofta den
 * enda meningsfulla rättelsen. I raden kommer de med här; i fallback-läget bär
 * `pickAlternatives` träffens ÖVRIGA varianter (anroparen sätter träffens egen
 * post först). Tas expansionen bort på endera stället återinförs fältrapporten
 * 2026-08-04 som pris för den här upplåsningen.
 */
export function pickSameArtRail<T extends RailLike>(
  candidates: readonly T[],
  match: { cardId: string; productId: string | null } | null
): T[] {
  const isMatchCard = (c: T) => match != null && c.cardId === match.cardId;

  // Träffens EGET kort räknas inte som ett alternativ — det var ledet som gjorde
  // raden osänkbar. Serverns `sameArt` är dessutom `true` på vinnaren själv
  // (likheten mot sig själv är 1), så ett bart `c.sameArt` hade behållit exakt
  // samma bugg.
  if (!candidates.some((c) => c.sameArt && !isMatchCard(c))) return [];

  const sameArt = candidates.filter((c) => c.sameArt || isMatchCard(c));

  // Träffens EGET kort först — raden ska börja där blicken redan är.
  const ordered = [...sameArt].sort(
    (a, b) => Number(isMatchCard(b)) - Number(isMatchCard(a)) || b.score - a.score
  );

  // ⛔ KAPA PÅ KORT, EXPANDERA SEDAN. Låg `flatMap` före `slice` åt ett kort med
  // reverse holo två platser, och omtryckssyskonen längst ner i raden — de
  // troligaste rättelserna — trängdes ut av tryckningar av korten över dem.
  return ordered.slice(0, MAX_ALTERNATIVES).flatMap(expandVariants);
}

/**
 * @param candidates Hela kandidatlistan från servern (inklusive träffen).
 * @param match      Den valda träffen, eller null vid "ingen träff".
 *
 * ⛔ Gallrar VISNINGEN, aldrig matchningen: kandidaterna räknas fram precis som
 * förut och anroparen kan fortfarande välja vilken som helst av dem.
 *
 * ⛔ SEDAN 2026-08-29 ÄR DEN HÄR VÄGEN LEVANDE. Fram till dess vann
 * `pickSameArtRail` alltid när det fanns en träff (se dess kommentar), så
 * fallbacken kunde tas för en kuriositet för textskanningar. Nu är den den ENDA
 * rättningsvägen när ingen annan kandidat delar konst med träffen — dvs vägen
 * som ska fånga felmatchningar till ett kort som ser ANNORLUNDA ut.
 */
export function pickAlternatives<T extends AlternativeLike>(
  candidates: readonly T[],
  match: { cardId: string; productId: string | null; score: number; name?: string } | null
): T[] {
  // SAMMA NAMN VISAS ALLTID — annars var de reserverade platserna en illusion.
  //
  // Servern reserverar med flit SEX platser åt namnsyskonen (`SIBLING_RESERVED`
  // = 6 i `src/services/scanner/index.ts`, verifierat 2026-08-29). Konstanten
  // var 4 när fältfallet nedan mättes och höjdes 4 → 6 samma dag, just för att
  // det femte syskonet trängdes ut av taket. Syskonen får poäng 0, för att
  // "poängen kom inte ur en matchning" är sant om dem. Filtret nedan mätte
  // avståndet till träffen, och 0 ligger per definition utanför varje fönster —
  // så VARENDA syskon kastades här, varje gång.
  //
  // MÄTT mot prod 2026-08-04 (Mudbray #107 · Destined Rivals, bildavgjord
  // skanning): servern skickade de fyra andra Mudbray som rymdes under det
  // dåvarande taket, och användaren fick se Terrakion #54 och Tyrunt #44 — två
  // orelaterade kort som råkade vara bildens tvåa och trea på 0,26 mot träffens
  // 1,45. Listan visade alltså brus och gömde precis de kort en felmatchning
  // troligen ÄR.
  const matchName = match?.name?.toLowerCase();
  const sameName = (c: AlternativeLike) =>
    matchName != null && c.name.toLowerCase() === matchName;

  // Träffens EGEN post — och BARA den — ska bort ur raden: anroparen sätter
  // träffen först, och samma kort två gånger är en fråga användaren inte kan
  // svara på. Jämför på TRYCKNINGEN, inte bara kortet: de tre Base-produkterna
  // delar cardId, så ett `cardId !==`-filter hade slängt ut precis de alternativ
  // användaren behöver ("min är 1st Edition, inte Unlimited").
  const isMatchPost = (c: AlternativeLike) =>
    match != null && c.productId === match.productId && c.cardId === match.cardId;

  // ⛔ HELA GALLRINGEN GÅR PÅ KORT — filter, sortering OCH kapning — och
  // expansionen ligger SIST. Varianterna får aldrig äta kortens platser (se
  // MAX_ALTERNATIVES). Ordningen blir densamma som en post-sortering hade gett:
  // alla sorteringsnycklar (konst, bildrang, namn, poäng) hör till KORTET och är
  // identiska för dess tryckningar. Bara taket räknar en annan sak — rätt sak.
  //
  // Träffens eget KORT måste ändå överleva hit när det har andra tryckningar:
  // slutfiltret tar bort exakt träffens EGEN produkt, och det är först då reverse
  // holon blir kvar i den enda rättningsväg som finns när ingen kandidat delar
  // konst med träffen (fältrapport 2026-08-04). Predikatet är därför "bidrar
  // kortet med minst EN valbar post?", uttryckt med SAMMA `isMatchPost` som
  // slutfiltret — annars kan de två driva isär och kortet ta en plats det inte
  // fyller.
  const cards = candidates.filter((c) => expandVariants(c).some((p) => !isMatchPost(p)));

  // Referensen är TRÄFFENS poäng när det finns en träff — inte listans topp.
  // Frågan alternativen svarar på är "kan skannern ha tagit fel på just DET här
  // kortet?", och det avgörs av avståndet till träffen.
  const reference = match?.score ?? cards[0]?.score ?? 0;

  return (
    cards
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
      // SIST: en post per tryckning, och först här faller träffens egen produkt
      // bort. Kortet bar hit sina tryckningar; nu delas de upp så de går att
      // VÄLJA där användaren letar. ⚠️ Sorteringen är stabil och nycklarna hör
      // till kortet, så tryckningarna håller ihop i serverns ordning
      // (ordinarie först).
      .flatMap(expandVariants)
      .filter((c) => !isMatchPost(c))
  );
}
