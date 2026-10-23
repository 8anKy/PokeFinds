/**
 * "REK. PRIS (EU)" — tillverkarens rekommenderade europris ur prisleverantörens sealed-rad
 * (`/pokemon/products`, fältet `msrp`, nytt 2026-10-20). Ren och testad; skrivningen bor i
 * services/eu-rrp.ts.
 *
 * Fältet har tre marknader: `us` (USD), `eu` (EUR) och `uk` (GBP), var och en `null` eller
 * `{ price, currency }`. Mätt 2026-10-23 över hela katalogen (2 664 rader): 220 rader bär ett
 * `msrp`, 193 ett `eu`, alla engelska.
 *
 * ⛔ BARA `eu`. Ett USD- eller GBP-tal omräknat till euro är inget europeiskt riktpris, och
 *    Delta Reigns Pokémon Center-ETB har `eu: null` men `us` 59,99 — den ska stå utan rad.
 * ⛔ SAMMA TAL I ALLA TRE VALUTOR ÄR EN KOPIA, INTE TRE RIKTPRISER: 51 rader (varje ETB och
 *    ETB-case sedan Scarlet & Violet) bär 49,99 USD = 49,99 EUR = 49,99 GBP. Bundle-raderna
 *    bredvid visar att leverantören annars HAR olika tal per marknad (26,94 / 29,99 / 23,94),
 *    så ett identiskt trippeltal är det amerikanska priset utskrivet tre gånger. Hellre ingen
 *    rad än ett påhittat europris.
 * ⛔ Riktpriset rör ALDRIG rubrikpris, "Lägst", statistik, larm eller samlingsvärde — det är
 *    en upplysning bredvid marknadspriset, inte ett pris någon kan köpa till.
 */

export interface ProviderPrice {
  price?: number | null;
  currency?: string | null;
}

export interface EuRrpRow {
  cardmarket_id: number | null;
  lang?: string | null;
  msrp?: { us?: ProviderPrice | null; eu?: ProviderPrice | null; uk?: ProviderPrice | null } | null;
}

/** Över det här är det ett tecken på ett felinmatat tal, inte en låda (dyraste äkta: case à 500 €). */
const MAX_PLAUSIBLE_EUR = 5_000;

function priceOf(p: ProviderPrice | null | undefined, currency: string): number | null {
  if (!p || p.currency !== currency) return null;
  const v = p.price;
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null;
}

/** EU-riktpriset i EUR-CENT, eller null när raden inte bär ett trovärdigt europris. */
export function extractEuRrp(row: EuRrpRow): number | null {
  if (row.lang != null && row.lang !== "en") return null;
  const eu = priceOf(row.msrp?.eu, "EUR");
  if (eu == null || eu > MAX_PLAUSIBLE_EUR) return null;
  const us = priceOf(row.msrp?.us, "USD");
  const uk = priceOf(row.msrp?.uk, "GBP");
  if (us != null && uk != null && us === eu && uk === eu) return null; // kopierat trippeltal
  return Math.round(eu * 100);
}

/**
 * idProduct → EUR-cent (satt) eller null (raden finns men saknar ett trovärdigt europris ⇒
 * töm ett gammalt värde). En idProduct som SAKNAS i kartan rörs inte (leverantören listade
 * den inte i dag). Två rader med samma idProduct och OLIKA tal ⇒ null: vi vet inte vilket.
 */
export function euRrpByCmId(rows: readonly EuRrpRow[]): Map<number, number | null> {
  const out = new Map<number, number | null>();
  for (const row of rows) {
    if (row.cardmarket_id == null) continue;
    const cents = extractEuRrp(row);
    if (!out.has(row.cardmarket_id)) out.set(row.cardmarket_id, cents);
    else if (out.get(row.cardmarket_id) !== cents) out.set(row.cardmarket_id, null);
  }
  return out;
}
