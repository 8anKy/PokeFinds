/**
 * Rekommenderat pris (MSRP) och avvikelsen från det — ren modul, ingen DB.
 *
 * Två källor, i den ordningen:
 *   1. `Product.msrpOre` — per produkt, satt av ägaren (`scripts/set-msrp.ts`).
 *   2. `MSRP_DEFAULT_ORE[språk][kategori]` — ett tal per FORM (ETB, booster …) och språk,
 *      när produkten själv saknar ett. Tabellen nedan FYLLS AV ÄGAREN: ett rekommenderat
 *      pris är ett påstående om vad varan "ska" kosta, och ett påhittat sådant gör varje
 *      "🔴 +25 %" i kanalen till en lögn om butiken. Tom tabell ⇒ ingen jämförelse visas.
 *
 * ⛔ MSRP ÄR EN JÄMFÖRELSEPUNKT, INTE ETT PRIS: den rör aldrig rubrikpriset, "Lägst",
 *    prisstatistiken eller larmen. Bara Discord-inlägget (och senare kanske
 *    produktsidan) läser den.
 */
import type { ProductCategory } from "@prisma/client";

/** Kategoridefault i öre per språk. Tom = ägaren har inte satt något ännu. */
export const MSRP_DEFAULT_ORE: Partial<Record<"EN" | "JP", Partial<Record<ProductCategory, number>>>> = {
  EN: {},
  JP: {},
};

/** Produktens MSRP i öre: egen kolumn först, annars kategoridefault. null = okänt. */
export function resolveMsrpOre(p: {
  msrpOre: number | null | undefined;
  category: ProductCategory;
  language: string | null | undefined;
}): number | null {
  if (typeof p.msrpOre === "number" && p.msrpOre > 0) return p.msrpOre;
  const lang = (p.language ?? "EN").toUpperCase() === "JP" ? "JP" : "EN";
  const v = MSRP_DEFAULT_ORE[lang]?.[p.category];
  return typeof v === "number" && v > 0 ? v : null;
}

export interface MsrpDelta {
  msrpOre: number;
  /** Butikens pris − MSRP, i öre. Negativt = under rek. pris. */
  diffOre: number;
  /** Avvikelse i procent av MSRP. */
  percent: number;
  /** "good" = på eller under rek. pris, "bad" = över. */
  verdict: "good" | "bad";
}

/**
 * Avvikelsen mellan butikens pris och rek. pris. null när något av talen saknas
 * eller inte är ett riktigt pris (0 kr är inget pris — och en nolla i nämnaren hade
 * gett "Infinity %" i en publik kanal).
 */
export function msrpDelta(priceOre: number | null | undefined, msrpOre: number | null | undefined): MsrpDelta | null {
  if (priceOre == null || msrpOre == null || priceOre <= 0 || msrpOre <= 0) return null;
  const diffOre = priceOre - msrpOre;
  return {
    msrpOre,
    diffOre,
    percent: (diffOre / msrpOre) * 100,
    verdict: diffOre <= 0 ? "good" : "bad",
  };
}
