/**
 * Köppris och vinst/förlust för samlingsposter — REN aritmetik, inga React-beroenden,
 * så den går att testa utan att dra in next-intl/Next-navigation.
 *
 * Alla belopp är ÖRE (heltal). Kronor finns bara i inmatningsfältet och i formatPrice().
 */
import { groupLots, type LotGroup, type LotLike } from "@/lib/collection-lots";

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

/* ------------------------------------------------------------------------- *
 * GRUPPNIVÅ — en visning per VARA, en post per KÖP
 * ------------------------------------------------------------------------- */

/**
 * En samlingsrad sedd som en POST: identiteten (`LotLike`) plus det vinsten
 * behöver (`ProfitInput`) plus köpdatumet, som bara används för visningsordning.
 */
export type LotRow = LotLike & ProfitInput & { purchaseDate?: string | null };

/**
 * Posterna i visningsordning: ÄLDSTA köpet först, odaterade sist.
 *
 * Listan kommer in nyast-först (createdAt desc) från servern, men en köphistorik
 * läses framifrån — "300 kr i juli, 400 kr i augusti" berättar något, omvänt gör
 * det inte. ISO-strängar sorteras lexikalt = kronologiskt, så ingen Date behövs.
 * Sorteringen är STABIL (index som andra nyckel): två köp samma dag behåller
 * serverns ordning i stället för att hoppa runt mellan renderingar.
 */
function sortLotsForDisplay<T extends LotRow>(lots: T[]): T[] {
  return lots
    .map((lot, index) => ({ lot, index }))
    .sort((a, b) => {
      const da = a.lot.purchaseDate ?? null;
      const db = b.lot.purchaseDate ?? null;
      if (da === db) return a.index - b.index;
      if (da == null) return 1;
      if (db == null) return -1;
      return da < db ? -1 : 1;
    })
    .map((x) => x.lot);
}

/**
 * Grupperar samlingsraderna till en visning per vara. Grupperingen ÄR
 * `groupLots`; det enda som läggs till här är visningsordningen inom gruppen.
 *
 * (Fritextposter — utan både `cardId` och `productId` — hanterades ett tag med
 * en syntetisk nyckel här. Den hör hemma i `lotKey`, som numera gör det själv:
 * en post utan katalogidentitet grupperas bara med sig själv. Ett mönster, inte
 * två.)
 */
export function groupCollectionLots<T extends LotRow>(rows: readonly T[]): LotGroup<T>[] {
  return groupLots(rows).map((g) => ({ ...g, lots: sortLotsForDisplay(g.lots) }));
}

/**
 * Vinst/förlust för en HEL grupp: summan av posternas vinster.
 *
 * ⛔ Bara poster som HAR ett köppris räknas — exakt samma regel som `rowProfit`
 * och som portföljtotalen. En prislös post drar alltså varken upp eller ner
 * siffran, och det är därför gränssnittet MÅSTE säga hur många exemplar
 * siffran bygger på (`costedQuantity` mot `quantity`). Utan den upplysningen
 * läses "+200 kr" som hela gruppens vinst.
 *
 * Procenten räknas mot den faktiska kostnadsbasen (summa betalt), vilket för en
 * ensam post ger exakt samma tal som `rowProfit` — grupper med en post är per
 * definition oförändrade.
 */
export function groupProfit(lots: readonly ProfitInput[]): RowProfit | null {
  let amount = 0;
  let basis = 0;
  let costedLots = 0;
  for (const lot of lots) {
    const p = rowProfit(lot);
    if (p == null) continue;
    costedLots += 1;
    amount += p.amount;
    basis += (lot.purchasePrice ?? 0) * lot.quantity;
  }
  if (costedLots === 0) return null;
  return { amount, percent: basis > 0 ? (amount / basis) * 100 : null };
}

/**
 * Gruppens värde PER STYCK (öre) — samma slot som en ensam post visar idag, så
 * kortet betyder samma sak oavsett hur många köp som ligger bakom det.
 *
 * Poster utan värde utelämnas ur både täljare och nämnare: ett saknat värde är
 * inte 0 kr. Normalfallet är att alla poster delar samma live-värde, och då är
 * snittet exakt det värdet.
 */
export function groupUnitValue(lots: readonly ProfitInput[]): number | null {
  let total = 0;
  let quantity = 0;
  for (const lot of lots) {
    if (lot.estimatedValue == null) continue;
    total += lot.estimatedValue * lot.quantity;
    quantity += lot.quantity;
  }
  return quantity > 0 ? Math.round(total / quantity) : null;
}
