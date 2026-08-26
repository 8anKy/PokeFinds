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
  return pausableFeatures(base, [{ items: restock, paused }]);
}

/**
 * SAMMA MEKANIK FÖR FLERA PAUSBARA GRUPPER.
 *
 * Prislarmen pausades 2026-08-26 (tre olagade defekter, se `price-alerts-pause.ts`) och
 * hamnade i exakt samma sits som restock-larmen fyra dagar tidigare: en Pro-punkt som
 * säljer en avstängd funktion. Två grupper med varsin flagga i stället för en
 * hopslagen "larm"-flagga — restock väntar på KOSTNAD, prislarm på en LAGNING, och de
 * kommer tillbaka vid olika tillfällen.
 *
 * Grupperna läggs in EFTER första punkten, i den ordning de skickas in — så listan
 * läser likadant som före pauserna när båda flaggorna är av.
 */
export function pausableFeatures(
  base: readonly string[],
  groups: readonly { items: readonly string[]; paused: boolean }[]
): string[] {
  const extras = groups.filter((g) => !g.paused).flatMap((g) => [...g.items]);
  if (extras.length === 0) return [...base];
  // Tom baslista: lägg de pausbara punkterna först i stället för att tappa dem.
  if (base.length === 0) return extras;
  return [base[0], ...extras, ...base.slice(1)];
}
