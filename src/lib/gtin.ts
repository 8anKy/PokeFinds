/**
 * GTIN — tillverkarens streckkod som EXAKT cross-store-nyckel.
 *
 * Bakgrund (mätt 2026-07-13): 5 av 7 butiker publicerar tillverkarens streckkod
 * maskinläsbart. GS1-prefix `196214` = The Pokémon Company International,
 * `4521329…` = Pokémon Japan. Det är samma nummer som står tryckt på asken i
 * VARJE butik i världen — alltså den delade identifierare katalogen saknat.
 *
 * Detta är INTE samma sak som butikernas artikelnummer/SKU eller MPN (POK…-101).
 * De är döda spår (mätt: 14 av 1656 SKU:er delas mellan butiker; MaxGaming hittar
 * på egna MPN som "POK-AB-EYE-BB"). Blanda ALDRIG ihop dem.
 *
 * NORMALISERING ÄR INTE VALFRI. Samma vara skrivs olika i olika feeds:
 *   Alphaspel  "196214135017"  OCH  "0196214135017"
 *   Webhallen  ["0820650809439", "820650809439"]   ← samma kod, två kodningar
 *   MaxGaming  nyckeln heter `gtin8` men värdena är 12–13 siffror
 * En rå strängjämförelse delar alltså identiska produkter. Allt vänsterpaddas till
 * GTIN-14 och checksiffran verifieras innan något jämförs eller sparas.
 */

/** Alla giltiga GTIN-längder (GTIN-8/12/13/14). Allt annat är skräp. */
const VALID_LENGTHS = new Set([8, 12, 13, 14]);

/**
 * GS1 mod-10-checksiffra. Vikterna alternerar 3,1 räknat från siffran längst till
 * HÖGER i kroppen (dvs oberoende av total längd) — därför funkar samma kod för
 * GTIN-8/12/13/14.
 */
export function isValidGtinChecksum(digits: string): boolean {
  if (!/^\d+$/.test(digits) || !VALID_LENGTHS.has(digits.length)) return false;
  const body = digits.slice(0, -1);
  const check = Number(digits[digits.length - 1]);
  let sum = 0;
  for (let i = body.length - 1, weight = 3; i >= 0; i--, weight = weight === 3 ? 1 : 3) {
    sum += Number(body[i]) * weight;
  }
  return (10 - (sum % 10)) % 10 === check;
}

/**
 * Normaliserar en rå streckkod från en butiksfeed till kanonisk GTIN-14.
 *
 * Tar emot sträng, sträng-array (Webhallens `eans[]`) eller null. Returnerar null
 * för allt som inte är en verifierbar GTIN — inklusive butikernas påhittade MPN
 * ("POK-AB-EYE-BB"), tomma strängar och koder med fel checksiffra (tryckfel i
 * butikens produktdata ska ALDRIG bli en katalognyckel).
 *
 * Vi länge-validerar medvetet INTE mot fältnamnet: MaxGaming kallar sitt fält
 * `gtin8` men skickar 12–13 siffror. En 8-siffrig kontroll hade kastat 100% av
 * deras data.
 */
export function normalizeGtin(raw: string | string[] | number | null | undefined): string | null {
  if (raw == null) return null;
  // Webhallen skickar en array med samma kod i flera kodningar → ta första giltiga.
  if (Array.isArray(raw)) {
    for (const candidate of raw) {
      const hit = normalizeGtin(candidate);
      if (hit) return hit;
    }
    return null;
  }
  const digits = String(raw).replace(/\D/g, "");
  if (!digits) return null;
  // Kortare än GTIN-8 eller längre än GTIN-14 = inte en streckkod (butiks-id, årtal…).
  if (digits.length < 8 || digits.length > 14) return null;
  // Vissa feeds nollpaddar redan (0196214135017 = 13 siffror), andra inte. Zooma in på
  // den faktiska koden genom att strippa ledande nollor, och verifiera checksiffran mot
  // den giltiga längd koden faktiskt har.
  const trimmed = digits.replace(/^0+/, "");
  for (const len of [8, 12, 13, 14]) {
    if (trimmed.length > len) continue;
    const padded = trimmed.padStart(len, "0");
    if (isValidGtinChecksum(padded)) return padded.padStart(14, "0");
  }
  return null;
}

/**
 * Två normaliserade GTIN pekar på samma tillverkar-SKU.
 * Båda MÅSTE vara normaliserade (GTIN-14) — jämför aldrig råa feed-värden.
 */
export function sameGtin(a: string | null | undefined, b: string | null | undefined): boolean {
  return !!a && !!b && a === b;
}

/**
 * SANN bara när båda sidor HAR en kod och de skiljer sig åt — dvs bevisat olika
 * tillverkar-SKU:er. Saknad kod betyder INGENTING (Samlarhobby skickar null,
 * Swepoke inget alls, DL:s äldre sortiment saknar) och får aldrig tolkas som
 * "olika produkt".
 *
 * Detta är den vakt som skiljer påse från display:
 *   4521329432267 = Nihil Zero Booster (påse)
 *   4521329432274 = Nihil Zero Booster Display (box)
 * Ett ord isär i titeln — två skilda streckkoder.
 */
export function gtinConflict(a: string | null | undefined, b: string | null | undefined): boolean {
  return !!a && !!b && a !== b;
}

/**
 * Kända GS1-prefix för Pokémon-TILLVERKARE: TPCi (196214, äldre 820650) och
 * Pokémon Japan (4521329). Detta är NUMRET tryckt på asken av tillverkaren.
 */
const POKEMON_GS1_PREFIXES = ["196214", "4521329", "820650"];

/**
 * SANT om koden bär ett Pokémon-TILLVERKARprefix — dvs den är produktidentitet.
 * Svenska distributör-EAN (73xxxxx, t.ex. Amo Toys 7340136 / 7300003) och andra
 * ompaketeringskoder är INTE tillverkarens identitet och ska aldrig ensamt driva
 * en länk-KONFLIKT (två butiker kan bära olika distributör-EAN för samma vara).
 * Koden måste vara normaliserad (GTIN-14). Används av konfliktdetektorn, INTE av
 * lagringen — vi kastar aldrig en giltig kod, vi räknar bara inte distributörskoder
 * som bevis på fel länk. Se src/services/gtin-conflicts.ts.
 */
export function isPokemonManufacturerGtin(gtin: string | null | undefined): boolean {
  if (!gtin) return false;
  const trimmed = gtin.replace(/^0+/, "");
  return POKEMON_GS1_PREFIXES.some((p) => trimmed.startsWith(p));
}

/** Visningsform (utan ledande nollor) för admin/loggar. Aldrig för jämförelse. */
export function formatGtin(gtin: string | null | undefined): string | null {
  if (!gtin) return null;
  return gtin.replace(/^0+/, "") || null;
}
