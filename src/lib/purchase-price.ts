/**
 * Inköpspris skrivs i KRONOR i UI:t men lagras i ÖRE (heltal) — aldrig float.
 *
 * Tre utfall, inte två: BLANKT är inte 0. 0 öre betyder "köpt gratis" (giltigt
 * svar), blankt betyder "vet inte" → fältet ska utelämnas helt ur POST:en.
 * Slår man ihop dem hamnar en påhittad kostnadsbas i vinstberäkningen.
 */
export type PurchasePriceParse =
  | { kind: "empty" }
  | { kind: "ok"; ore: number }
  | { kind: "invalid" };

/**
 * `CollectionItem.purchasePrice` är Prisma `Int` = Postgres int4. En felskrivning
 * ("999999999999") hade blivit ett 500 från databasen i stället för ett fältfel,
 * så taket sitter här: 20 000 000 kr, med god marginal under int4-taket.
 */
const MAX_ORE = 2_000_000_000;

export function parseKronorToOre(raw: string): PurchasePriceParse {
  const trimmed = raw.trim();
  if (!trimmed) return { kind: "empty" };

  const normalized = trimmed
    // Tusentalsavskiljare från klistrat innehåll: formatPrice() ger vanligt
    // mellanslag, NBSP eller smalt NBSP beroende på plattformens ICU-data.
    .replace(/[\s\u00a0\u202f]/g, "")
    .replace(/(kr|sek)$/i, "")
    // Svenska tangentbord ger KOMMA som decimaltecken; punkt accepteras också.
    .replace(",", ".");

  // Minustecken matchar inte mönstret → negativa priser faller ut som ogiltiga,
  // inte som 0. Högst två decimaler: mer precision än ett öre finns inte.
  if (!/^\d*(\.\d{0,2})?$/.test(normalized)) return { kind: "invalid" };

  const kronor = Number(normalized);
  // "." ensamt ger NaN och fångas här.
  if (!Number.isFinite(kronor)) return { kind: "invalid" };

  const ore = Math.round(kronor * 100);
  if (ore > MAX_ORE) return { kind: "invalid" };
  return { kind: "ok", ore };
}
