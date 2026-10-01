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
import { variantDisplayRank } from "@/lib/print-variant";

export interface GradedCardLink {
  cardId: string;
  imageUrl: string | null;
  /** Katalogens egen skrivning — kan skilja sig från modellens sträng. */
  name: string;
  setName: string;
  number: string;
  /** Produktsidans slug, när kortet har en produkt. */
  slug: string | null;
  /** Katalogens språk ("EN", "JP" …) — avgör kortbaksidan i slabvideon. */
  language: string;
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
  // Bokstavsformen bara i namndelen: i setgissningen blev "Base Set 2" annars numret "Set2".
  const lettered = /\b([A-Za-z]{1,5}\s?\d{1,4}[a-z]?)\b/.exec(s.split("·")[0]);
  // NAKET NUMMER sist i namndelen: "Articuno 22 · WotC Promo" (mätt i prod 2026-10-01).
  // Bara i delen FÖRE första "·" — "Charizard · Base Set 2" är en setgissning, inget nummer.
  const bare = /^(.+?)\s(\d{1,4})\s*$/.exec(s.split("·")[0]);
  const bareHit = bare ? Object.assign([bare[0], bare[2]], { index: bare[1].length + 1 }) : null;
  const hit = withTotal ?? lettered ?? bareHit;
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
  // "MEP 099" i katalogen mot modellens "MEP099": mellanslag och inledande nollor räknas inte.
  const norm = (x: string) => x.replace(/\s+/g, "").replace(/^0+/, "").toLowerCase();
  const same = (a: string, b: string) => norm(a) === norm(b);
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
  hintCardId?: string | null,
  opts: { confirmed?: boolean; artCardIds?: string[] } = {}
): Promise<GradedCardLink | null> {
  const { name, number } = splitGradedCardName(cardName);

  // Användaren bekräftade kortet (bildmatchningen eller sökningen) — det gäller.
  if (hintCardId && opts.confirmed) {
    const confirmed = await linkByCardId(hintCardId);
    if (confirmed) return confirmed;
  }

  if (hintCardId) {
    const hinted = await linkByCardId(hintCardId);
    if (hinted && (!name || normName(hinted.name).includes(normName(name)) || normName(name).includes(normName(hinted.name)))) {
      return hinted;
    }
  }

  // Numret ÄR identiteten här — se filhuvudet. Inget nummer, ingen bild.
  if (!name || !number) return null;
  const setHint = (cardName ?? "").split(" · ").slice(1).join(" ") || null;

  const direct = await linkByNumber(cardName ?? "", name, number, setHint, false);
  if (direct) return direct;

  // BILDEN + TEXTEN (2026-10-01): bildmatchningen på framsidan gav en topplista;
  // pekar modellens namn OCH nummer ut ett av de korten är identiteten styrkt två
  // gånger om — även när numrets FORMAT inte går att slå upp ("SVP 132" mot "132").
  if (opts.artCardIds?.length) {
    const byArt = await linkByArtCandidates(opts.artCardIds, name, number);
    if (byArt) return byArt;
  }

  // PROMOKOD FRAMFÖR NUMRET (ägarens fältrapport 2026-10-01): modellen läser det som
  // står tryckt — "SVP 132", "SWSH 034" — medan katalogen numrerar flera promoset med
  // bara siffrorna ("132"). Med koden kvar fick matchningen inte ens fram rätt kort,
  // så fyra graderingar av samma Greninja ex blev utan bild och utan värde.
  // Andra försöket: bara siffrorna, och BARA kort ur ett promoset — annars hade
  // "SVP 132" kunnat bli #132 i vilket set som helst.
  const promo = /^([A-Za-z]{2,5})\s?0*(\d{1,4})$/.exec(number);
  if (promo) return linkByNumber(cardName ?? "", name, promo[2], setHint, true);
  return null;
}

async function linkByNumber(
  rawText: string,
  name: string,
  number: string,
  setHint: string | null,
  promoSetsOnly: boolean
): Promise<GradedCardLink | null> {
  const parsed = parseGuessedNumber(number);
  if (!parsed) return null;
  const all = await matchCards({
    rawText,
    guessedName: name,
    guessedNumber: number,
    // Vi har ingen bild och ingen OCR-konfidens här — strängen är allt vi fick.
    // Konfidensen används bara för att gradera skannerns egna träffar; identiteten
    // avgörs av nummerkravet nedan.
    confidence: 0,
  });
  const candidates = promoSetsOnly ? all.filter((c) => isPromoSet(c.setName)) : all;
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
    language: top.language,
  };
}

/**
 * Bildmatchningens kandidater mot modellens namn + nummer. Numret jämförs på
 * SIFFRORNA (promokoden och nollorna bort) — kandidaten är redan utpekad av bilden,
 * så formatet behöver inte bära identiteten ensamt. Namnet måste ändå stämma.
 */
async function linkByArtCandidates(
  artCardIds: string[],
  name: string,
  number: string
): Promise<GradedCardLink | null> {
  const digits = (x: string) => (x.match(/\d+/g)?.join("") ?? "").replace(/^0+/, "");
  const want = digits(number.split(/[/／]/)[0]);
  if (!want) return null;
  const cards = await prisma.card.findMany({
    where: { id: { in: artCardIds.slice(0, 5) } },
    select: { id: true, name: true, number: true },
  });
  const hits = cards.filter(
    (c) =>
      digits(c.number) === want &&
      (normName(c.name).includes(normName(name)) || normName(name).includes(normName(c.name)))
  );
  // Två olika kort med samma namn och nummer i topplistan = vi vet inte vilket.
  if (hits.length !== 1) return null;
  return linkByCardId(hits[0].id);
}

/** "Scarlet & Violet Black Star Promos", "SWSH Black Star Promos", "Wizards Black Star Promos" … */
export function isPromoSet(setName: string): boolean {
  return /\bpromos?\b/i.test(setName);
}

/** Katalogkortet för ett känt kort-id, i samma form som matchningens träffar. */
export async function linkByCardId(cardId: string): Promise<GradedCardLink | null> {
  // DIREKT ur katalogen (2026-10-01). Förut gick uppslaget via `matchCards` och
  // krävde att kortet fanns i dess topplista för namn + nummer — Wizards-promot
  // "Articuno 22" gjorde det inte, så ett BEKRÄFTAT kort-id gav ändå ingen koppling.
  const card = await prisma.card.findUnique({
    where: { id: cardId },
    select: {
      id: true,
      name: true,
      number: true,
      imageUrl: true,
      language: true,
      set: { select: { name: true } },
      // Ordinarie tryckning först (etikettlös), dolda produkter aldrig.
      products: {
        where: { hiddenAt: null },
        select: { slug: true, variantLabel: true, imageUrl: true },
      },
    },
  });
  if (!card) return null;
  // Appens visningsordning: ordinarie, sedan Unlimited → Shadowless → 1st Edition,
  // sist reverse-familjen. Base har ingen etikettlös produkt — utan rangordningen
  // blev Charizard #4 en slumpvis tryckning (mätt: Shadowless).
  const product =
    [...card.products].sort((a, b) => variantDisplayRank(a.variantLabel) - variantDisplayRank(b.variantLabel))[0] ??
    null;
  return {
    cardId: card.id,
    imageUrl: card.imageUrl ?? product?.imageUrl ?? null,
    name: card.name,
    setName: card.set.name,
    number: card.number,
    slug: product?.slug ?? null,
    language: card.language,
  };
}
