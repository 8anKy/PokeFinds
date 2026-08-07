/**
 * JAPANSKA SET — namnet kommer från CARDMARKET, datumet från TCGdex.
 *
 * BAKGRUNDEN. Katalogens set kommer från pokemontcg.io, som bara har ENGELSKA
 * set. Våra japanska sealed-produkter (mätt 2026-08-07: 100 st, alla sealed) hade
 * därför `setId = null` allihop, och japanska set gick inte att filtrera på — de
 * fanns inte i databasen. TCGGO/RapidAPI stänger inte hålet: episodlistan är 175
 * västerländska expansioner och `?language=japanese` ignoreras tyst (samma svar).
 *
 * KÄLLAN VI REDAN HAR. Cardmarkets publika sealed-katalog
 * (`products_nonsingles_6.json`, hämtas dagligen av JP-prisrefreshen) grupperar
 * varje produkt i en `idExpansion` — 96 av våra 100 JP-produkter faller i 49
 * expansioner. Och CM namnger produkterna med expansionens namn i LATINSK skrift:
 * "Black Bolt JP Booster Box", "Mega Symphonia Booster", "Nihil Zero Booster".
 * Setnamnet är alltså HÄRLEDBART UR CM:S EGEN DATA — ingen titeltolkning av
 * butiksrubriker, ingen handskriven namnlista.
 *
 * ⛔ NAMNET FÅR INTE KOMMA FRÅN TCGdex. Deras japanska namn är dels japansk skrift
 *    (fel för en svensk butiksyta), dels mätbart FEL på minst ett set: `SV4a` är
 *    Shiny Treasure ex, men TCGdex kallar den "レイジングサーフ" (Raging Surf, som
 *    är SV3a) medan releaseDate 2023-12-01 är Shiny Treasures. Id och datum är
 *    alltså rätt och namnet fel i SAMMA rad. Vi använder därför bara datumet.
 */

/** CM-katalograd (delmängden vi behöver). */
export interface CmCatalogRow {
  name: string;
  categoryName: string;
}

/**
 * Formorden som står EFTER expansionsnamnet i CM:s produktnamn. "JP" står med i
 * listan därför att CM skriver "Black Bolt JP Booster Box" på nyare japanska
 * expansioner men inte på äldre — det hör till formen, inte till setet.
 */
const FORM_WORDS =
  /\s*(jp|japanese|korean|limited|deluxe|high\s*class|booster|box|case|pack|set|display|collection)\s*$/i;

/** "Black Bolt JP Deluxe Booster Box" → "Black Bolt". */
export function stripFormWords(name: string): string {
  let out = name.trim();
  // Formorden staplas ("... Booster Box Case") → skala av tills inget mer går.
  for (let i = 0; i < 8; i++) {
    const next = out.replace(FORM_WORDS, "").trim();
    if (next === out) break;
    out = next;
  }
  return out.replace(/[\s:/-]+$/, "").trim();
}

/** Längsta gemensamma prefix, skiftlägesokänsligt (behåller första radens skrivning). */
function longestCommonPrefix(names: string[]): string {
  if (names.length === 0) return "";
  let prefix = names[0];
  for (const n of names.slice(1)) {
    let i = 0;
    while (i < prefix.length && i < n.length && prefix[i].toLowerCase() === n[i].toLowerCase()) i++;
    prefix = prefix.slice(0, i);
  }
  return prefix.trim();
}

/**
 * Expansionens namn ur dess CM-produkter.
 *
 * ⛔ BARA Booster/Display-raderna. En expansion innehåller också mynt, pärmar och
 *    specialaskar med EGNA namn ("Pokémon Coin Collection Vol.5 Box" i Terastal
 *    Festival ex, "Mega Gallade ex Special Set" i Nihil Zero) — tas de med blir
 *    det gemensamma prefixet tomt och setet namnlöst. Booster- och display-raderna
 *    heter däremot alltid "<Expansion> [JP] Booster[ Box][ Case]".
 *
 * Returnerar null när inget namn går att härleda. Ett namnlöst set skapas ALDRIG.
 */
export function deriveJpSetName(rows: CmCatalogRow[]): string | null {
  const boosters = rows.filter((r) => /Booster|Display/i.test(r.categoryName));
  if (boosters.length === 0) return null;
  const names = boosters.map((r) => r.name);
  // Ensam rad har inget prefix att jämföra med — skala då formorden direkt.
  const base = names.length === 1 ? names[0] : longestCommonPrefix(names) || names[0];
  const derived = stripFormWords(base);
  return derived.length >= 2 ? derived : null;
}

/**
 * Setkoder som butikerna skriver ut i titeln ("… - sv6", "(s6K)", "SV11B"). Det är
 * TILLVERKARENS egen setidentitet, inte en gissning ur ett namn — samma sorts
 * explicita identifierare som GTIN, och därför tillåten där titelmatchning inte är.
 */
const CODE_IN_TITLE = /\b((?:sv|swsh|sm|xy|bw|s|m)\s?\d{1,2}[a-z]{0,2})\b/gi;

export function codesInTitle(title: string): string[] {
  return [...title.matchAll(CODE_IN_TITLE)].map((m) => m[1].replace(/\s+/g, "").toLowerCase());
}

/**
 * Expansioner vars butikstitlar ALDRIG bär en setkod (10 av 49 mätt 2026-08-07),
 * nyckeln är CM:s härledda namn. Koden här är ett FÖRSLAG som måste klara
 * datumprövningen nedan innan den används — den avgör bara sorteringsordningen
 * (releaseDate), aldrig namnet eller vilka produkter som hamnar i setet.
 */
export const JP_CODE_BY_NAME: Record<string, string> = {
  "silver lance": "s6h",
  "vmax climax": "s8b",
  "battle region": "s9a",
  "dark phantasma": "s10a",
  "incandescent arcana": "s11a",
  "scarlet ex": "sv1s",
  "violet ex": "sv1v",
  "inferno x": "m2",
  "abyss eye": "m5",
  // "25th Anniversary" saknas med flit: CM la in produkterna 118 dygn före
  // släppet, alltså utanför det mätta fönstret nedan. Setet får inget datum.
};

/**
 * MÄTT FÖNSTER mellan CM:s första `dateAdded` i expansionen och TCGdex releaseDate,
 * kalibrerat på de 39 expansioner vars kod står i butikstitlarna (alltså känd utan
 * datumresonemang): -6 till +71 dygn för de set CM la in före släppet.
 *
 * ⛔ Fönstret prövar ett FÖRSLAG, det söker inte fram en kandidat. Flera japanska
 *    set släpps samma dag (Snow Hazard och Clay Burst, Black Bolt och White Flare),
 *    så datumet ensamt kan aldrig peka ut ett set.
 */
export const JP_DATE_WINDOW_DAYS = { min: -6, max: 71 } as const;

export function releaseDateAgrees(cmFirstAdded: Date, tcgdexRelease: Date): boolean {
  const days = Math.round((tcgdexRelease.getTime() - cmFirstAdded.getTime()) / 86_400_000);
  return days >= JP_DATE_WINDOW_DAYS.min && days <= JP_DATE_WINDOW_DAYS.max;
}

/**
 * Visningsnamnet i katalogen: "Black Bolt (SV11B)". Koden hör till namnet därför att
 * JP och EN delar latinska setnamn — "Black Bolt" ensamt står två gånger i
 * setfiltret utan att säga vilket som är vilket. Utan känd kod: bara namnet.
 */
export function jpSetDisplayName(name: string, code: string | null): string {
  return code ? `${name} (${code})` : name;
}
