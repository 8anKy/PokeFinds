/**
 * POSTER (LOTS) I SAMLINGEN — en rad per KÖP, en visning per KORT.
 *
 * Köper man samma kort två gånger till olika pris blir det TVÅ rader i
 * databasen, var och en med sitt eget pris och datum, och de slås ihop till EN
 * rad i gränssnittet med totalantal och snittpris.
 *
 * VARFÖR INTE ETT SNITT I DATABASEN (ägarbeslut 2026-08-02, efter marknadskoll):
 *  1. **Försäljningen kräver det.** `Sale` ögonblicksbildar `purchasePriceOre`
 *     per försäljning. Säljer man ETT av tre exemplar köpta till olika pris
 *     finns inget "det" inköpspris att dra av under ett blandat snitt — talet
 *     existerar helt enkelt inte. En jämförbar app har precis det felet, och
 *     användarna märker det.
 *  2. **Delvis data går inte att uttrycka.** Alla befintliga poster saknar
 *     inköpspris med flit. "3 ex okänt + 1 ex à 400" kan inte skrivas i ett
 *     enda `purchasePrice`-fält utan att antingen ljuga om de tre eller kasta
 *     de 400. Med poster är det trivialt, och snittet nedan säger dessutom hur
 *     MÅNGA exemplar det bygger på.
 *  3. Varje app i kategorin som bevisligen tänkt på frågan lagrar poster; de
 *     som staplar har inte dokumenterat vad ett andra köp gör någonstans.
 *
 * ⛔ Snittet räknas BARA på exemplar som har ett pris. Ett saknat pris är inte
 * noll — noll betyder "fick gratis", saknat betyder "vet inte". Blandas de blir
 * hela vinstsiffran fel, vilket är samma regel som portföljens totaler följer.
 */

export interface LotLike {
  id: string;
  cardId: string | null;
  productId: string | null;
  quantity: number;
  condition: string;
  language: string;
  gradingCompany: string | null;
  grade: string | null;
  /** Öre per EXEMPLAR, eller null när köpet inte har något registrerat pris. */
  purchasePrice: number | null;
}

/**
 * Identiteten som avgör om två poster är samma VARA (och alltså ska visas
 * ihop). Priset ingår INTE — det är hela poängen: samma vara, olika köp.
 */
export function lotKey(item: LotLike): string {
  // ⛔ FRITEXTPOSTER GRUPPERAS ALDRIG IHOP. En post utan både kort och produkt
  // är något användaren skrivit själv ("Min pärm", "Blandad lot") — de har
  // ingen delad identitet, bara tomma id-fält. Utan den här grenen blev nyckeln
  // "||NEAR_MINT|EN||" för allihop, och HELA fritextsamlingen slogs ihop till en
  // rad med ett påhittat snittpris. Posten får då sitt EGET id som nyckel, dvs
  // grupperas bara med sig själv.
  if (!item.cardId && !item.productId) return `fritext:${item.id}`;
  return [
    item.cardId ?? "",
    item.productId ?? "",
    item.condition,
    item.language,
    item.gradingCompany ?? "",
    item.grade ?? "",
  ].join("|");
}

export interface LotGroup<T extends LotLike> {
  key: string;
  /** Posterna i gruppen, i inkommande ordning. Alltid minst en. */
  lots: T[];
  /** Alla exemplar i gruppen. */
  quantity: number;
  /** Exemplar som HAR ett inköpspris — snittets underlag. */
  costedQuantity: number;
  /** Vägt snittpris i öre per exemplar, eller null när inget köp har ett pris. */
  averagePaid: number | null;
  /** Summa betalt i öre för de exemplar som har ett pris. */
  totalPaid: number | null;
}

/**
 * Slår ihop poster till en grupp per vara.
 *
 * Ordningen bevaras: första posten för en vara bestämmer gruppens plats, så en
 * lista som redan är sorterad (t.ex. nyast först) behåller sin ordning.
 */
export function groupLots<T extends LotLike>(items: readonly T[]): LotGroup<T>[] {
  const byKey = new Map<string, LotGroup<T>>();
  const order: string[] = [];

  for (const item of items) {
    const key = lotKey(item);
    let g = byKey.get(key);
    if (!g) {
      g = { key, lots: [], quantity: 0, costedQuantity: 0, averagePaid: null, totalPaid: null };
      byKey.set(key, g);
      order.push(key);
    }
    g.lots.push(item);
    g.quantity += item.quantity;
    // ⛔ Bara prissatta exemplar räknas in. `null` är "vet inte", inte 0 kr.
    if (item.purchasePrice != null) {
      g.costedQuantity += item.quantity;
      g.totalPaid = (g.totalPaid ?? 0) + item.purchasePrice * item.quantity;
    }
  }

  for (const g of byKey.values()) {
    // Heltalsöre hela vägen: avrundas snittet till öre kan summan av
    // (snitt × antal) skilja någon öre från totalPaid — därför visar UI:t
    // ALLTID totalPaid för summor och snittet bara som snitt.
    g.averagePaid =
      g.totalPaid != null && g.costedQuantity > 0
        ? Math.round(g.totalPaid / g.costedQuantity)
        : null;
  }

  return order.map((k) => byKey.get(k)!);
}

/**
 * Får ett nytt köp stackas på en befintlig post, eller ska det bli en egen post?
 *
 * Regeln är STRIKT: bara när priserna är LIKA (inklusive båda saknade). Allt
 * annat blir en ny post.
 *
 * ⛔ Frestelsen är att stacka när det inkommande priset saknas ("det förstör
 * ju inget"). Det gör det: posten säger då "2 ex à 300 kr" när bara ett av dem
 * kostade 300, och vinsten räknas på ett exemplar för mycket. Samma sak åt
 * andra hållet — stacka in 400 kr i en prislös post och de gamla exemplaren får
 * plötsligt en anskaffningskostnad de aldrig haft.
 */
export function canStackOnto(
  existingPurchasePrice: number | null | undefined,
  incomingPurchasePrice: number | null | undefined
): boolean {
  return (existingPurchasePrice ?? null) === (incomingPurchasePrice ?? null);
}

/* ------------------------------------------------------------------------- *
 * EXEMPLAR → KÖP: planen bakom exemplararket
 * ------------------------------------------------------------------------- */

/** Ett exemplar som användaren pekat på i arket. */
export interface CopyEdit {
  /** Köpet exemplaret kommer ur. Flera exemplar delar id när köpet bar quantity > 1. */
  lotId: string;
  /** Nytt köppris i ÖRE, eller null = "vet inte". */
  purchasePrice: number | null;
  /** Ibockat = ska bort. */
  remove: boolean;
}

/** Skrivningarna arket ska göra, i den ordning de MÅSTE ske. */
export interface CopyPlan<T extends LotLike> {
  /** Köp som ska raderas helt (inga exemplar kvar). */
  deletes: T[];
  /** Köp som ska skrivas om: nytt antal och nytt pris. */
  patches: { lot: T; quantity: number; purchasePrice: number | null }[];
  /** Exemplar som bryts ut till EGNA köp. ⛔ Skrivs EFTER deletes/patches. */
  creates: { lot: T; quantity: number; purchasePrice: number | null }[];
  /** Antal exemplar som tas bort — bara till kvittensen. */
  removed: number;
}

/**
 * VECKAR IHOP EXEMPLAREN TILL KÖP IGEN.
 *
 * Databasen lagrar KÖP med antal, inte exemplar: fyra kort köpta samtidigt är
 * EN rad med `quantity: 4`. Arket vecklar ut dem så att man kan peka på ett av
 * dem; den här funktionen viker ihop dem igen. Överlevande exemplar grupperas
 * på sitt pris — första gruppen behåller köpets rad, övriga blir egna köp,
 * vilket är exakt vad två priser ÄR i den här modellen (se filhuvudet).
 *
 * ⛔ ORDNINGEN ÄR INTE KOSMETISK. `addCollectionItem` STAPLAR ett nytt köp på en
 * befintlig post med samma identitet och samma pris — vilket är rätt — men en
 * skapelse mitt i genomgången kan landa på ett köp vi ännu inte behandlat. Nästa
 * varv räknar utifrån antalet köpet hade NÄR ARKET ÖPPNADES och skulle skriva
 * ner det igen; de instaplade exemplaren försvinner tyst. Därför tre listor, och
 * `creates` körs SIST — då kan de bara lägga till.
 *
 * ⛔ Ett köp som ser likadant ut efter redigeringen rörs INTE (ingen skrivning
 * alls), så att öppna arket och stänga det kostar ingenting.
 */
export function planCopyEdits<T extends LotLike>(
  lots: readonly T[],
  copies: readonly CopyEdit[]
): CopyPlan<T> {
  const plan: CopyPlan<T> = { deletes: [], patches: [], creates: [], removed: 0 };

  for (const lot of lots) {
    const mine = copies.filter((c) => c.lotId === lot.id);
    const survivors = mine.filter((c) => !c.remove);
    plan.removed += mine.length - survivors.length;

    // Pris → antal exemplar. `null` (vet inte) är en egen nyckel, aldrig 0 kr.
    const buckets = new Map<number | null, number>();
    for (const c of survivors) buckets.set(c.purchasePrice, (buckets.get(c.purchasePrice) ?? 0) + 1);
    const entries = [...buckets.entries()];

    const unchanged =
      entries.length === 1 &&
      entries[0][0] === lot.purchasePrice &&
      entries[0][1] === lot.quantity;
    if (unchanged) continue;

    if (entries.length === 0) {
      plan.deletes.push(lot);
      continue;
    }
    const [keepPrice, keepQty] = entries[0];
    plan.patches.push({ lot, quantity: keepQty, purchasePrice: keepPrice });
    for (const [price, qty] of entries.slice(1)) {
      plan.creates.push({ lot, quantity: qty, purchasePrice: price });
    }
  }

  return plan;
}
