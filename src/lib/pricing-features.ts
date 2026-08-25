/**
 * Vilka punkter prissidan visar, givet om restock-larmen är igång.
 *
 * ⛔ EGEN MODUL SÅ DEN GÅR ATT TESTA. Logiken satt först inline i
 * `priser/page.tsx`, och den halva som spelar mest roll — att punkterna KOMMER
 * TILLBAKA när larmen slås på — går inte att asserta på en serverkomponent utan
 * att bygga om appen. Pausen 2026-08-23 visade varför det inte räcker att
 * radera copyn: två kunder hann köpa Pro medan paywallen sålde restock-larm som
 * var avstängda, och en engångsstädning hade gjort Pro permanent fattigare utan
 * att någon märkte det.
 *
 * Restock-punkterna läggs in EFTER första punkten — samma ordning som listan
 * hade före pausen (bevakningspunkten först, sedan de tre restock-punkterna).
 */
export function withRestockFeatures(
  base: readonly string[],
  restock: readonly string[],
  paused: boolean
): string[] {
  if (paused) return [...base];
  // Tom baslista: lägg restock-punkterna först i stället för att tappa dem.
  if (base.length === 0) return [...restock];
  return [base[0], ...restock, ...base.slice(1)];
}
