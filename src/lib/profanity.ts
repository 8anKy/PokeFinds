/**
 * ORDFILTER FÖR FORUMET (ägarbeslut 2026-09-05: "no bad words can be written").
 *
 * Blockerar vid SKRIVNING — trådar och svar med ett träffat ord publiceras inte,
 * och ingenting maskeras (ett "f***" i ett publikt forum är samma ord för alla
 * som läser). Domen är ren och körs på servern; klienten visar bara beskedet.
 *
 * ⛔ LISTAN ÄR MEDVETET SMAL: grova könsord, slurs och de tydligaste svordomarna
 * på svenska och engelska. Vardagsord som råkar vara svordomar är UTELÄMNADE
 * med flit — "fan" (supporter), "skit-" som förstärkning ("skitbra"), "prick"
 * (punkt), "kiss", "hell", "damn". Ett filter som stoppar "Pokémon-fan" är värre
 * än ett som släpper igenom ett "fan". Lägg till ord här, aldrig i regexar i
 * rutterna.
 *
 * MATCHNING: texten normaliseras (gemener, diakritiska tecken strippade så att
 * "jävla" och "javla" är samma ord, leetspeak → bokstäver där de står i ett ord)
 * och delas i ord. Ett ord fälls om det finns exakt i listan eller börjar på
 * en stam (sammansättningar: "kukhuvud", "fittstim"). Fyra slurs fälls även som
 * delsträng i den hopslagna texten så att "n i g g e r" inte slinker igenom.
 */

/** Hela ord, efter normalisering (inga diakritiska tecken). */
const EXACT = new Set<string>([
  // svenska
  "fitta", "fittan", "fittor", "fittorna",
  "kuk", "kuken", "kukar", "kukarna", "kuksugare",
  "hora", "horan", "horor", "hororna", "horunge", "horungar",
  "javla", "javlar", "javel", "javlarna", "djavla", "djavlar", "djavel",
  "helvete", "helvetes",
  "knulla", "knullar", "knullad", "knullade",
  "neger", "negern", "negrer", "negrerna",
  "svartskalle", "svartskallar", "blatte", "blattar", "blatten",
  "mongo", "mongot", "cp-skadad",
  "rovhal", "rovhalet",
  // engelska
  "fuck", "fucks", "fucked", "fucking", "fucker", "fuckers", "motherfucker", "motherfuckers",
  "shit", "shits", "shitty", "bullshit",
  "bitch", "bitches", "asshole", "assholes", "dumbass", "jackass",
  "cunt", "cunts", "dick", "dickhead", "dickheads", "cock", "cocks", "cocksucker",
  "pussy", "whore", "whores", "slut", "sluts",
  "nigger", "niggers", "nigga", "niggas", "faggot", "faggots", "fag", "fags",
  "retard", "retarded", "retards", "wanker", "wankers", "twat", "twats",
  "bastard", "bastards", "douchebag", "douche",
]);

/** Stammar: ett ord som BÖRJAR så här fälls (sammansättningar och böjningar). */
const STEMS = [
  "fitt", "kukhuvud", "kuksug", "horung", "knull", "neger", "svartskall", "helvet",
  "motherfuck", "cocksuck", "dickhead", "bullshit",
];

/** Fälls som delsträng i texten utan mellanslag — så att särskrivning inte hjälper. */
const STRONG_SUBSTRINGS = ["nigger", "nigga", "faggot", "motherfuck"];

const LEET: Record<string, string> = {
  "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "@": "a", "$": "s", "!": "i", "|": "l",
};

function isLetter(ch: string | undefined): boolean {
  return ch !== undefined && /[a-z]/.test(ch);
}

/** Gemener, inga diakritiska tecken, leetspeak → bokstäver INNE i ord. */
export function normalizeForProfanity(text: string): string {
  const base = text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ß/g, "ss");
  let out = "";
  for (let i = 0; i < base.length; i++) {
    const ch = base[i];
    const leet = LEET[ch];
    // BARA mellan två bokstäver ("sh!t", "f4n"). Ett "!" efter ordet är skiljetecken —
    // annars blev "Fuck!" → "fucki" och slank förbi exakt-listan.
    if (leet && isLetter(base[i - 1]) && isLetter(base[i + 1])) out += leet;
    else out += ch;
  }
  return out;
}

/**
 * Första otillåtna ordet i texten (normaliserat), eller null när texten är ren.
 * Returvärdet är till för loggar och tester — visa aldrig ordet för användaren
 * som en "rättelse"; beskedet i gränssnittet är generiskt.
 */
export function findProfanity(text: string): string | null {
  if (!text) return null;
  const norm = normalizeForProfanity(text);
  const words = norm.split(/[^a-z]+/).filter(Boolean);
  for (const w of words) {
    if (EXACT.has(w)) return w;
    for (const stem of STEMS) if (w.startsWith(stem)) return w;
  }
  const joined = words.join("");
  for (const s of STRONG_SUBSTRINGS) if (joined.includes(s)) return s;
  return null;
}

export function containsProfanity(text: string): boolean {
  return findProfanity(text) !== null;
}

/** Felkoder som API:t skickar med (`ServiceError.code`) så klienten kan översätta. */
export const PROFANITY_CODE = "PROFANITY";
export const FORUM_RULES_CODE = "FORUM_RULES";
