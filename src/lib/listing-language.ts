import type { CardLanguage } from "@prisma/client";

/**
 * Språk-detektering för butiksannonser/produkter utifrån TITELN (vi lagrar inget
 * separat språk på scrapade produkter). Japanska = OK att importera/larma; kinesiska
 * och koreanska = blockade "for now" (larma ej, auto-importera ej nya). Ändra
 * BLOCKED om policyn ändras.
 */
export type ListingLang = "JP" | "CN" | "KR" | "EN";

const CN = /\b(kinesisk\w*|chinese)\b/i;
const KR = /\b(korean\w*|koreansk\w*)\b/i;
const JP = /\b(japansk\w*|japanese|jpn?)\b/i;
// Bara kana (hiragana/katakana) är entydigt japanskt — Han/kanji delas med kinesiska
// så vi använder INTE det som JP-signal (skulle fel-flagga kinesiska titlar).
const KANA = /[぀-ヿ]/;

export function detectListingLanguage(title: string): ListingLang {
  if (CN.test(title)) return "CN";
  if (KR.test(title)) return "KR";
  if (JP.test(title) || KANA.test(title)) return "JP";
  return "EN";
}

/** Språk vi varken larmar på eller auto-importerar just nu. */
const BLOCKED = new Set<ListingLang>(["CN", "KR"]);

export function isBlockedListingLanguage(title: string): boolean {
  return BLOCKED.has(detectListingLanguage(title));
}

/** Enum-värde för lagring: japanska taggas JP, blockade främmande språk OTHER, annars EN. */
export function listingCardLanguage(title: string): CardLanguage {
  const l = detectListingLanguage(title);
  if (l === "JP") return "JP";
  if (l === "CN" || l === "KR") return "OTHER";
  return "EN";
}
