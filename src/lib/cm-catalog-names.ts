/**
 * RapidAPI-radens SAKNADE `cardmarket_id`, återfunnet ur Cardmarkets EGEN katalog
 * på exakt namn.
 *
 * VARFÖR. Ett helt nytt set finns hos Cardmarket månader före release — Delta Reign
 * lades till CM 2026-08-20 med fullt tilldelade `idProduct` (18 produkter, expansion
 * 6704) för ett släpp 2026-11-06. RapidAPI publicerar SAMMA produkter, med samma
 * namn och samma episod, men med `cardmarket_id: null` tills leverantören hinner
 * mappa dem. Under det glappet är setet OSYNLIGT för hela katalogflödet:
 *
 *   • `import-sealed-from-cardmarket.ts` skapar då en produkt UTAN CM-offer (ingen
 *     länk, inget pris) — eller hoppar över den helt i RECENT_DAYS-läget, som är
 *     hur automationen kör.
 *   • Gratis-katalog-fallbacken kräver att expansionen redan innehåller en
 *     EN-produkt vi äger ("syskon-expansionsregeln") — ett HELT NYTT set har per
 *     definition ingen sådan, så alla 18 föll på `skippedNoSibling`.
 *   • `cardmarket-refresh` gör `if (best.cardmarket_id == null) continue` → varken
 *     pris eller set-etikett, så butikernas förhandsboxar stod set-lösa.
 *
 * Mätt 2026-09-05: 0 av 18 Delta Reign-produkter kunde nå katalogen på någon väg,
 * medan svenska butiker redan sålde 13 av dem. Det är exakt det läge folk bevakar.
 *
 * ⛔ NYCKELN ÄR EXAKT NAMN, INTE FUZZY. Båda listorna är Cardmarkets egna
 * katalognamn — ingen butikstitel är inblandad, så det finns inget att gissa. Ett
 * namn som förekommer på FLERA idProduct kastas (`null`-markeringen nedan) i
 * stället för att gissa: mätt över hela nonsingles-katalogen är det 4 namn av
 * 5 044, dvs vakten kostar nästan ingenting och tar bort hela gissningsytan.
 *
 * ⛔ EN RAD FÅR ALDRIG KAPA EN ANNAN RADS ID. Bär någon rad redan `cardmarket_id`
 * X är X upptaget — annars kunde två av våra katalogprodukter äga samma CM-produkt
 * och en av dem visa en FRÄMMANDE prisgraf (samma fälla som unikhetsvakten i
 * cardmarket-refreshens fuzzy-gren).
 */

/** Jämförelsenyckel: bara skiftläge och blanktecken normaliseras — aldrig ord. */
export function cmCatalogNameKey(name: string): string {
  return name.normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * namnnyckel → idProduct ur CM:s nonsingles-katalog. Tvetydiga namn utelämnas.
 */
export function buildCmIdByName(products: { idProduct: number; name: string }[]): Map<string, number> {
  // `null` = namnet sågs mer än en gång → tvetydigt, aldrig användbart.
  const seen = new Map<string, number | null>();
  for (const p of products) {
    const key = cmCatalogNameKey(p.name ?? "");
    if (!key) continue;
    seen.set(key, seen.has(key) ? null : p.idProduct);
  }
  const out = new Map<string, number>();
  for (const [key, id] of seen) if (id != null) out.set(key, id);
  return out;
}

/**
 * Fyller i `cardmarket_id` på RapidAPI-rader som saknar den. Muterar raderna med
 * flit: allt nedströms (apiByCmId, ownedCmIds, fuzzy-matchningen, offer-URL:en)
 * läser samma fält och behöver då inte ändras alls.
 */
export function backfillCardmarketIds(
  rows: { name?: string | null; cardmarket_id: number | null }[],
  idByName: Map<string, number>
): { filled: number; skippedTaken: number } {
  const taken = new Set<number>();
  for (const r of rows) if (r.cardmarket_id != null) taken.add(r.cardmarket_id);
  let filled = 0;
  let skippedTaken = 0;
  for (const r of rows) {
    if (r.cardmarket_id != null) continue;
    const id = idByName.get(cmCatalogNameKey(r.name ?? ""));
    if (id == null) continue;
    if (taken.has(id)) { skippedTaken++; continue; }
    r.cardmarket_id = id;
    taken.add(id);
    filled++;
  }
  return { filled, skippedTaken };
}
