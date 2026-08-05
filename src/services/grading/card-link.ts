/**
 * GRADERING → KATALOGKORT: vilket kort i katalogen är det som graderades?
 *
 * Graderingen sparar ALDRIG användarens foton (`frontImageUrl = INLINE_UPLOAD`,
 * dataminimering), så historiken har ingen bild att visa. Katalogbilden är den enda
 * bilden som finns — men bara om vi vet VILKET kort det var, och det enda vi har är
 * modellens fritextsträng i `result.cardName`.
 *
 * MÄTT MOT PROD 2026-08-05 — strängen är inte ett bart kortnamn. Riktiga värden:
 *   "Camerupt 028/217 · Scarlet & Violet: Obsidian Flames"
 *   "Camerupt 028/217 · Ascending Heroes"
 *   "Raboot 037/217 · ASC (Scarlet & Violet Promo / Astral set)"
 * Namn + samlarnummer + en SETGISSNING. Setgissningen är ofta FEL (Camerupt 28/217 är
 * Ascended Heroes, inte Obsidian Flames) och modellen hedgar öppet ("Promo / Astral
 * set"). Numret däremot bar identiteten i alla tre fallen.
 *
 * Därför återanvänds skannerns `matchCards` rakt av i stället för en ny namnmatchare:
 * den är MÄTT (`scripts/scanner-match-audit.ts`: 100 % topp-1 med ett korrekt läst
 * nummer) och den ignorerar redan setnamn som inte stämmer.
 *
 * ⛔ UTAN NUMMER — INGEN BILD. 18 938 av 20 563 kort (92 %) delar namn med minst ett
 *    annat kort, så ett namn ensamt pekar inte ut ett kort utan en HÖG av kort. Mätt
 *    på strängarna ovan: en namn+nummer-träff får 1,53 och en ren namnträff 1,03 —
 *    fyra olika Camerupt låg på 1,03. Att visa en av dem hade varit ett tärningskast
 *    med fyra sidor, presenterat som ett faktum bredvid en gradering.
 * ⛔ FEL BILD ÄR VÄRRE ÄN INGEN BILD. Tryckningen avgör vad kortet är värt; en bild av
 *    "ett annat Camerupt" är ett påstående om något vi inte vet. Ingen bild läses som
 *    "vi vet inte" — precis som "–" mot "0 kr" i pristabellen.
 */
import { matchCards, parseGuessedNumber } from "@/services/scanner";

export interface GradedCardLink {
  cardId: string;
  imageUrl: string | null;
  /** Katalogens egen skrivning — kan skilja sig från modellens sträng. */
  name: string;
  setName: string;
  number: string;
  /** Produktsidans slug, när kortet har en produkt. */
  slug: string | null;
}

/**
 * Delar modellens sträng i NAMN och NUMMER.
 *
 * Namnet är allt före numret; resten (setgissningen) kastas med flit — den är mätt
 * opålitlig och `matchCards` väger ändå inte setnamn. Ren funktion, testad.
 */
export function splitGradedCardName(raw: string | null | undefined): {
  name: string;
  number: string | null;
} {
  const s = (raw ?? "").trim();
  if (!s) return { name: "", number: null };
  // "028/217" (nummer/total) eller "TG10" / "SV075" (bokstavsprefix). Total-formen
  // först: den är entydig, och en bar sifferserie i ett setnamn ska inte kunna
  // förväxlas med ett kortnummer.
  const withTotal = /(\d{1,4}\s*[/／]\s*\d{1,4})/.exec(s);
  const lettered = /\b([A-Za-z]{1,5}\s?\d{1,4}[a-z]?)\b/.exec(s);
  const hit = withTotal ?? lettered;
  if (!hit) return { name: stripSeparators(s), number: null };
  return {
    name: stripSeparators(s.slice(0, hit.index)),
    number: hit[1].replace(/\s+/g, ""),
  };
}

/** Trailing "·", "-", ":" och komma som blir kvar när numret klippts bort. */
function stripSeparators(s: string): string {
  return s.replace(/[\s·:,\-–—]+$/u, "").trim();
}

/**
 * Slår modellens sträng mot katalogen. `null` = vi vet inte vilket kort det var,
 * och då ska ingen bild visas.
 */
export async function resolveGradedCard(
  cardName: string | null | undefined
): Promise<GradedCardLink | null> {
  const { name, number } = splitGradedCardName(cardName);
  // Numret ÄR identiteten här — se filhuvudet. Inget nummer, ingen bild.
  if (!name || !number) return null;
  const parsed = parseGuessedNumber(number);
  if (!parsed) return null;

  const candidates = await matchCards({
    rawText: cardName ?? "",
    guessedName: name,
    guessedNumber: number,
    // Vi har ingen bild och ingen OCR-konfidens här — strängen är allt vi fick.
    // Konfidensen används bara för att gradera skannerns egna träffar; identiteten
    // avgörs av nummerkravet nedan.
    confidence: 0,
  });
  const top = candidates[0];
  if (!top) return null;

  // Träffen måste bära PRECIS det numret. `matchCards` returnerar även rena
  // namnträffar (fyra Camerupt på 1,03 i mätningen) och de får aldrig bli en bild.
  const same = (a: string, b: string) =>
    a.replace(/^0+/, "").toLowerCase() === b.replace(/^0+/, "").toLowerCase();
  if (!same(top.number, parsed.printed)) return null;
  // …och den måste vara ENSAM om numret. Två kort med samma namn OCH samma nummer
  // (olika set) är ett äkta oavgjort, och ett oavgjort är inte ett svar.
  if (candidates[1] && same(candidates[1].number, parsed.printed)) return null;

  return {
    cardId: top.cardId,
    imageUrl: top.imageUrl,
    name: top.name,
    setName: top.setName,
    number: top.number,
    slug: top.slug,
  };
}
