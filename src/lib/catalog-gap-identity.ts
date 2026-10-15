/**
 * KATALOGLUCKOR — rena identitetsregler för de två importerna som fyller kort
 * prisleverantören eller Cardmarket har men vi saknar (2026-10-15):
 *   · scripts/import-en-set-from-provider.ts --new-episodes (Prize Pack-seten m.fl.)
 *   · scripts/import-cm-only-singles.ts (Additionals, startdäck, WCD, bollmönster)
 * Inga DB-anrop här — testas i tests/unit/catalog-gap-identity.test.ts.
 */
import { cmNumberKey } from "@/jobs/cardmarket-refresh";

export type GapLanguage = "EN" | "JP";

/**
 * Titel som import-tcg-data: "Namn · Set N/Total", utan "/Total" när nämnaren är okänd
 * — och utan när numret REDAN bär en ("10/132" i Prize Pack-seten: originalsetets tal).
 */
export function enProductTitle(name: string, setName: string, number: string, printedTotal: number | null): string {
  const denom = printedTotal && printedTotal > 0 && !number.includes("/") ? `/${printedTotal}` : "";
  return `${name} · ${setName} ${number}${denom}`;
}

/**
 * Bär episodens kort ORIGINALSETETS nummer ("10/132")? Då är leverantörens
 * cards_printed_total inte talet på korten, och setets `totalCards` (talet skannern
 * läser) måste vara 0 = okänt — annars pekar skannerns setgissning fel.
 */
export function numbersCarryOwnTotal(numbers: (string | number | null)[]): boolean {
  const withSlash = numbers.filter((n) => String(n ?? "").includes("/")).length;
  return numbers.length > 0 && withSlash / numbers.length >= 0.5;
}

/** CardTrader-blueprintets språk ur `pokemon_language`-standardvärdet; null = utanför katalogpolicyn. */
export function blueprintLanguage(bp: {
  editable_properties?: { name: string; default_value?: string | null }[] | null;
}): GapLanguage | null {
  const v = bp.editable_properties?.find((p) => p.name === "pokemon_language")?.default_value?.toLowerCase();
  return v === "en" ? "EN" : v === "jp" ? "JP" : null;
}

/** Expansioner vars NAMN säger ett annat språk (CardTraders standard är "en" även för McDonald's 2018 French). */
export const NON_EN_JP_EXPANSION = /\b(French|German|Italian|Spanish|Portuguese|Korean|Chinese|Thai|Indonesian)\b/i;

/**
 * CardTraders versionsfält → vår etikett. "Destined Rivals Stamp | 229/159" →
 * "Destined Rivals Stamp"; delar som bara är nummer faller bort. "" = vanlig tryckning.
 */
export function versionLabel(version: string | null | undefined): string {
  return String(version ?? "")
    .split("|")
    .map((s) => s.trim())
    .filter((s) => s && !/^[#\d]/.test(s))
    .join(" · ");
}

/** Samlarnummer → jämförbar nyckel; "002/110" → "2" (nämnaren är inte numret). */
export function numberKey(n: string | null | undefined): string {
  return cmNumberKey(String(n ?? "").replace(/\/.*$/, ""));
}

/** "Prismatic Evolutions - Poké Ball Reverse Holo" → { set, label } för bollmönstren. */
export function ballExpansion(name: string): { set: string; label: string } | null {
  const m = /^(.*?) - (Poké Ball|Master Ball) Reverse Holo$/i.exec(name.trim());
  return m ? { set: m[1].trim(), label: `${m[2]} Reverse Holo` } : null;
}

const SET_STOPWORDS = new Set(["pokemon", "tcg", "the", "and", "ex", "set", "collection", "card", "game", "of", "sub"]);

/** Setnamnets innehållsord, singular: "Holon Phantoms" → {holon, phantom}. */
export function setTokens(name: string): Set<string> {
  return new Set(
    name
      .toLowerCase()
      .normalize("NFD")
      .replace(/[^a-z0-9 ]/g, " ")
      .split(/\s+/)
      .map((w) => w.replace(/s$/, ""))
      .filter((w) => w && !SET_STOPWORDS.has(w))
  );
}

/**
 * Är ett av VÅRA set samma utgåva som CT-expansionen, fast under annat namn?
 * Alla innehållsord i vårt setnamn finns i expansionens ("Generations" ⊂ "Radiant
 * Collection Generation", "Holon Phantoms" ⊂ "EX Holon Phantoms", "Unseen Forces" ⊂
 * "Unown sub-set Unseen Forces"). Ett namn av bara stoppord jämförs aldrig.
 */
export function setNameContained(ourSet: string, ctExpansion: string): boolean {
  const ours = setTokens(ourSet);
  if (ours.size === 0) return false;
  const theirs = setTokens(ctExpansion);
  return [...ours].every((w) => theirs.has(w));
}

/** Vilket set vinner rösterna? ≥ 3 röster och ≥ 80 % — annars null (avstå). */
export function winningSet(votes: Map<string, number> | undefined): string | null {
  if (!votes) return null;
  let best: string | null = null, bestN = 0, total = 0;
  for (const [id, n] of votes) {
    total += n;
    if (n > bestN) { best = id; bestN = n; }
  }
  return best && bestN >= 3 && bestN / total >= 0.8 ? best : null;
}
