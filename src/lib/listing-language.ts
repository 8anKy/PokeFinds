import type { CardLanguage } from "@prisma/client";

/**
 * Språk-detektering för butiksannonser/produkter utifrån TITELN (vi lagrar inget
 * separat språk på scrapade produkter) och valfritt butiks-URL:en (slugs som
 * "...-kinesisk-version" avslöjar språk som titeln döljer). Japanska = OK att
 * importera/larma; kinesiska, koreanska och övriga EU-språk = blockade (katalogen
 * är EN + JP only). Ändra BLOCKED om policyn ändras.
 *
 * DETEKTIONEN ÄR I TRE LAGER, för att en spansk annons sällan säger "spansk":
 *   1. SpråkORD ("*SPANSK*", "Deutsch", "Español")  — butiker som märker ut språket
 *   2. ProduktORD ("Sobres", "Caja", "Bustine")     — annonsen är skriven på språket
 *   3. SetNAMN ("Destinos Paldeanos", "Karmesin")   — lokaliserad utgåva, engelsk butikstext
 * Plus landskoder ("(ES)", "ESP", "ES-version") — men BARA i avgränsad form, se nedan.
 */
export type ListingLang = "JP" | "CN" | "KR" | "EU" | "EN";

const CN = /\b(kinesisk\w*|chinese|chinesisk\w*)\b/i;
const KR = /\b(korean\w*|koreansk\w*)\b/i;
const JP = /\b(japansk\w*|japanese|jpn?)\b/i;

// --- Lager 1: språkord (svenska + engelska + språkets egna namn för sig självt).
// "fransk\w*" fångar INTE "francais", "portugis\w*" fångar inte "portugues" → egna alternativ.
const EU_LANGS =
  /\b(tysk\w*|german|deutsch\w*|fransk\w*|french|francais\w*|spansk\w*|spanish|espanol\w*|castellano|italiensk\w*|italian\w*|italiano\w*|portugis\w*|portuguese|portugues\w*)\b/i;

// --- Lager 2: produktord som bara finns på annat språk än EN/SV.
// MEDVETET UTELÄMNADE (kolliderar med engelska/svenska titlar): "collection",
// "edition", "box", "display", "carta"/"sobre" (för korta/tvetydiga).
// "coleccion"≠"collection" och "edicion"≠"edition" — inga delade stavningar.
const EU_NOUNS =
  /\b(sobres?|cartas|coleccion|edicion|caja|mazo|bustine|scatola|espansione|coffret|cartes|sammelkarten\w*|kartenspiel)\b/i;

// --- Lager 3: lokaliserade set-namn. HÖGSTA volymen i verkligheten: butiken skriver
// engelsk säljtext men sätter det spanska/tyska setnamnet.
// LIVSFARLIGT ATT LÄGGA TILL HÄR: de ENGELSKA setnamnen. "violet", "scarlet",
// "prismatic", "evolutions", "temporal", "paldea(n)", "masquerade", "purple", "rivals"
// får ALDRIG stå med — de skulle blockera halva katalogen. Endast former som är
// unika för respektive språk: purpura/purpur JA, purple NEJ. evoluciones JA,
// evolutions NEJ. paldeanos/paldeas JA, paldean NEJ. scarlatto JA, scarlet NEJ.
const EU_SETS =
  /\b(escarlata|purpura|karmesin|ecarlate|scarlatto|violetto|destinos|destinees|destini|paldeanos|paldeas|evoluciones|evoluzioni|prismaticas|prismatiques|prismatiche|fuerzas|forze|temporales|obsidiana|llameante|obsidianflammen|mascarada|crepuscular|crepusculaire|chispas|fulgurantes|rivales|predestinados|farbenschock|zwielicht)\b/i;

// --- Landskoder. ENDAST avgränsad form — aldrig bara \bes\b/\bit\b/\bde\b/\bsp\b:
// "it" är engelska ordet it, "de"/"es" dyker upp som slug-fragment, "SP" används som
// rarity-kod. Och "SPA" är en delsträng av SPArks ("Surging Sparks") → 3-boksstavskoden
// måste vara VERSAL och avgränsad. Körs BARA på titeln, aldrig på URL:en (URL-splitten
// på [-_/+.] tillverkar 2-boksstavsfragment som skulle träffa allt).
// "sp" tas med HÄR men ingen annanstans: inom parentes är "(SP)" i praktiken alltid
// en språktagg, medan ett bart "SP" är kortrariteten/Platinum-erans "Pokémon SP".
const EU_CODE_PAREN = /[([]\s*(?:es|esp|sp|spa|de|deu|ger|fr|fra|it|ita|pt)\s*[)\]]/i;
const EU_CODE_SUFFIX = /\b(?:es|esp|spa|deu|ita|fra|ger)[-\s]?(?:version|utgava|utgåva|edition|edicion)\b/i;
// INGEN regel för bart versalt "ESP"/"SPA"/"DEU". Det testades mot hela katalogen och
// träffade "Sabrina's ESP · Gym Heroes 117/132" — ett riktigt ENGELSKT kort (ESP är
// kortets NAMN). Att blockera engelska produkter är värre än att missa en spansk, och
// de vettiga formerna täcks redan av "(ESP)" och "ESP-version" ovan.

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

/** Fäller ihop accenter: "Púrpura"→"Purpura", "Écarlate"→"Ecarlate", "Español"→"Espanol".
 *  Utan detta missar orden ovan varje korrekt stavad titel. Rör inte kana/han/hangul. */
function foldAccents(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

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
  // Skript-testerna körs på RÅ text (accent-fällning rör dem inte, men var explicit).
  if (CN.test(hay) || CN_LINES.test(hay) || (HAN.test(hay) && !KANA.test(hay))) return "CN";
  if (KR.test(hay) || HANGUL.test(hay)) return "KR";
  if (JP.test(hay) || KANA.test(hay)) return "JP";

  const folded = foldAccents(hay);
  if (EU_LANGS.test(folded) || EU_NOUNS.test(folded) || EU_SETS.test(folded)) return "EU";

  // Landskoder: titeln ENDAST (se kommentar vid konstanterna).
  const foldedTitle = foldAccents(title);
  if (EU_CODE_PAREN.test(foldedTitle) || EU_CODE_SUFFIX.test(foldedTitle)) return "EU";
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
