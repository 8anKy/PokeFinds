/**
 * VAD EN AI-FUNKTION KOSTAR — EN PRISLISTA, INTE EN GISSNING (2026-08-14).
 *
 * Admin-panelen visar hur mycket varje användare kostar per funktion. Talet får
 * bara komma från två saker: leverantörens PUBLICERADE pris per miljon tokens och
 * det VERKLIGA tokentalet som API:t rapporterade för just det anropet. Ingen
 * schablon per skanning, ingen uppskattning ur ett medelvärde — samma regel som
 * gäller kortpriserna i övriga appen (inga fabricerade siffror).
 *
 * ⛔ **ETT SAKNAT TOKENTAL ÄR INTE NOLL KRONOR.** `costMicroUsd()` returnerar
 *    `null` när modellen är okänd eller tokentalen saknas, och anroparen räknar
 *    raden som OMÄTT i stället för gratis. Historiska rader (före 2026-08-14)
 *    bär inga tokental alls; en nolla där hade fått en tung användare att se
 *    gratis ut, vilket är precis fel håll för en kostnadsvy. Samma familj som
 *    "0 kr är inget pris" i exchange-rate.ts.
 *
 * ⛔ **PRISERNA ÄR FÄRSKVARA.** De står här som konstanter med datum, och de
 *    ändras när leverantören ändrar sin prislista — inte när någon gissar.
 *    `AI_PRICE_OVERRIDES` (env, JSON) finns för att kunna rätta ett pris i drift
 *    utan deploy; utan den hade en prisändring krävt en release för att sluta
 *    ljuga.
 *
 * ⛔ **MODELLNAMNET MÅSTE FÖLJA MED IN I DATABASEN.** Kostnaden räknas i
 *    efterhand ur sparade rader, så en rad som bara bär tokental kan inte
 *    prissättas — vi vet inte vilken modell som kördes. Därför skriver både
 *    skannern och graderingen `model` bredvid `usage`.
 */

/** Pris per miljon tokens, i US-dollar. */
export interface ModelPrice {
  /** USD per 1 000 000 input-tokens. */
  inputPerMTok: number;
  /** USD per 1 000 000 output-tokens. */
  outputPerMTok: number;
}

/**
 * Publicerade listpriser per miljon tokens (USD), avlästa 2026-08-14.
 *
 * Nycklarna är modell-id:n EXAKT som de skrivs i env/koden
 * (`SCANNER_MODEL`, `GRADING_MODEL_*`), eftersom det är den strängen som
 * hamnar i `ScannerJob.result.model` / `GradingJob.modelUsed`.
 *
 * ⚠️ Sonnet 5 har ett introduktionspris ($2/$10) t.o.m. 2026-08-31. Här står
 * ORDINARIE pris med flit: en kostnadsvy ska hellre överskatta än underskatta,
 * och intropriset försvinner om två veckor. Vill man mäta det faktiska utfallet
 * under intro-perioden: sätt `AI_PRICE_OVERRIDES`.
 */
export const MODEL_PRICES: Record<string, ModelPrice> = {
  // Anthropic (platform.claude.com/docs/en/pricing)
  "claude-haiku-4-5": { inputPerMTok: 1, outputPerMTok: 5 },
  "claude-haiku-4-5-20251001": { inputPerMTok: 1, outputPerMTok: 5 },
  "claude-sonnet-4-6": { inputPerMTok: 3, outputPerMTok: 15 },
  "claude-sonnet-5": { inputPerMTok: 3, outputPerMTok: 15 },
  "claude-opus-5": { inputPerMTok: 5, outputPerMTok: 25 },
  "claude-opus-4-8": { inputPerMTok: 5, outputPerMTok: 25 },

  // Google (Gemini) — samma tal som står i CLAUDE.md:s graderingsavsnitt.
  "gemini-3.1-flash-lite": { inputPerMTok: 0.25, outputPerMTok: 1.5 },
  "gemini-3.6-flash": { inputPerMTok: 1.5, outputPerMTok: 7.5 },
  // 3.5 = samma inpris som 3.6, 25 % DYRARE utpris (3.6 är "20 % billigare").
  // Härlett, inte avläst — därför kommentaren. 3.5 är strikt dominerad av 3.6
  // och ska inte användas; posten finns bara så gamla rader går att prissätta.
  "gemini-3.5-flash": { inputPerMTok: 1.5, outputPerMTok: 9.375 },
};

/**
 * `AI_PRICE_OVERRIDES` = JSON, t.ex.
 *   {"claude-sonnet-5":{"inputPerMTok":2,"outputPerMTok":10}}
 * Nödventil för prisändringar mellan deployer. Trasig JSON ignoreras tyst —
 * en felskriven env-variabel får inte sänka admin-panelen.
 */
let overridesCache: Record<string, ModelPrice> | null = null;

function priceOverrides(): Record<string, ModelPrice> {
  if (overridesCache) return overridesCache;
  const raw = process.env.AI_PRICE_OVERRIDES;
  if (!raw) {
    overridesCache = {};
    return overridesCache;
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, Partial<ModelPrice>>;
    const out: Record<string, ModelPrice> = {};
    for (const [model, p] of Object.entries(parsed)) {
      if (
        typeof p?.inputPerMTok === "number" &&
        typeof p?.outputPerMTok === "number" &&
        p.inputPerMTok >= 0 &&
        p.outputPerMTok >= 0
      ) {
        out[model] = { inputPerMTok: p.inputPerMTok, outputPerMTok: p.outputPerMTok };
      }
    }
    overridesCache = out;
  } catch {
    overridesCache = {};
  }
  return overridesCache;
}

/** Bara för tester — nollställer den lata env-cachen. */
export function resetPriceOverridesCache(): void {
  overridesCache = null;
}

/**
 * Prislistan för en modell, eller `null` om vi inte känner modellen.
 *
 * Exakt träff först, sedan en PREFIX-match: leverantörerna lägger till
 * datumsuffix (`claude-haiku-4-5-20251001`) och vi vill inte tappa priset varje
 * gång en snapshot-variant dyker upp. Prefixet måste vara ≥ 8 tecken så en kort
 * sträng inte råkar matcha allt.
 */
export function priceForModel(model: string | null | undefined): ModelPrice | null {
  if (!model) return null;
  const key = model.trim();
  if (!key) return null;
  const table = { ...MODEL_PRICES, ...priceOverrides() };
  if (table[key]) return table[key];
  let best: { id: string; price: ModelPrice } | null = null;
  for (const [id, price] of Object.entries(table)) {
    if (id.length >= 8 && key.startsWith(id)) {
      if (!best || id.length > best.id.length) best = { id, price };
    }
  }
  return best?.price ?? null;
}

/** Tokental från ett API-anrop. Båda fälten kommer från leverantörens `usage`. */
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

/**
 * Kostnaden för ETT anrop, i MIKRO-DOLLAR (en miljondels dollar).
 *
 * Heltal med flit: ett enskilt Haiku-anrop kostar ~2 300 µ$ (0,0023 $), så
 * dollar som flyttal hade tappat precision så fort man summerar tusentals rader.
 * Samma skäl som priser i öre i resten av appen.
 *
 * `null` = vi vet inte (okänd modell eller inga tokental). Aldrig 0.
 */
export function costMicroUsd(
  model: string | null | undefined,
  usage: Partial<TokenUsage> | null | undefined
): number | null {
  const price = priceForModel(model);
  if (!price) return null;
  const input = usage?.inputTokens;
  const output = usage?.outputTokens;
  if (typeof input !== "number" || typeof output !== "number") return null;
  if (!Number.isFinite(input) || !Number.isFinite(output)) return null;
  if (input < 0 || output < 0) return null;
  const usd = (input / 1_000_000) * price.inputPerMTok + (output / 1_000_000) * price.outputPerMTok;
  return Math.round(usd * 1_000_000);
}

/**
 * Mikro-dollar → öre, via samma live-kurs som resten av appen
 * (`getCachedRatesOre().usdToOre`). Avrundas till hela öre; ett belopp under ett
 * halvt öre blir 0, vilket ÄR rätt här (till skillnad från ett marknadspris är
 * "kostade i princip ingenting" ett sant och användbart svar).
 */
export function microUsdToOre(microUsd: number, usdToOre: number): number {
  return Math.round((microUsd / 1_000_000) * usdToOre);
}
