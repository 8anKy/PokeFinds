/**
 * Adminpanelens diagrampalett.
 *
 * ⛔ VALIDERAD, INTE VALD PÅ KÄNSLA. Kontrollerad mot ren svart yta (#000000)
 * med de sex standardkontrollerna (ljushetsband, kromagolv, färgblindhets-
 * separation, normalseendegolv, kontrast):
 *
 *   #13a99b, #8b5cf6, #c2820a, #d4488a  →  samtliga PASS
 *   sämsta granne (deutan) ΔE 14,2 · sämsta granne (normalt seende) ΔE 21,3
 *
 * ⛔ VARFÖR INTE `holo.cyan` (#2dd4bf) SOM FÖRSTA FÄRG: turkos i den ljusstyrkan
 * ligger på OKLCH L≈0,79 och faller utanför bandet 0,48–0,67 tillsammans med
 * violett/guld/rosa — serierna blir då jämnljusa och skiljs bara på kulör, vilket
 * är precis det en färgblind läsare inte kan. #13a99b är den ljusaste turkos som
 * klarar bandet och läser fortfarande som Foilios färgfamilj. Prisgrafen på
 * produktsidan behåller varumärkesturkosen: den har ETT dataspår och alltså
 * ingen separationsfråga att lösa.
 *
 * ⛔ FÄRG FÖLJER ENTITETEN, ALDRIG ORDNINGEN. Slå upp via `seriesColor(key)` —
 * plockar man färg på index målas de kvarvarande serierna om så fort en serie
 * filtreras bort, och grafen ljuger mellan två klick.
 */

/** Fast kuloridning. En nionde serie får ALDRIG en genererad färg — slå ihop till "Övrigt". */
export const CATEGORICAL = ["#13a99b", "#8b5cf6", "#c2820a", "#d4488a"] as const;

/** Enfärgade diagram (en serie) — varumärkets turkos, samma som prisgrafen. */
export const SINGLE = "#2dd4bf";

/** Recessivt rutnät och axlar. Samma värden som prisgrafen. */
export const GRID = "#26262b";
export const TICK = "#8a8a93";
/** Ytan bakom grafen — används till 2px-mellanrum mellan staplade segment. */
export const SURFACE = "#000000";

/**
 * Händelsetyperna i `AnalyticsEvent`, i fast ordning med fast färg.
 * ⛔ Nyckeln är databasens `eventType` — döps den om i skrivvägen tappar serien
 * sin färg tyst. Okänd typ faller tillbaka på grått, aldrig på en granne.
 */
export const EVENT_SERIES = [
  { key: "product_view", label: "Produktvy", color: CATEGORICAL[0] },
  { key: "list_click", label: "Listklick", color: CATEGORICAL[1] },
  { key: "retailer_click", label: "Butiksklick", color: CATEGORICAL[2] },
  { key: "search_click", label: "Sökklick", color: CATEGORICAL[3] },
  { key: "watchlist_add", label: "Bevakning lagd", color: "#6b7280" },
] as const;

export type EventKey = (typeof EVENT_SERIES)[number]["key"];

/** Färgen för en känd serienyckel; grått för allt vi inte har en plats åt. */
export function seriesColor(key: string): string {
  return EVENT_SERIES.find((s) => s.key === key)?.color ?? "#6b7280";
}

export function seriesLabel(key: string): string {
  return EVENT_SERIES.find((s) => s.key === key)?.label ?? key;
}
