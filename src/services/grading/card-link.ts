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
import { prisma } from "@/lib/db";
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

/** Gemener, bara bokstäver/siffror: "Charizard-GX" och "Charizard GX" blir samma. */
function normName(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

/** Setnamnets ord, utan plural-s och utfyllnadsord ("Celebrations" ≈ "Celebration"). */
const SET_STOP = new Set(["pokemon", "the", "of", "and", "tcg", "set", "series", "promo", "promos"]);
function setWords(s: string): Set<string> {
  return new Set(
    s
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 1 && !SET_STOP.has(w))
      .map((w) => (w.length > 3 && w.endsWith("s") ? w.slice(0, -1) : w))
  );
}

export interface GradedCandidate {
  name: string;
  number: string;
  setName: string;
}

/**
 * VILKEN KANDIDAT — ren och testad (2026-10-01, ägarens fältrapport: graderingar av
 * Classic Collection-kort fick aldrig någon bild).
 *
 *  1. Bara kort med EXAKT det lästa numret (numret är identiteten, se filhuvudet).
 *  2. Bland dem: exakt namn vinner ("Charizard GX" ska aldrig bli "Charizard G").
 *  3. Är det fortfarande oavgjort får modellens SETTEXT avgöra — men bara mellan kort
 *     som redan delar namn OCH nummer, och bara om ETT set tydligt vinner. Fallet som
 *     väckte frågan: "Dark Tyranitar 19/109 · Celebrations Classic Collection" gav
 *     Team Rocket Returns #19 och Classic Collection #19 lika — samma konst (Classic
 *     Collection är en nytryckning), men setordet pekar ut rätt kort.
 *     ⛔ Setgissningen används ALDRIG ensam: utan namn+nummer-träff blir det ingen bild.
 *
 * Returnerar index i `candidates`, eller -1 = vi vet inte.
 */
export function pickGradedCandidate(
  candidates: GradedCandidate[],
  modelName: string,
  printedNumber: string,
  setHint: string | null
): number {
  const same = (a: string, b: string) =>
    a.replace(/^0+/, "").toLowerCase() === b.replace(/^0+/, "").toLowerCase();
  let pool = candidates.map((c, i) => ({ c, i })).filter(({ c }) => same(c.number, printedNumber));
  if (pool.length === 0) return -1;
  const exact = pool.filter(({ c }) => normName(c.name) === normName(modelName));
  if (exact.length > 0) pool = exact;
  if (pool.length === 1) return pool[0].i;

  if (!setHint) return -1;
  const hint = setWords(setHint);
  if (hint.size === 0) return -1;
  const scored = pool
    .map((p) => {
      const words = setWords(p.c.setName);
      let overlap = 0;
      for (const w of hint) if (words.has(w)) overlap++;
      return { ...p, overlap };
    })
    .sort((a, b) => b.overlap - a.overlap);
  if (scored[0].overlap === 0) return -1;
  if (scored[1] && scored[1].overlap === scored[0].overlap) return -1;
  return scored[0].i;
}

/**
 * Slår modellens sträng mot katalogen. `null` = vi vet inte vilket kort det var,
 * och då ska ingen bild visas.
 *
 * `hintCardId` (2026-10-01): kortet SKANNERN redan identifierade när graderingen
 * startades därifrån. Det är användarens eget val ur skannern, så det vinner — så
 * länge modellen inte läser ett ANNAT kortnamn (då har användaren bytt kort).
 */
export async function resolveGradedCard(
  cardName: string | null | undefined,
  hintCardId?: string | null
): Promise<GradedCardLink | null> {
  const { name, number } = splitGradedCardName(cardName);

  if (hintCardId) {
    const hinted = await linkByCardId(hintCardId);
    if (hinted && (!name || normName(hinted.name).includes(normName(name)) || normName(name).includes(normName(hinted.name)))) {
      return hinted;
    }
  }

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
  const setHint = (cardName ?? "").split(" · ").slice(1).join(" ") || null;
  const i = pickGradedCandidate(candidates, name, parsed.printed, setHint);
  if (i < 0) return null;
  const top = candidates[i];
  return {
    cardId: top.cardId,
    imageUrl: top.imageUrl,
    name: top.name,
    setName: top.setName,
    number: top.number,
    slug: top.slug,
  };
}

/** Katalogkortet för ett känt kort-id, i samma form som matchningens träffar. */
export async function linkByCardId(cardId: string): Promise<GradedCardLink | null> {
  const card = await prisma.card.findUnique({
    where: { id: cardId },
    select: { name: true, number: true },
  });
  if (!card) return null;
  const candidates = await matchCards({
    rawText: `${card.name} ${card.number}`,
    guessedName: card.name,
    guessedNumber: card.number,
    confidence: 0,
  });
  const hit = candidates.find((c) => c.cardId === cardId);
  if (!hit) return null;
  return {
    cardId: hit.cardId,
    imageUrl: hit.imageUrl,
    name: hit.name,
    setName: hit.setName,
    number: hit.number,
    slug: hit.slug,
  };
}
