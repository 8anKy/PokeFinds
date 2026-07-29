import { z } from "zod";

/**
 * Kommaseparerad lista → array. Katalogens "Fler filter" är flerval, så
 * kategori/butik/språk kan komma som `category=ETB,BOOSTER_BOX`. Okända värden
 * KASTAS (inte fel): en gammal bokmärkt URL med en borttagen butik ska ge en katalog
 * utan det filtret, inte ett 400.
 *
 * Delas av /api/products/feed och /api/products/count — de MÅSTE tolka samma
 * frågesträng likadant, annars visar knappen ett annat antal än feeden levererar.
 */
export function csvEnum<T extends Record<string, string>>(e: T) {
  const valid = new Set(Object.values(e));
  return z
    .string()
    .optional()
    .transform((s) =>
      s
        ? (s.split(",").map((v) => v.trim()).filter((v) => valid.has(v)) as T[keyof T][])
        : undefined
    )
    .transform((list) => (list && list.length > 0 ? list : undefined));
}

export const csvString = z
  .string()
  .optional()
  .transform((s) => {
    const list = s ? s.split(",").map((v) => v.trim()).filter(Boolean) : [];
    return list.length > 0 ? list : undefined;
  });
