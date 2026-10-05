/**
 * BUTIKSNYHETER FRÅN INSTAGRAM — domen "är det här ett släppbesked om Pokémon?".
 *
 * Ren och testad (`tests/unit/store-social-filter.test.ts`, fixturerna är riktiga
 * butiksinlägg ur proben 2026-10-05). INGEN AI med flit (ägarbeslut): reglerna är
 * ord, och ett missat inlägg kostar mindre än en kanal folk slutar läsa.
 *
 * Tre frågor, alla måste svara rätt:
 *   1. POKÉMON? — i brödtexten, eller i hashtaggarna om inget annat kortspel nämns.
 *      Butikerna taggar #pokemon på allt (One Piece-släpp, mässinlägg), så en ensam
 *      hashtagg räknas bara när inlägget inte samtidigt handlar om ett annat spel.
 *   2. SLÄPPBESKED? — släpp/förköp/i lager/försenat/köpgräns … (`RELEASE`).
 *   3. INTE BRUS? — graderingstjänster, öppningsvideor, spelkvällar, ligor, mässor
 *      (`NOISE`) fäller alltid; tävlingar (`CONTEST`) när de är inläggets ämne; ett
 *      annat kortspel i brödtexten (`OTHER_TCG`) fäller blandinlägg.
 *
 * ⛔ Lägg till ord här, aldrig regexar i lanen — och lägg samtidigt till det riktiga
 *    inlägget som fixtur, annars vet ingen vad regeln skulle fånga.
 */

/** Hashtaggar som står två eller fler i rad: taggblocket, inte en del av meningen. */
const HASHTAG_RUN = /(?:#[\p{L}\p{N}_]+[\s.]*){2,}/gu;
const HASHTAG = /#[\p{L}\p{N}_]+/gu;

const POKEMON = /pok[eé]mon|pikachu|\b30th\b|celebration|pok[eé]ball|first partner/i;

const OTHER_TCG =
  /one ?piece|\bop ?-?\d{1,2}\b|lorcana|\bmagic\b|\bmtg\b|yu-?gi-?oh|star ?wars|riftbound|digimon|dragon ?ball|gundam|flesh and blood|cyberpunk|hobbit|union arena|weiss|altered/i;

const RELEASE = new RegExp(
  [
    "släpp", // släpp, släpper, släpps, släppet, släppdag
    "release",
    "lansering",
    "lanseras",
    "förköp",
    "förbok",
    "förhandsbok",
    "förbeställ",
    "pre-?order",
    "\\bi lager",
    "på lager",
    "finns nu",
    "finns att köpa",
    "finns kvar",
    "produkter kvar",
    "till salu",
    "\\bsäljs\\b",
    "försäljning",
    "fått in",
    "får in",
    "fick in",
    "kommit in",
    "anlänt",
    "landar",
    "restock",
    "påfyllning",
    "fyllt på",
    "\\bdrop\\b",
    "försen",
    "skjuta på",
    "skjuter på",
    "uppskjut",
    "inte dykt upp",
    "tilldelning",
    "köpgräns",
    "\\d+ ?(?:st )?(?:per|/) ?(?:kund|person)",
    "max \\d+",
    "öppnar (?:vi )?(?:förhands|förbok|bokning)",
    "går live",
    "upp på hemsidan",
    "\\bi butik(?:en)?\\b",
    "nu kan (?:du|ni) (?:beställa|köpa|boka)",
    "begränsat antal",
    "snart är det dags",
    "har nu (?:ett par|några|\\d+)",
    "in stock",
    "available now",
    "out now",
    "delayed",
  ].join("|"),
  "i"
);

/**
 * TÄVLINGAR fäller bara när de är inläggets ÄMNE: i öppningen, eller utan ett enda
 * släppord. "På fredag landar 30th … (och så har vi en tävling)" är ett släppbesked;
 * "TÄVLING! Vinn en ETB" är det inte, även om ETB:n släpps samma dag.
 */
const CONTEST = /tävl|giveaway|\bvinn(?:a|er|are|aren)?\b|utlottning|lottning|lotteri/i;
const CONTEST_LEAD_CHARS = 120;

/** Allt annat brus fäller alltid — ämnet är något annat än ett släpp. Läses i brödtexten. */
const NOISE = new RegExp(
  [
    "\\bpsa\\b",
    "graderin",
    "graderade",
    "beckett",
    "\\bcgc\\b",
    "öppnar (?:vi )?(?:en|ett|hela)\\b",
    "box ?opening",
    "pack ?opening",
    "unboxing",
    "drar detta",
    "\\bpulls?\\b",
    "introduktion",
    "prova på",
    "lär dig spela",
    "lära sig spela",
    "league",
    "\\bliga\\b",
    "turnering",
    "pre-?release",
    "spelkväll",
    "casual",
    "festival",
    "game ?week",
    "mässa",
    "tillbehör",
  ].join("|"),
  "i"
);

export type StorePostVerdict =
  | { relevant: true; reason: string }
  | { relevant: false; reason: "no-pokemon" | "other-tcg" | "no-release" | "noise"; detail?: string };

/** Brödtexten = bildtexten utan taggblock; enstaka inline-taggar blir vanliga ord. */
export function captionBody(caption: string): string {
  return caption.replace(HASHTAG_RUN, " ").replace(/#/g, "").replace(/\s+/g, " ").trim();
}

function hashtags(caption: string): string {
  return (caption.match(HASHTAG) ?? []).join(" ");
}

/**
 * @param extraPokemonTerms setnamn ur ruttabellen ("Mega Dream ex", "Inferno X" …) —
 *   ett inlägg om "påfyllning av Inferno X" nämner aldrig ordet Pokémon.
 */
export function classifyStorePost(caption: string, extraPokemonTerms: readonly string[] = []): StorePostVerdict {
  const text = caption ?? "";
  const body = captionBody(text);
  const lowerBody = body.toLowerCase();

  // Brödtexten, inte taggarna: "#packopening" sitter under "151 Binder Collection now in stock".
  const noise = body.match(NOISE);
  if (noise) return { relevant: false, reason: "noise", detail: noise[0] };

  const pokemonInBody = POKEMON.test(body) || extraPokemonTerms.some((t) => lowerBody.includes(t));
  const pokemonInTags = POKEMON.test(hashtags(text));
  if (!pokemonInBody && !(pokemonInTags && !OTHER_TCG.test(text))) {
    return { relevant: false, reason: "no-pokemon" };
  }
  // Ett annat kortspel i brödtexten ⇒ blandinlägg ("Magic vs Pokémon", "OP och 30th").
  // Hellre ett missat blandinlägg än en kanal som också larmar om One Piece.
  const other = body.match(OTHER_TCG);
  if (other) return { relevant: false, reason: "other-tcg", detail: other[0] };

  const release = body.match(RELEASE);
  const contest = body.match(CONTEST);
  if (contest && (!release || (contest.index ?? 0) < CONTEST_LEAD_CHARS)) {
    return { relevant: false, reason: "noise", detail: contest[0] };
  }
  if (!release) return { relevant: false, reason: "no-release" };
  return { relevant: true, reason: release[0] };
}

/** Setnamn → söktermer: gemener, minst 5 tecken (kortare namn som "151" ger falsklarm). */
export function pokemonTermsFromSetNames(names: Iterable<string | null | undefined>): string[] {
  const out = new Set<string>();
  for (const n of names) {
    const t = n?.trim().toLowerCase();
    if (t && t.length >= 5) out.add(t);
  }
  return [...out];
}
