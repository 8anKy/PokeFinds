import type { CardLanguage } from "@prisma/client";

/**
 * Språk-detektering för butiksannonser/produkter utifrån TITELN (vi lagrar inget
 * separat språk på scrapade produkter) och valfritt butiks-URL:en (slugs som
 * "...-kinesisk-version" avslöjar språk som titeln döljer). Japanska = OK att
 * importera/larma; kinesiska och koreanska = blockade "for now" (larma ej,
 * auto-importera ej nya). Ändra BLOCKED om policyn ändras.
 */
export type ListingLang = "JP" | "CN" | "KR" | "EU" | "EN";

const CN = /\b(kinesisk\w*|chinese|chinesisk\w*)\b/i;
const KR = /\b(korean\w*|koreansk\w*)\b/i;
const JP = /\b(japansk\w*|japanese|jpn?)\b/i;
// Övriga europeiska utgåvor — katalogen är EN+JP only, så tyska/franska/spanska/
// italienska utgåvor blockas också ("Sun & Moon 1 Booster *TYSK*").
const EU_LANGS = /\b(tysk\w*|german|deutsch\w*|fransk\w*|french|spansk\w*|spanish|italiensk\w*|italian\w*|portugis\w*|portuguese)\b/i;
// Bara kana (hiragana/katakana) är entydigt japanskt — Han/kanji delas med kinesiska
// så vi använder INTE det som JP-signal (skulle fel-flagga kinesiska titlar).
const KANA = /[぀-ヿ]/;
// Han/kanji UTAN kana = kinesisk titel (japanska titlar blandar alltid in kana).
const HAN = /[一-鿿㐀-䶿]/;
// Hangul = koreansk titel.
const HANGUL = /[가-힯ᄀ-ᇿㄱ-ㆎ]/;
// Kinesisk-exklusiva produktlinjer med LATINSKA titlar — ordet "chinese" saknas
// ("Gem Pack Vol 3 151 C Booster Box"). "151C"/"151 C" = kinesiska 151-utgåvan
// (suffixet C = Chinese; \b efter c så "151 Collection" inte träffas).
const CN_LINES = /\bgem pack\b|\b151\s*c\b/i;

export function detectListingLanguage(title: string, url?: string | null): ListingLang {
  // URL-slugen kan bära språket när titeln inte gör det (DL:s "…-kinesisk-version").
  // Avkoda %XX så även URL-kodade slugs läses; ogiltig kodning ignoreras.
  let hay = title;
  if (url) {
    try {
      hay += " " + decodeURIComponent(url).replace(/[-_/+.]/g, " ");
    } catch {
      hay += " " + url.replace(/[-_/+.]/g, " ");
    }
  }
  if (CN.test(hay) || CN_LINES.test(hay) || (HAN.test(hay) && !KANA.test(hay))) return "CN";
  if (KR.test(hay) || HANGUL.test(hay)) return "KR";
  if (JP.test(hay) || KANA.test(hay)) return "JP";
  if (EU_LANGS.test(hay)) return "EU";
  return "EN";
}

/** Språk vi varken larmar på eller auto-importerar — katalogen är EN + JP only. */
const BLOCKED = new Set<ListingLang>(["CN", "KR", "EU"]);

export function isBlockedListingLanguage(title: string, url?: string | null): boolean {
  return BLOCKED.has(detectListingLanguage(title, url));
}

/** Enum-värde för lagring: japanska taggas JP, blockade främmande språk OTHER, annars EN. */
export function listingCardLanguage(title: string, url?: string | null): CardLanguage {
  const l = detectListingLanguage(title, url);
  if (l === "JP") return "JP";
  if (l === "CN" || l === "KR" || l === "EU") return "OTHER";
  return "EN";
}
