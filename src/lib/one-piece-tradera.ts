/**
 * ONE PIECE-SINGLAR PÅ TRADERA (2026-11-13) — ren modul, ingen databas.
 *
 * Traderas One Piece-kategori (1001268) blandar singlar, förseglat, graderat och prylar. En singel
 * bär nästan alltid KORTKODEN i titeln ("Kalgara OP08-098 Leader", "Alvida - EB05-021 SR") — mätt
 * 2026-11-13: 4 448 av 6 442 fastprisannonser. Koden pekar ut kortet, men INTE tryckningen: samma
 * kod finns i upp till tio tryckningar (Nami OP01-016: 0 kr … 18 800 kr). Reglerna är därför snåla:
 *
 *  1. Exakt EN kod i titeln. Flera koder, parti/lot, antal ("4x"), DON!!-kort ⇒ ingen träff.
 *  2. Japanskt/annat språk och graderat ⇒ ingen träff (katalogen är engelsk och ograderad).
 *  3. Tryckningen läses ur titeln: Manga, SP/Special, Alternate Art/Parallel, Treasure. Ett ANNAT
 *     särtrycksord (promo, winner, judge, pre-release, serial, anniversary, "the best" …) ⇒ ingen
 *     träff — de tryckningarna går inte att skilja åt på en rubrik.
 *  4. KORTNAMNET måste stå i titeln (minst ett ord). Säljare skriver fel kod: "Tsuru OP02-108"
 *     (koden är Rosinante), "Monet op16-016" (Ramba) — mätt 7 av 150 träffar utan den här vakten.
 *  5. Utan märke = grundtryckningen i URSPRUNGSSETET (kodens prefix = setets kod). Finns inte exakt
 *     en sådan ⇒ ingen träff. En dyr variant som säljs utan märke fälls av svepets prisvakt.
 *
 * ⛔ Hellre ingen träff än fel tryckning: ett fel här skriver ett främmande pris på ett kort.
 */

export interface OpCardRow {
  productId: string;
  /** "OP08-098", "P-001". */
  number: string;
  /** Produkttiteln: "Nami OP01-016 (Alternate Art)". Suffixet i parentes är tryckningen. */
  title: string;
  /** Setets kod: "OP08", "OP-16", "PRB01", "STP". */
  setCode: string | null;
  /** Kortnamnet: "Tony Tony.Chopper". */
  name: string;
}

export type OpPrinting = "base" | "Alternate Art" | "Manga Rare" | "Special Rare" | "Treasure Rare";

const CODE_RE = /\b(OP|EB|ST|PRB)\s?-?\s?(\d{2})\s?-\s?(\d{3})\b|(?<![A-Z0-9])P\s?-\s?(\d{3})\b/gi;

/** Alla kortkoder i titeln, normaliserade ("op 08 - 098" → "OP08-098"). */
export function onePieceCodesInTitle(title: string): string[] {
  const out = new Set<string>();
  for (const m of title.matchAll(CODE_RE)) {
    out.add(m[4] ? `P-${m[4]}` : `${m[1].toUpperCase()}${m[2]}-${m[3]}`);
  }
  return [...out];
}

const FOREIGN_RE = /\b(japansk\w*|japanese|japan|jpn?|jap|kinesisk\w*|chinese|korean\w*|koreansk\w*|fransk\w*|french|tysk\w*|german)\b/i;
const GRADED_RE = /\b(psa|bgs|cgc|beckett|sgc|tag|ace|raukcard|rauk|graded|graderad\w*|slab\w*)\b/i;
const LOT_RE =
  /\b(lot|parti|samling|kortsamling|bulk|blandade|diverse|bundle|playset|set om|paket med|\d+\s?(st|x|kort|cards)|x\s?\d+)\b|\+/i;
const DON_RE = /\bdon\s?!!|\bdon\b/i;
const SEALED_RE = /\b(booster|display|box|case|starter deck|deck|pack|paket|sleeves?|playmat|binder|pärm)\b/i;

const PRINTING_RULES: [OpPrinting, RegExp][] = [
  ["Manga Rare", /\bmanga\b/i],
  ["Treasure Rare", /\btreasure\b|\bTR\b/],
  ["Special Rare", /\bSP\b|\bspecial\b/i],
  ["Alternate Art", /\balt(ernate|ernative)?\.?\s?art\b|\balternativ\w*\b|\bAA\b|\bparallel\w*\b|\bpara\b/i],
];
/** Särtryck vi INTE kan skilja åt på en rubrik. */
const OTHER_SPECIAL_RE =
  /\b(promo\w*|winner|judge|finalist|pre-?release|tournament|turnering\w*|championship|event|serial\w*|anniversary|premium|the best|reprint|full\s?art|textured|gold|stamp\w*|stämp\w*|box\s?topper|jolly roger|pirate\s?foil|piratfolie|flagship|treasure cup|regional\w*|sealed|förseglad\w*|gift|collection)\b/i;

/** Tryckningen titeln påstår. `null` = ett särtryck vi inte kan peka ut ⇒ ingen träff. */
export function onePiecePrintingInTitle(title: string): OpPrinting | null {
  for (const [printing, re] of PRINTING_RULES) if (re.test(title)) return printing;
  return OTHER_SPECIAL_RE.test(title) ? null : "base";
}

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
/** Står minst ett ord (≥ 3 bokstäver) ur kortnamnet i titeln? Namn utan sådant ord dömer inte. */
export function onePieceNameInTitle(cardName: string, listingTitle: string): boolean {
  const words = fold(cardName).split(/[^a-z]+/).filter((w) => w.length >= 3);
  if (words.length === 0) return true;
  const title = fold(listingTitle);
  return words.some((w) => title.includes(w));
}

const normCode = (s: string | null | undefined) => (s ?? "").replace(/[^A-Z0-9]/gi, "").toUpperCase();
const printingOfTitle = (productTitle: string): string =>
  productTitle.match(/\(([^)]+)\)\s*$/)?.[1].trim() ?? "base";

export type OpTraderaVerdict =
  | { productId: string; code: string; printing: OpPrinting }
  | { productId: null; reason: string };

/**
 * Annons → produkt. `cardsByNumber` = katalogens One Piece-singlar per kortkod.
 * Ren funktion: samma indata ger samma svar, och varje "ingen träff" bär sitt skäl (mätbart).
 */
export function matchOnePieceTraderaSingle(
  listingTitle: string,
  cardsByNumber: ReadonlyMap<string, readonly OpCardRow[]>
): OpTraderaVerdict {
  const title = listingTitle.replace(/&amp;/g, "&");
  const codes = onePieceCodesInTitle(title);
  if (codes.length === 0) return { productId: null, reason: "ingen kortkod" };
  if (codes.length > 1) return { productId: null, reason: "flera kortkoder" };
  if (FOREIGN_RE.test(title)) return { productId: null, reason: "annat språk" };
  if (GRADED_RE.test(title)) return { productId: null, reason: "graderat" };
  if (DON_RE.test(title)) return { productId: null, reason: "DON-kort" };
  if (LOT_RE.test(title)) return { productId: null, reason: "parti/antal" };
  if (SEALED_RE.test(title)) return { productId: null, reason: "förseglat/tillbehör" };

  const code = codes[0];
  const cards = cardsByNumber.get(code) ?? [];
  if (cards.length === 0) return { productId: null, reason: "koden saknas i katalogen" };
  const printing = onePiecePrintingInTitle(title);
  if (printing === null) return { productId: null, reason: "särtryck utan säker tryckning" };

  const origin = normCode(code.split("-")[0]);
  const ofPrinting = cards.filter((c) => printingOfTitle(c.title) === printing);
  const inOrigin = ofPrinting.filter((c) => normCode(c.setCode) === origin);
  // Grundtryckningen MÅSTE vara ursprungssetets; ett märkt särtryck får vara ensamt i katalogen.
  const pick = inOrigin.length === 1 ? inOrigin[0] : printing !== "base" && inOrigin.length === 0 && ofPrinting.length === 1 ? ofPrinting[0] : null;
  if (!pick) return { productId: null, reason: `tryckningen ${printing} går inte att peka ut` };
  if (!onePieceNameInTitle(pick.name, title)) return { productId: null, reason: "kortnamnet saknas (fel kod?)" };
  return { productId: pick.productId, code, printing };
}
