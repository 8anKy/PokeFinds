/**
 * SETETS SAMMANSÄTTNING — vad ett set FAKTISKT innehåller.
 *
 * En rad per sällsynthet: hur många kort som bär den, hur stor andel av setet
 * det är, och vad de korten kostar (median + summa). Allt räknas ur data vi
 * redan äger — modulen är REN: ingen Prisma, ingen fetch, inget datum, inget
 * slumptal. Setsidan skickar in korten den redan hämtat, vilket är hela poängen
 * (ISR-sidan får inte kosta en enda ny Neon-fråga för den här rutan).
 *
 * ⛔ DET HÄR ÄR INTE — OCH FÅR ALDRIG BLI — DRAGCHANSER ("pull rates").
 * Ägaren bad om dragchanser. De går inte att ta fram ärligt, och skälen är
 * fyra, inte ett:
 *  1. The Pokémon Company publicerar inga sannolikheter för fysiska
 *     boosterpaket. Det finns alltså ingen primärkälla att citera.
 *  2. Den enda RIKTIGT uppmätta datan (TCGplayers artiklar per set) är inte
 *     maskinläsbar, är förbjuden att återanvända enligt deras villkor, och
 *     täcker ~20 av våra ~174 set. Den kan varken hämtas eller fyllas ut.
 *  3. Sajterna med bred täckning skriver själva i sina brasklappar att deras
 *     siffror är SIMULERADE uppskattningar. Att kopiera dem vore att publicera
 *     någon annans gissning som vårt mätvärde.
 *  4. ⛔ Genvägen "ett delat med antalet kort i sällsyntheten" ÄR INGEN
 *     dragchans, och den är som mest fel för precis de set samlare bryr sig
 *     mest om: paket samlas från TRYCKARK, där ett enskilt kort kan tryckas i
 *     fler eller färre positioner än sina jämlikar ("boostade" chase-kort). En
 *     sällsynthet med få kort betyder alltså inte att korten är svårare att dra.
 * Därför exporterar den här modulen INGEN funktion som räknar en sannolikhet,
 * en kvot eller något som kan läsas som odds. `tests/unit/set-composition.test.ts`
 * vaktar det med ett regressionstest — riv inte det för att "lägga till en
 * liten dragchans".
 *
 * ⛔ PRISER ÄR ÖRE (heltal), aldrig float, och 0 ÄR INGET PRIS. En tier där
 * inget kort har ett känt pris returnerar `null` för både median och summa.
 * "0 kr" läses som "gratis", "–" läses som "vi vet inte" — samma regel som
 * `priceOreFromEur()` och portföljens vinstsiffra följer.
 *
 * ⛔ ETT OKÄNT PRIS FÅR ALDRIG RÄKNAS IN SOM EN NOLLA. Prislösa kort lyfts ur
 * medianens underlag helt, och raden bär `pricedCount` vid sidan av `count` så
 * gränssnittet kan säga "9 av 12 har pris" i stället för att låtsas att hela
 * tiern är mätt. Exakt samma mönster som `groupLots`
 * (`costedQuantity` vid sidan av `quantity`) i `src/lib/collection-lots.ts`.
 *
 * ⛔ MEDIAN, INTE MEDELVÄRDE. Singelpriset är Cardmarkets NM-"From" RAKT AV, och
 * den policyn släpper med flit igenom enstaka absurt dyra annonser (en graderad
 * ask till 37 000 € publiceras som kortets From — se `.claude/rules/cm-pricing.md`).
 * Ett medelvärde hade låtit EN sådan rad bestämma hela sällsynthetens siffra.
 * Medianen bär inte outliern, och den är dessutom det tal en samlare menar med
 * "vad kostar ett sånt kort".
 */

/** Ett kort ur setet, reducerat till det sammansättningen behöver. */
export interface CompositionCard {
  /**
   * Sällsyntheten rakt ur katalogen (pokemontcg.io). `null`/tom sträng = vi har
   * ingen — det händer för promos och nyimporterade set.
   */
  rarity: string | null;
  /**
   * Kortets lägsta kända pris i ÖRE, eller `null` när inget pris är känt.
   * ⛔ Ett värde ≤ 0 behandlas som OKÄNT, inte som "gratis": nollor uppstår
   * både i källan och i avrundningen, och båda är fel som pris.
   */
  priceOre: number | null;
}

/** En rad i sammansättningen — en sällsynthet. */
export interface SetCompositionRow {
  /**
   * Sällsynthetens namn som katalogen stavar det, eller `null` när katalogen
   * saknar värdet. ⛔ Gränssnittet måste översätta `null` till en egen etikett;
   * modulen hittar aldrig på ett namn.
   */
  rarity: string | null;
  /** Antal kort i setet som bär sällsyntheten. */
  count: number;
  /**
   * Hur många av dem som HAR ett känt pris — medianens och summans underlag.
   * Alltid ≤ `count`.
   */
  pricedCount: number;
  /**
   * Sällsynthetens andel av setets kort som BRÅKDEL (0–1), inte procent.
   * Gränssnittet formaterar. ⛔ Andelen är en beskrivning av innehållet, inte
   * en chans att dra ett sådant kort.
   */
  share: number;
  /** Median i ÖRE över de prissatta korten, `null` när inget kort har pris. */
  medianPriceOre: number | null;
  /** Summa i ÖRE över de prissatta korten, `null` när inget kort har pris. */
  totalPriceOre: number | null;
}

/** Hela sammansättningen. Namnet speglar `SetCompletionResult` med flit. */
export interface SetCompositionResult {
  /** Raderna, i visningsordning (se `sortRows` nedan). */
  rows: SetCompositionRow[];
  /** Antal kort som ingår i beräkningen — nämnaren i varje `share`. */
  cardCount: number;
  /** Hur många av dem som har ett känt pris. */
  pricedCardCount: number;
}

/**
 * Nyckeln som avgör om två kort hör till samma rad.
 *
 * Skiftläge fälls ihop, mellanslag trimmas: ett kvarglömt "Rare holo" från en
 * enskild import ska inte bli en egen spöktier bredvid "Rare Holo". ⛔ ETIKETTEN
 * fälls däremot ALDRIG ihop — den första stavningen vi ser är den vi visar,
 * eftersom vi inte äger någon ordlista över sällsyntheter och alltså inte kan
 * välja "rätt" stavning utan att gissa.
 */
function rarityKey(rarity: string | null | undefined): string {
  return normalizeRarity(rarity)?.toLowerCase() ?? UNKNOWN_KEY;
}

/** Tom/whitespace-only sällsynthet är samma sak som ingen alls. */
function normalizeRarity(rarity: string | null | undefined): string | null {
  const trimmed = (rarity ?? "").trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * ⛔ Nyckeln för "okänd sällsynthet" är TOMMA STRÄNGEN, som per definition inte
 * kan krocka med en normaliserad sällsynthet (de är alltid minst ett tecken).
 */
const UNKNOWN_KEY = "";

/**
 * Är det här ett pris vi kan räkna på?
 *
 * ⛔ Nej för `null`, för icke-tal och för allt ≤ 0. Nollor uppstår på två vägar
 * — källan publicerar dem för kort utan engelska annonser, och avrundningen gör
 * äkta småbelopp till 0 öre — och båda skulle dra ner medianen till något som
 * ser ut som ett fynd. Ett okänt pris ska synas som okänt.
 */
function isKnownPrice(ore: number | null | undefined): ore is number {
  return typeof ore === "number" && Number.isFinite(ore) && ore > 0;
}

/**
 * Medianen av redan sorterade heltalsören.
 *
 * ⛔ Vid JÄMNT antal avrundas snittet av de två mittersta till HELA ÖRE — priser
 * är heltal hela vägen genom appen och ett halvt öre är inget belopp. Summan
 * (`totalPriceOre`) räknas alltid på råvärdena, aldrig på medianen × antal.
 */
function medianOfSortedOre(sorted: readonly number[]): number | null {
  if (sorted.length === 0) return null;
  const mid = sorted.length >> 1;
  if (sorted.length % 2 === 1) return sorted[mid];
  return Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

/**
 * VISNINGSORDNING: FÄRRE KORT FÖRST.
 *
 * Motiveringen, eftersom det inte är självklart:
 *  • Vi äger ingen rangordning av sällsyntheter. Strängarna kommer från
 *    pokemontcg.io som fritext ("Rare Secret", "Illustration Rare", "Special
 *    Illustration Rare", "Hyper Rare", …) och nya namn dyker upp med varje ny
 *    era. En handunderhållen ordinal karta hade fallit tillbaka på "okänd" för
 *    precis de nyaste seten — dvs failat öppet där den behövs mest.
 *  • Antalet däremot kommer ur datan själv och kräver ingen ordlista. Den tier
 *    som har färrest kort är den korta, dyra listan högst upp — det en samlare
 *    öppnar sidan för att titta på — medan "Common" med sina 80 rader hamnar
 *    längst ner där den hör hemma. Ingen behöver scrolla för chase-raden.
 *  • ⛔ ATT DEN LIGGER ÖVERST ÄR EN LÄSORDNING, INGET MÅTT. Färre kort i en
 *    sällsynthet säger ingenting om chansen att dra ett av dem (tryckark, se
 *    filhuvudet). Ordningen får aldrig kommenteras som "svårast först".
 *
 * Tre nivåer, alla deterministiska så att samma set alltid ritas likadant:
 *  1. Okänd sällsynthet ALLTID sist — den är ett datahål, inte en chase-tier,
 *     och den skulle annars ofta hamna högst upp (den är oftast liten).
 *  2. Antal stigande.
 *  3. Lika många kort → dyrast median först (prislös median sist), och därefter
 *     namnet alfabetiskt som sista utslag.
 */
function sortRows(rows: SetCompositionRow[]): SetCompositionRow[] {
  return rows.sort((a, b) => {
    const aUnknown = a.rarity === null ? 1 : 0;
    const bUnknown = b.rarity === null ? 1 : 0;
    if (aUnknown !== bUnknown) return aUnknown - bUnknown;

    if (a.count !== b.count) return a.count - b.count;

    if (a.medianPriceOre !== b.medianPriceOre) {
      // Prislös tier sist bland jämnstora — "–" är inget att inleda med.
      if (a.medianPriceOre === null) return 1;
      if (b.medianPriceOre === null) return -1;
      return b.medianPriceOre - a.medianPriceOre;
    }

    return (a.rarity ?? "").localeCompare(b.rarity ?? "", "sv");
  });
}

/**
 * Räknar ihop setets sammansättning.
 *
 * Anroparen skickar kort — INTE sealed. En boosterbox har ingen sällsynthet och
 * hör inte hemma i en sammansättning av korten; setsidan filtrerar därför bort
 * dem innan anropet. Kommer de ändå med hamnar de i "okänd"-raden, vilket är
 * synligt fel i stället för tyst fel.
 */
export function computeSetComposition(
  cards: readonly CompositionCard[]
): SetCompositionResult {
  // Ackumulera per nyckel. Priserna samlas i en array eftersom medianen kräver
  // hela underlaget — den går inte att strömma som en summa gör.
  const buckets = new Map<
    string,
    { rarity: string | null; count: number; pricesOre: number[] }
  >();

  let pricedCardCount = 0;

  for (const card of cards) {
    const key = rarityKey(card.rarity);
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { rarity: normalizeRarity(card.rarity), count: 0, pricesOre: [] };
      buckets.set(key, bucket);
    }
    bucket.count += 1;
    // ⛔ Bara kort med ett känt pris går in i underlaget. Ett saknat pris är
    // inte 0 kr, och en nolla i den här arrayen hade förgiftat både medianen
    // och summan.
    if (isKnownPrice(card.priceOre)) {
      bucket.pricesOre.push(card.priceOre);
      pricedCardCount += 1;
    }
  }

  const cardCount = cards.length;

  const rows: SetCompositionRow[] = [];
  for (const bucket of buckets.values()) {
    // Sorteras stigande på plats — arrayen är bucketens egen och används inte
    // till något annat. ⛔ `Array.prototype.sort` jämför som STRÄNGAR utan
    // komparator, så 1000 hade hamnat före 200. Komparatorn är obligatorisk.
    const sortedOre = bucket.pricesOre.sort((x, y) => x - y);
    const totalPriceOre =
      sortedOre.length > 0 ? sortedOre.reduce((sum, ore) => sum + ore, 0) : null;

    rows.push({
      rarity: bucket.rarity,
      count: bucket.count,
      pricedCount: sortedOre.length,
      // Nämnaren är antalet kort vi räknat, så andelarna summerar till 1 även
      // när ett set har kort utan sällsynthet. Tomt set ⇒ inga rader alls, så
      // division med noll kan inte inträffa här.
      share: cardCount > 0 ? bucket.count / cardCount : 0,
      medianPriceOre: medianOfSortedOre(sortedOre),
      totalPriceOre,
    });
  }

  return { rows: sortRows(rows), cardCount, pricedCardCount };
}

/**
 * "Hur många kort i det här setet delar det här kortets sällsynthet?"
 *
 * Tänkt för produktsidan, som har setets kort men ingen anledning att rita hela
 * tabellen. Samma normalisering som tabellen använder, så talet stämmer med
 * raden på setsidan.
 *
 * ⛔ RETURNERAR ETT ANTAL — ett kort av N i setet bär samma sällsynthet. Det är
 * INTE en nämnare i en sannolikhet, och får aldrig användas som en. Se
 * filhuvudets punkt 4.
 */
export function countCardsWithRarity(
  cards: readonly CompositionCard[],
  rarity: string | null | undefined
): number {
  const key = rarityKey(rarity);
  let count = 0;
  for (const card of cards) {
    if (rarityKey(card.rarity) === key) count += 1;
  }
  return count;
}
