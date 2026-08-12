/**
 * Vilka serier prisgrafen får rita — och vilka som är låsta bakom Pro.
 *
 * Ren dom, utan React/DB/i18n, av samma skäl som `stock-flap.ts` och
 * `collection-lots.ts`: regeln avgör om en BETALFUNKTION läcker, och en regel som
 * bara går att prova genom att rendera en produktsida provas i praktiken aldrig.
 */

/**
 * Ordningen källorna visas i — mest täckande först.
 * ⛔ Butiker ingår INTE: de är länkar, inte en marknad. Se HISTORY_SOURCE_KEYS.
 */
export const SOURCE_ORDER = ["cardmarket", "cardtrader", "tradera", "traderaSold"] as const;
export type SourceKey = (typeof SOURCE_ORDER)[number];

/**
 * TRADERA-SERIERNA ÄR PRO (ägarbeslut 2026-08-13). Gratisanvändaren ser chipsen
 * med ett lås och kan inte välja dem; kurvorna ritas aldrig.
 *
 * ⛔ ORDNINGEN I `SOURCE_ORDER` BÄR HALVA REGELN: de fria källorna (Cardmarket,
 * CardTrader) ligger FÖRST, så `available[0]` — grafens förval när Cardmarket
 * saknas — är en fri källa så snart produkten har någon. Flyttas Tradera framför
 * dem öppnar produktsidan på en låst serie och grafen står tom.
 *
 * ⛔ LÅSET ÄR EN UI-GRIND, INTE EN HEMLIGHET: produktsidan är ISR-cachad (EN
 * HTML för alla) och kan därför inte utelämna serien per besökare — talen ligger
 * kvar i sidans payload. Att verkligen hålla dem borta kräver att de lyfts ur
 * ISR-datat och hämtas av en Pro-grindad endpoint, dvs en ocachebar
 * origin-request (= Neon-väckning) per produktvisning. Samma avvägning som
 * MAX-periodens lås redan gör.
 */
export const PRO_SOURCES: readonly SourceKey[] = ["tradera", "traderaSold"];

export interface SourceGate {
  /** Källor besökaren får bocka i (har data OCH är inte låsta). */
  unlocked: SourceKey[];
  /** Källor som ritas nu. Aldrig en låst källa. */
  selected: SourceKey[];
  /** Är källan låst för den här besökaren? */
  isLocked: (key: SourceKey) => boolean;
  /**
   * Varje serie produkten HAR är låst ⇒ visa låset i stället för grafen.
   *
   * ⛔ UTAN DEN HÄR FLAGGAN LÄCKER SERIEN: `selected` blir tom, `PriceChart` får
   * `series={[]}` och faller tillbaka på `data`-propen — som på PRECIS de här
   * produkterna ÄR Tradera-serien (`trendSource` i services/products väljer den
   * när Cardmarket saknas). Grafen hade alltså ritat den låsta kurvan, bara utan
   * chip att bocka av. MÄTT i prod 2026-08-13: 37 av 31 100 produkter har enbart
   * Tradera-historik (Base-tryckningar, reverse holos och energikort utan
   * Cardmarket-data).
   */
  proGated: boolean;
}

/**
 * @param available Källor som har punkter, i `SOURCE_ORDER`-ordning.
 * @param off       Källor besökaren bockat AV (chip-tillståndet).
 * @param isPro     Pro-status. Utloggad och "vet inte än" räknas som ej Pro.
 */
export function sourceGate(
  available: readonly SourceKey[],
  off: ReadonlySet<string>,
  isPro: boolean
): SourceGate {
  const isLocked = (key: SourceKey) => !isPro && PRO_SOURCES.includes(key);
  const unlocked = available.filter((k) => !isLocked(k));
  return {
    unlocked,
    // ⛔ Låsta källor filtreras HÄR, inte vid knappen: `selected` är det enda som
    // matar grafen, så en källa som aldrig kan hamna i listan kan aldrig ritas —
    // inte via ett gammalt `off`-tillstånd och inte via ett nytt anropsställe.
    selected: available.filter((k) => !off.has(k) && !isLocked(k)),
    isLocked,
    proGated: available.length > 0 && unlocked.length === 0,
  };
}
