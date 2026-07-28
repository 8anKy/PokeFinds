/**
 * SAMLARORDNING för kortnummer — "1, 2, 3 … 102", inte "1, 10, 100, 101, 102, 11".
 *
 * `Card.number` är en STRÄNG (kortnumret trycks inte alltid som ett tal), så en
 * rak sortering på kolumnen ger bokstavsordning: Base börjar med 1, 10, 100, 101,
 * 102, 11 … Det är inte ordningen någon har korten i pärmen.
 *
 * Formaten i katalogen (mätt över 20 563 kort 2026-07-28):
 *   18 931  "93"          rent tal
 *    1 510  "TG28"        delserie med bokstavsprefix (TG/GG/SV/RC …)
 *       71  "143a"        bokstavsSUFFIX — en egen tryckning av samma nummer
 *       31  "A" … "Z"     bara bokstäver
 *       10  "MEP 074"     prefix + mellanslag
 *        8  "SM103a"      prefix, tal OCH suffix
 *        2  "!" / "?"     ingen bokstav, inget tal
 *
 * Ordningen: huvudnumreringen först (tomt prefix), sedan delserierna alfabetiskt,
 * och inom varje serie stigande tal med suffixet direkt efter sitt grundnummer
 * (143 → 143a). Kort helt utan tal hamnar sist — de har ingen plats i talraden.
 *
 * DE BOKSTAVSNUMRERADE ÄR INTE SKRÄP: 28 av dem är Unowns egna alfabet i Unseen
 * Forces ("A" … "Z", "!", "?"), där bokstaven ÄR samlarordningen, plus fyra Alph
 * Lithograph ("ONE" … "FOUR"). De sorteras därför alfabetiskt sinsemellan och
 * hamnar efter setets numrerade kort — inte i en klump vid nummer noll.
 *
 * Fallande ordning är den EXAKTA spegelbilden (Unown Z först). Det är med flit:
 * "högst först" ska vara samma lista baklänges, annars kan två kort byta inbördes
 * plats när man vänder på sorteringen. Produkter helt UTAN kort (sealed) ligger
 * dock sist i båda riktningarna — det sköts av `nulls: "last"` i feedOrderBy.
 */

export interface CardNumberParts {
  /** Bokstäver före talet, gemener ("tg", "gg", "mep"). "" = huvudnumreringen. */
  prefix: string;
  /** Talet, eller null när numret saknar siffror ("A", "!"). */
  num: number | null;
  /** Bokstäver efter talet, gemener ("a" i "143a"). */
  suffix: string;
}

/** Tal utan siffror sorteras sist — högre än något riktigt kortnummer. */
const NO_NUMBER = 9_999_999;

const lettersOnly = (s: string) => s.replace(/[^A-Za-z]/g, "").toLowerCase();

export function parseCardNumber(raw: string | null | undefined): CardNumberParts {
  const s = String(raw ?? "").trim();
  const m = /^([^\d]*?)\s*(\d+)\s*([A-Za-z]*)$/.exec(s);
  // Inga siffror alls ("A", "!", "?") — bokstäverna är prefixet, precis som i
  // SQL-nyckeln. (Att behålla råsträngen här gav "!" prefixet "!" medan SQL:en
  // gav "", och då hade de två ordningarna inte varit samma ordning.)
  if (!m) return { prefix: lettersOnly(s), num: null, suffix: "" };
  return { prefix: lettersOnly(m[1]), num: parseInt(m[2], 10), suffix: m[3].toLowerCase() };
}

/**
 * Jämför två kortnummer i samlarordning. Stabil och total: lika delar faller
 * tillbaka på råsträngen så att ordningen aldrig hänger på inmatningsordningen
 * (samma resonemang som feedRowWins — ett värde som byter plats mellan två
 * renderingar läser som en förändring fast ingenting hänt).
 */
export function compareCardNumbers(a: string | null | undefined, b: string | null | undefined): number {
  const pa = parseCardNumber(a), pb = parseCardNumber(b);
  if (pa.prefix !== pb.prefix) return pa.prefix < pb.prefix ? -1 : 1;
  const na = pa.num ?? NO_NUMBER, nb = pb.num ?? NO_NUMBER;
  if (na !== nb) return na - nb;
  if (pa.suffix !== pb.suffix) return pa.suffix < pb.suffix ? -1 : 1;
  return String(a ?? "").localeCompare(String(b ?? ""));
}

/**
 * Samma ordning uttryckt som en SORTERBAR STRÄNG — spegelbild av den GENERATED
 * kolumnen `Card.numberSortKey` (migration 20260728210000). Databasen sorterar
 * katalogen (som pagineras i SQL); den här används där datat redan är hämtat,
 * t.ex. setsidan. Ändras den ena MÅSTE den andra ändras — testet
 * card-number-order.test.ts jämför dem tecken för tecken.
 *
 * Utfyllnaden är '0', ALDRIG mellanslag: mellanslag är ignorerbara i icke-C-
 * collation, så en mellanslagspaddad nyckel kan sortera olika i olika miljöer.
 * Siffror sorterar före bokstäver i både C och en_US → huvudnumreringen (tomt
 * prefix) före delserierna (TG/GG/SV) i båda.
 */
export function cardNumberSortKey(raw: string | null | undefined): string {
  const { prefix, num, suffix } = parseCardNumber(raw);
  return (
    prefix.slice(0, 4).padEnd(4, "0") +
    String(num ?? NO_NUMBER).slice(0, 7).padStart(7, "0") +
    suffix.slice(0, 3).padEnd(3, "0")
  );
}
