/**
 * Vad prissidan och paywall-arket visar, givet vilka larm som är igång.
 *
 * ⛔ EGEN MODUL SÅ DEN GÅR ATT TESTA. Logiken satt först inline i
 * `priser/page.tsx`, och den halva som spelar mest roll — att raderna KOMMER
 * TILLBAKA när larmen slås på — går inte att asserta på en serverkomponent utan
 * att bygga om appen. Pausen 2026-08-23 visade varför det inte räcker att
 * radera copyn: två kunder hann köpa Pro medan paywallen sålde restock-larm som
 * var avstängda, och en engångsstädning hade gjort Pro permanent fattigare utan
 * att någon märkte det.
 *
 * Sedan 2026-09-05 är innehållet ett SPEC-BLAD (`SpecRow`: förmån, Free-värde,
 * Pro-värde) i stället för två punktlistor — samma mekanik, generisk över
 * radtypen. De pausbara raderna läggs in EFTER första raden (bevakningsraden), i
 * den ordning grupperna skickas in, så bladet läser likadant som före pauserna.
 */
export interface SpecRow {
  /** Förmånen, som användaren läser den. */
  label: string;
  /** Free-kolumnen: ett tal, ett kort ord, `SPEC_YES` eller `SPEC_NO`. */
  free: string;
  /** Pro-kolumnen, samma former. */
  pro: string;
}

/** Värden som tabellen ritar som bock respektive tankstreck i stället för text. */
export const SPEC_YES = "✓";
export const SPEC_NO = "—";

export function withRestockFeatures<T>(
  base: readonly T[],
  restock: readonly T[],
  paused: boolean
): T[] {
  return pausableFeatures(base, [{ items: restock, paused }]);
}

/**
 * SAMMA MEKANIK FÖR FLERA PAUSBARA GRUPPER.
 *
 * Prislarmen pausades 2026-08-26 (tre olagade defekter, se `price-alerts-pause.ts`) och
 * hamnade i exakt samma sits som restock-larmen fyra dagar tidigare: en Pro-rad som
 * säljer en avstängd funktion. Två grupper med varsin flagga i stället för en
 * hopslagen "larm"-flagga — restock väntar på KOSTNAD, prislarm på en LAGNING, och de
 * kommer tillbaka vid olika tillfällen.
 */
export function pausableFeatures<T>(
  base: readonly T[],
  groups: readonly { items: readonly T[]; paused: boolean }[]
): T[] {
  const extras = groups.filter((g) => !g.paused).flatMap((g) => [...g.items]);
  if (extras.length === 0) return [...base];
  // Tom baslista: lägg de pausbara raderna först i stället för att tappa dem.
  if (base.length === 0) return extras;
  return [base[0], ...extras, ...base.slice(1)];
}

/** Raderna där Pro skiljer sig från Free — det paywall-arket säljer på. */
export function proOnlyRows(rows: readonly SpecRow[]): SpecRow[] {
  return rows.filter((r) => r.free !== r.pro);
}
