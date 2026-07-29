/**
 * Bygger frågesträngen till /api/products/count för det filterurval man håller på att
 * göra i mobilens filter-sheets.
 *
 * TVÅ ÖVERSÄTTNINGAR SKER HÄR, och båda tystnar om de görs fel:
 *  1. URL:ens parameternamn är svenska (`kategori`, `butik`, `sprak`) medan API:t —
 *     samma som feeden läser — använder engelska (`category`, `retailerId`, `language`).
 *     Ett feldöpt fält ignoreras tyst av zod-schemat och antalet blir "alla produkter".
 *  2. Priser står i KRONOR i URL:en men lagras i ÖRE. Skickas kronor rakt igenom
 *     räknas ett hundra gånger för snävt intervall — och siffran ser rimlig ut.
 */
export interface CountSelection {
  q?: string;
  kategori?: string;
  set?: string;
  butik?: string;
  sprak?: string;
  lager?: string;
  /** Applicerat prisintervall ur URL:en (kronor). */
  minPris?: string;
  maxPris?: string;
  /** Pågående val i prissheeten (kronor) — vinner över URL-värdet. */
  minKr?: number;
  maxKr?: number | null;
}

export function countQuery(sel: CountSelection): string {
  const s = new URLSearchParams();
  if (sel.q) s.set("query", sel.q);
  if (sel.kategori) s.set("category", sel.kategori);
  if (sel.set) s.set("setId", sel.set);
  if (sel.butik) s.set("retailerId", sel.butik);
  if (sel.sprak) s.set("language", sel.sprak);
  if (sel.lager === "1") s.set("stockStatus", "IN_STOCK");

  const min = sel.minKr ?? (sel.minPris ? Number(sel.minPris) : 0);
  const max = sel.maxKr !== undefined ? sel.maxKr : sel.maxPris ? Number(sel.maxPris) : null;
  if (Number.isFinite(min) && min > 0) s.set("minPrice", String(Math.round(min * 100)));
  if (max != null && Number.isFinite(max)) s.set("maxPrice", String(Math.round(max * 100)));
  return s.toString();
}
