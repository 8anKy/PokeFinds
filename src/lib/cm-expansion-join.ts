/**
 * CM-EXPANSION → VÅRT SET — joinen som etiketterar guide-fallback-produkter.
 *
 * En produkt som prissätts ur CM:s publika guide (finns inte i RapidAPI) har
 * ändå en exakt expansionstillhörighet i CM:s egen katalog. Men expansionen
 * ensam duger INTE som etikett, för CM har CONTAINER-expansioner: nr 1645
 * rymmer 1 094 tins/boxar från tjugo år ("2009 Spring Collector's Tins" bredvid
 * "Hidden Potential Tins"). MÄTT 2026-08-09: en enda felmärkt produkt i 1645
 * ("Galar Partners Tin: Rillaboom V Tin" med setId=Mega Evolution) gjorde
 * "enhällighet" sann och hade etiketterat 300 produkter fel.
 *
 * Därför TVÅ oberoende krav, båda på våra egna redan etiketterade produkter:
 *   1. ENHÄLLIGHET — expansionens etiketterade medlemmar pekar på ETT set.
 *   2. DUBBELRIKTAT — ALLA det setets CM-länkade produkter bor i just den
 *      expansionen. En container klarar aldrig det: det riktiga setets
 *      produkter bor i sin egen expansion, inte i containern.
 * Ett äkta par (30th Celebration ↔ exp 6601) klarar båda trivialt. Hellre en
 * oetiketterad produkt än en fel-etiketterad — samma regel som all matchning.
 */
export function expansionSetJoin(
  rows: Iterable<{ setId: string | null; idProduct: number | null }>,
  expByIdProduct: Map<number, number>
): Map<number, string> {
  const expVotes = new Map<number, Map<string, number>>();
  const setTotals = new Map<string, number>();
  const setInExp = new Map<string, Map<number, number>>();

  for (const r of rows) {
    if (!r.setId || r.idProduct == null) continue;
    const exp = expByIdProduct.get(r.idProduct);
    if (exp == null) continue;
    if (!expVotes.has(exp)) expVotes.set(exp, new Map());
    const ev = expVotes.get(exp)!;
    ev.set(r.setId, (ev.get(r.setId) ?? 0) + 1);
    setTotals.set(r.setId, (setTotals.get(r.setId) ?? 0) + 1);
    if (!setInExp.has(r.setId)) setInExp.set(r.setId, new Map());
    const se = setInExp.get(r.setId)!;
    se.set(exp, (se.get(exp) ?? 0) + 1);
  }

  const out = new Map<number, string>();
  for (const [exp, votes] of expVotes) {
    if (votes.size !== 1) continue; // krav 1: enhällighet
    const setId = [...votes.keys()][0];
    // krav 2: dubbelriktat — hela setet bor i expansionen
    if ((setInExp.get(setId)?.get(exp) ?? 0) !== (setTotals.get(setId) ?? 0)) continue;
    out.set(exp, setId);
  }
  return out;
}
