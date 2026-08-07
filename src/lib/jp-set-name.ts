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

/**
 * Koden tillbaka ur ett namn vi själva skrivit ("Black Bolt (SV11B)" → "SV11B").
 * Formatet är VÅRT eget (jpSetDisplayName), inte en leverantörs — därför är det här
 * ingen titeltolkning utan ett uppslag i vår egen skrivning. Sets utan kod ger null.
 */
export function codeFromJpSetName(name: string): string | null {
  const m = name.match(/\(([A-Za-z]{1,4}\d{1,2}[A-Za-z]{0,2})\)\s*$/);
  return m ? m[1] : null;
}

/**
 * TCGdex serie-id → seriens LATINSKA namn, samma skrivning som de engelska seten
 * använder ("Scarlet & Violet", inte "ポケモンカードゲーム スカーレット&バイオレット").
 * Rubrikerna i set-arket ska läsa likadant i båda flikarna.
 *
 * Täcker de serier våra set faktiskt ligger i (mätt 2026-08-07: SV 25 set, S 13,
 * M 7, SM 3). Äldre serier läggs till när en produkt ur dem dyker upp — en
 * okänd serie faller tillbaka på `JP_SERIES_UNKNOWN`, den hittar aldrig på ett namn.
 */
export const JP_SERIES_BY_TCGDEX_ID: Record<string, string> = {
  SV: "Scarlet & Violet",
  S: "Sword & Shield",
  SM: "Sun & Moon",
  M: "Mega Evolution",
  XY: "XY",
  XYb: "XY BREAK",
  BW: "Black & White",
  DP: "Diamond & Pearl",
  L: "LEGEND",
  PCG: "Pokémon Card Game",
};

/**
 * Serien för ett set vars era vi INTE kunnat styrka. Egen grupp sist i listan —
 * att stoppa in det i en serie på känsla hade sagt mer än vi vet.
 */
export const JP_SERIES_UNKNOWN = "Other";

export function jpSeriesFromTcgdexId(serieId: string | null | undefined): string {
  if (!serieId) return JP_SERIES_UNKNOWN;
  return JP_SERIES_BY_TCGDEX_ID[serieId] ?? JP_SERIES_UNKNOWN;
}

/** Produkt som kan få representera sitt set med sin bild. */
export interface JpSetImageCandidate {
  category: string;
  imageUrl: string | null;
}

/**
 * Setets bild. Japanska set har INGEN logotyp någonstans — TCGdex har inte en enda
 * (mätt: 0 av 177, och `assets.tcgdex.net/.../logo.png` är 404), pokemontcg.io har
 * inga japanska set alls och Cardmarkets expansionsikoner ligger bakom innehålls-
 * hashade URL:er som inte går att härleda. Det som FINNS är produktbilderna vi redan
 * visar i katalogen — och en japansk boosterförpackning bär setets logotyp tryckt på
 * omslaget, vilket är precis den igenkänningen en logotypbricka ska ge.
 *
 * Ordningen: BOOSTER_PACK före BOOSTER_BOX (påsen visar omslagskonsten stort, lådan
 * visar en låda), och en Cardmarket-render före ett butiksfoto (ren produktbild mot
 * vit bakgrund; butiksfoton är beskurna olika och ibland fotade på ett bord).
 */
const IMAGE_CATEGORY_RANK: Record<string, number> = {
  BOOSTER_PACK: 0,
  BOOSTER_BOX: 1,
  COLLECTION_BOX: 2,
};

export function pickJpSetImage(products: JpSetImageCandidate[]): string | null {
  const withImage = products.filter((p) => p.imageUrl);
  if (withImage.length === 0) return null;
  const score = (p: JpSetImageCandidate) =>
    (p.imageUrl!.includes("/api/cm-image/") ? 0 : 10) + (IMAGE_CATEGORY_RANK[p.category] ?? 5);
  return withImage.slice().sort((a, b) => score(a) - score(b))[0].imageUrl!;
}
