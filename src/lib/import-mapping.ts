/**
 * KOLUMNTOLKNING FÖR SAMLINGSIMPORT (ren modul).
 *
 * Frågan modulen svarar på: "vilken av användarens kolumner är kortnamnet?".
 *
 * ⛔ VI BYGGER INTE EN PARSER PER APP. Formaten går inte att pinna utifrån —
 * flera samlingsappar publicerar ingen kolumnspecifikation
 * alls, och den som finns ändras utan förvarning. En hårdkodad app-parser hade
 * alltså gått sönder tyst, för exakt de användare vi byggde den åt. Ordningen är
 * därför omvänd: en ALIAS-tabell tolkar rubrikerna, användaren får se tolkningen
 * och kan rätta den, och ett "profilnamn" är bara en ETIKETT vi vågar sätta när
 * signaturen är otvetydig.
 *
 * ⛔ EN PROFIL SOM VI INTE KAN VERIFIERA SKA INTE PÅSTÅS. Att skriva "Vi läste
 * filen som en viss app-export" när vi bara gissat är värre än att skriva "vi tolkade
 * kolumnerna — kontrollera dem": det första ber användaren sluta läsa.
 */

/** Fälten importen kan fylla. `name` är det enda obligatoriska. */
export const IMPORT_FIELDS = [
  "name",
  "setName",
  "setCode",
  "cardNumber",
  "quantity",
  "condition",
  "language",
  "printing",
  "purchasePrice",
  "purchaseDate",
  "estimatedValue",
  "gradingCompany",
  "grade",
  "notes",
  "externalId",
  "slug",
  "itemType",
] as const;

export type ImportField = (typeof IMPORT_FIELDS)[number];

/** Kolumnindex per fält. `null` = kolumnen finns inte i filen. */
export type ColumnMapping = Partial<Record<ImportField, number | null>>;

/**
 * Rubriknormalisering: gemener, alla skiljetecken → mellanslag, kollapsad luft.
 * Gör "Card Number", "card_number", "CARD-NUMBER" och "Card  Number" till samma
 * nyckel. Diakriter behålls ("språk" ≠ "sprak" i tabellen — båda står med).
 */
export function normalizeHeader(header: string): string {
  return header
    .toLowerCase()
    .replace(/[^\p{L}\p{N}#]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/**
 * Alias per fält, EXAKTA normaliserade rubriker.
 *
 * ⛔ Ordningen inom en lista spelar roll bara vid krock mellan två FÄLT — där
 * vinner det fält som står först i `IMPORT_FIELDS`, eftersom `autoMapColumns`
 * går igenom fälten i den ordningen och en kolumn bara kan bindas en gång.
 */
const ALIASES: Record<ImportField, string[]> = {
  name: [
    "name",
    "card name",
    "cardname",
    "product name",
    "item name",
    "card",
    "title",
    "card title",
    "namn",
    "kortnamn",
    "kort",
    "produkt",
    "produktnamn",
    "titel",
    // ⚠️ Sist: vissa exporter har BÅDE "Name" och "Simple Name". Det exakta "name"
    // ovan binder kolumnen först, så "simple name" blir bara reserven för
    // exporter som saknar den fullständiga titeln.
    "simple name",
  ],
  setName: [
    "set",
    "set name",
    "setname",
    "expansion",
    "expansion name",
    "serie",
    "series",
    "setnamn",
    "utgåva",
    "utgava",
  ],
  setCode: [
    "set code",
    "setcode",
    "set abbreviation",
    "abbreviation",
    "ptcgo code",
    "expansion code",
    "setkod",
  ],
  cardNumber: [
    "card number",
    "cardnumber",
    "collector number",
    "card no",
    "card #",
    "number",
    "no",
    "#",
    "nummer",
    "kortnummer",
    "samlarnummer",
  ],
  quantity: [
    "quantity",
    "qty",
    "count",
    "amount",
    "copies",
    "owned",
    "antal",
    "st",
    "styck",
  ],
  condition: ["condition", "cond", "card condition", "skick", "kvalitet", "kondition"],
  language: ["language", "lang", "card language", "språk", "sprak"],
  printing: [
    "printing",
    "print",
    "print type",
    "finish",
    "foil",
    "foiling",
    "is foil",
    "holo",
    "holofoil",
    "variant",
    "version",
    "tryckning",
    "variantetikett",
  ],
  purchasePrice: [
    "purchase price",
    "purchaseprice",
    "price bought",
    "price paid",
    "paid",
    "paid price",
    "cost",
    "cost basis",
    "buy price",
    "bought for",
    "acquisition price",
    "inköpspris",
    "inkopspris",
    "köppris",
    "koppris",
    "betalat",
    "betalt pris",
  ],
  purchaseDate: [
    "purchase date",
    "purchasedate",
    "date bought",
    "date acquired",
    "acquired",
    "acquired date",
    "date added",
    "added",
    "inköpsdatum",
    "inkopsdatum",
    "köpdatum",
    "kopdatum",
    "datum",
  ],
  estimatedValue: [
    "market value",
    "estimatedvalue",
    "market price",
    "current value",
    "current price",
    "value",
    "tcg market price",
    "marknadsvärde",
    "marknadsvarde",
    "värde",
    "varde",
  ],
  gradingCompany: [
    "grading company",
    "gradingcompany",
    "grader",
    "graded by",
    "grading",
    "grading service",
    "graderingsbolag",
    "graderare",
  ],
  grade: ["grade", "graded", "card grade", "betyg", "gradering"],
  notes: ["notes", "note", "comment", "comments", "anteckning", "anteckningar", "kommentar"],
  // ⚠️ SMAL MED FLIT. "Product ID" och "SKU" i externa exporter är deras
  // egna nycklar, inte pokemontcg.io:s — mappas de hit letar vi efter ett id som
  // aldrig kan finnas, och en kolumn som HADE kunnat mappas är upptagen.
  externalId: ["tcg id", "tcgid", "pokemontcg id", "pokemon tcg id", "ptcg id"],
  slug: ["slug", "foilio slug"],
  // ⛔ Aldrig bara "type": i en Pokémon-fil är det oftast korttypen (Fire, Water).
  itemType: ["collectible type", "item type", "product type", "category", "kategori", "varutyp"],
};

/**
 * Delsträngar som får binda en kolumn NÄR ingen exakt alias träffade. Skilt från
 * `ALIASES` eftersom en delsträngsträff är en gissning: "Purchase Price (USD)"
 * ska hittas, men "Price" ensamt ska INTE tyst bli inköpspris.
 */
const CONTAINS: Partial<Record<ImportField, string[]>> = {
  name: ["card name", "product name", "item name"],
  setName: ["set name", "expansion"],
  cardNumber: ["card number", "collector number", "kortnummer"],
  quantity: ["quantity", "antal"],
  condition: ["condition", "skick"],
  language: ["language", "språk"],
  printing: ["printing", "foil", "variant"],
  purchasePrice: ["purchase price", "price paid", "price bought", "inköpspris"],
  purchaseDate: ["purchase date", "date bought", "date added", "inköpsdatum"],
  estimatedValue: ["market value", "market price"],
  gradingCompany: ["grading company", "graded by"],
  grade: ["grade"],
};

/** Vilken enhet penningkolumnerna är i. Foilios egen export skriver ÖRE. */
export type MoneyUnit = "major" | "ore";

export interface ImportProfile {
  id: string;
  /** Namn vi vågar visa. Sätts BARA när signaturen är otvetydig. */
  label: string;
  /** Alla dessa normaliserade rubriker måste finnas. */
  signature: string[];
  moneyUnit: MoneyUnit;
}

/**
 * Profiler vi kan verifiera. Listan är kort med flit — se filhuvudet.
 * En fil som inte träffar någon profil är inte ett fel; den går via aliasen.
 */
export const IMPORT_PROFILES: ImportProfile[] = [
  {
    id: "foilio",
    label: "Foilio",
    // Vår egen export. `estimatedvalue` + `purchaseprice` i SAMMA fil är
    // signaturen — och den enda fil där beloppen är i öre.
    signature: ["name", "quantity", "condition", "language", "purchaseprice", "estimatedvalue"],
    moneyUnit: "ore",
  },
];

export interface MappingResult {
  mapping: ColumnMapping;
  /** Igenkänd profil, eller null när kolumnerna tolkats en och en. */
  profile: ImportProfile | null;
  /** Kolumner vi inte kunde placera — visas som "ignoreras" i gränssnittet. */
  unmapped: string[];
  moneyUnit: MoneyUnit;
}

/**
 * Tolkar rubrikraden. Varje kolumn binds till HÖGST ett fält, och varje fält
 * till högst en kolumn (första träffen vinner) — annars kan två kolumner
 * ("Name" och "Simple Name") tyst skriva över varandra.
 */
export function autoMapColumns(headers: string[]): MappingResult {
  const normalized = headers.map(normalizeHeader);
  const profile =
    IMPORT_PROFILES.find((p) => p.signature.every((h) => normalized.includes(h))) ?? null;

  const mapping: ColumnMapping = {};
  const taken = new Set<number>();

  // Pass 1: exakta alias.
  for (const field of IMPORT_FIELDS) {
    for (const alias of ALIASES[field]) {
      const index = normalized.findIndex((h, i) => h === alias && !taken.has(i));
      if (index >= 0) {
        mapping[field] = index;
        taken.add(index);
        break;
      }
    }
  }

  // Pass 2: delsträngar, bara för fält som fortfarande saknas.
  for (const field of IMPORT_FIELDS) {
    if (mapping[field] != null) continue;
    for (const needle of CONTAINS[field] ?? []) {
      const index = normalized.findIndex((h, i) => h.includes(needle) && !taken.has(i));
      if (index >= 0) {
        mapping[field] = index;
        taken.add(index);
        break;
      }
    }
  }

  const unmapped = headers.filter((_, i) => !taken.has(i) && headers[i] !== "");
  return { mapping, profile, unmapped, moneyUnit: profile?.moneyUnit ?? "major" };
}
