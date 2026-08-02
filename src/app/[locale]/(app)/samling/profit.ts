/**
 * Köppris och vinst/förlust för samlingsposter — REN aritmetik, inga React-beroenden,
 * så den går att testa utan att dra in next-intl/Next-navigation.
 *
 * Alla belopp är ÖRE (heltal). Kronor finns bara i inmatningsfältet och i formatPrice().
 */

/**
 * Öre → kronor som redigerbar sträng (komma som decimaltecken, som svenskar skriver).
 * Motsatsen — kronor tillbaka till öre — görs av `parseKronorToOre` i
 * `@/lib/purchase-price`: EN inmatningstolk för hela appen, aldrig två (den skiljer
 * BLANKT från 0 och avvisar negativa värden i stället för att tappa dem tyst).
 */
export function oreToKr(ore: number | null): string {
  return ore == null ? "" : String(ore / 100).replace(".", ",");
}

export interface ProfitInput {
  quantity: number;
  purchasePrice: number | null; // öre, per styck
  /** Aktuellt värde per styck (öre) — sidans redan framräknade live-värde. */
  estimatedValue: number | null;
}

export interface RowProfit {
  /** Vinst/förlust för HELA posten (per styck × antal), öre. */
  amount: number;
  /** Procent — kvantitetsoberoende. null när köppriset är 0 (ingen bas att dela med). */
  percent: number | null;
}

/**
 * Vinst/förlust för en post: aktuellt värde minus köppris. `estimatedValue` ÄR det
 * live-värde sidan redan räknat fram (valueCollectionItems) — värdet räknas aldrig om
 * en andra väg. Saknas köppris finns ingen kostnadsbas → null, och posten räknas heller
 * inte in i portföljtotalen (vi gissar ALDRIG ett inköpspris ur marknadsvärdet).
 */
export function rowProfit(row: ProfitInput): RowProfit | null {
  if (row.purchasePrice == null || row.estimatedValue == null) return null;
  const perUnit = row.estimatedValue - row.purchasePrice;
  return {
    amount: perUnit * row.quantity,
    percent: row.purchasePrice > 0 ? (perUnit / row.purchasePrice) * 100 : null,
  };
}

/** Färgklass för vinst/förlust — samma semantiska tokens som PriceChange använder. */
export function profitToneClass(amount: number): string {
  return amount > 0 ? "text-rise" : amount < 0 ? "text-fall" : "text-ink-muted";
}
