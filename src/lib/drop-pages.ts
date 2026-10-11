/**
 * DOLDA SLÄPP — KOD ELLER REBUS PÅ ORIGINALSIDAN (ägarbeslut 2026-10-11).
 *
 * Spelexperten och Dragon's Lair släpper heta varor via en DOLD produktsida: originalsidan
 * får en instruktion i beskrivningen och den köpbara sidan har en titel som inte liknar
 * varan, så varken feeden (kategori/kollektion) eller vakterna ser den.
 *  · KOD (Spelexperten, "SYL-01"): "skriver du artikelnumret nedan i sökrutan … SYL-01".
 *    Vi söker med koden i BUTIKENS EGEN sök och tar träffen vars artikelnummer ÄR koden —
 *    butiken avgör, så länken kan inte bli fel vara.
 *  · REBUS (Dragon's Lair): "I morgon ersätter vi texten med en enkel rebus …" — ingen kod
 *    att söka på. Vi postar rebusen (läsarna löser den) och letar samtidigt bland butikens
 *    NYASTE produkter efter en som matchar originalet på MINST TVÅ av: samma pris, samma
 *    bild, köpgräns i beskrivningen. Bara om EXAKT EN gör det postas länken.
 * Ren modul: ingen I/O, testad (tests/unit/drop-pages.test.ts).
 */

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  aring: "å",
  auml: "ä",
  ouml: "ö",
  Aring: "Å",
  Auml: "Ä",
  Ouml: "Ö",
  eacute: "é",
};

/** HTML → läsbar text: skript/stil bort, taggar → mellanslag, entiteter avkodade. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, name) => ENTITIES[name] ?? m)
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeCode(s: string): string {
  return s.toUpperCase().replace(/\s+/g, "");
}

export type DropInstruction =
  | { kind: "code"; code: string }
  | { kind: "riddle"; phase: "announced" | "live"; text: string };

/** Ord som pekar på en sökinstruktion; koden står strax efter. */
const CODE_ANCHOR = /(sökrutan|sökfältet|sök(?:er)? (?:du )?på|artikelnumret)/gi;
/** "SYL-01", "ETB-30TH", "AB12" — versaler/siffror, med bindestreck eller siffror i. */
const CODE_TOKEN = /\b([A-Z0-9]{2,}(?:-[A-Z0-9]{1,})+|[A-Z]{2,}[0-9]{2,})\b/;
/** Förhandsbeskedet ("I morgon ersätter vi texten med en enkel rebus") — inte rebusen själv. */
const ANNOUNCEMENT = /(i\s?morgon|imorgon|ersätter vi|kommer (?:vi )?att|inom kort)/i;
const RIDDLE_WORD = /\b(rebus|gåta|ledtråd)/i;

/**
 * Bär sidtexten en sök-/rebusinstruktion? `previous` = vad vi läste förra gången: en sida
 * som stod på FÖRHANDSBESKED och vars text sedan ändrats är rebusen LIVE — själva rebusen
 * behöver inte innehålla ordet "rebus".
 */
export function readDropInstruction(text: string, previous?: DropInstruction | null): DropInstruction | null {
  for (const m of text.matchAll(CODE_ANCHOR)) {
    const after = text.slice(m.index! + m[0].length, m.index! + m[0].length + 120);
    const code = after.match(CODE_TOKEN)?.[1];
    if (code) return { kind: "code", code: normalizeCode(code) };
  }
  if (RIDDLE_WORD.test(text)) {
    return { kind: "riddle", phase: ANNOUNCEMENT.test(text) ? "announced" : "live", text };
  }
  if (previous?.kind === "riddle" && previous.phase === "announced" && previous.text !== text) {
    return { kind: "riddle", phase: "live", text };
  }
  return null;
}

/** Ett kort utdrag ur rebustexten till inlägget (aldrig hela sidan). */
export function riddleExcerpt(text: string, max = 400): string {
  const t = text.trim();
  return t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}…`;
}

// ---- Spelexperten (iButik) -------------------------------------------------------------

/** "Artnr: POK10463-101-SYL" på produktsidan. */
export function spelexpertenArtnr(html: string): string | null {
  const m = htmlToText(html).match(/Artnr:?\s*([A-Za-z0-9][A-Za-z0-9-]*)/);
  return m ? normalizeCode(m[1]) : null;
}

/**
 * Produktlänkar i sökresultatet — BARA produktkorten (`PT_Beskr`, samma markup som
 * kategorisidan i SpelexpertenAdapter). Sidans meny bär dussintals andra .html-länkar.
 */
export function spelexpertenSearchLinks(html: string, base: string): string[] {
  const out = new Set<string>();
  for (const block of html.split(/class="PT_Beskr/i).slice(1)) {
    const m = block.slice(0, 2000).match(/<a href="((?:https?:\/\/[^"/]+)?\/[^"]+\.html)"/);
    if (m) out.add(m[1].startsWith("http") ? m[1] : `${base}${m[1]}`);
  }
  return [...out];
}

// ---- Matchning av en dold sida (rebusvägen) ---------------------------------------------

/** Bildens identitet: filnamnet utan sökväg, query och ändelse. */
export function imageKey(url: string): string {
  const base = url.split("?")[0].split("/").pop() ?? "";
  return base.replace(/\.[a-z0-9]+$/i, "").toLowerCase();
}

const PURCHASE_LIMIT = /(max\.?\s*\d+\s*(?:\/|per|st)?\s*(?:kund|hushåll|person)|köpgräns|per hushåll|1 per kund)/i;

export interface DropOriginal {
  url: string;
  priceOre: number | null;
  imageKeys: string[];
}

export interface HiddenCandidate {
  url: string;
  priceOre: number | null;
  imageKeys: string[];
  /** Beskrivning + titel som text. */
  text: string;
}

export function hiddenSignals(orig: DropOriginal, c: HiddenCandidate): string[] {
  const signals: string[] = [];
  if (orig.priceOre != null && orig.priceOre > 0 && c.priceOre === orig.priceOre) signals.push("pris");
  if (orig.imageKeys.length && c.imageKeys.some((k) => k && orig.imageKeys.includes(k))) signals.push("bild");
  if (PURCHASE_LIMIT.test(c.text)) signals.push("köpgräns");
  return signals;
}

/**
 * Den dolda sidan, eller null. ⛔ MINST TVÅ signaler OCH exakt en kandidat som har dem —
 * ett pris ensamt är för lätt att träffa av en slump, och två lika bra kandidater är en
 * gissning. Hellre rebusen ensam i kanalen än fel vara.
 */
export function pickHiddenCandidate(
  orig: DropOriginal,
  candidates: readonly HiddenCandidate[]
): { candidate: HiddenCandidate; signals: string[] } | null {
  const strong = candidates
    .filter((c) => c.url !== orig.url)
    .map((c) => ({ candidate: c, signals: hiddenSignals(orig, c) }))
    .filter((x) => x.signals.length >= 2);
  return strong.length === 1 ? strong[0] : null;
}
