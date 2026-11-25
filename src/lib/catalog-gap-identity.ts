/**
 * KATALOGLUCKOR — rena identitetsregler för de två importerna som fyller kort
 * prisleverantören eller Cardmarket har men vi saknar (2026-10-15):
 *   · scripts/import-en-set-from-provider.ts --new-episodes (Prize Pack-seten m.fl.)
 *   · scripts/import-cm-only-singles.ts (Additionals, startdäck, WCD, bollmönster)
 * Inga DB-anrop här — testas i tests/unit/catalog-gap-identity.test.ts.
 */
import { cmNumberKey, fromIsOutlierAsk } from "@/jobs/cardmarket-refresh";
import {
  VARIANT_DUSK_BALL, VARIANT_FRIEND_BALL, VARIANT_LOVE_BALL, VARIANT_MASTER_BALL, VARIANT_POKE_BALL,
  VARIANT_QUICK_BALL, VARIANT_REVERSE_HOLO, VARIANT_ROCKET,
} from "@/lib/print-variant";

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

/**
 * MÖNSTER-EXPANSIONER i specialset (2026-10-23): "Ascended Heroes - Ball & Rocket Reverse Holo" och
 * "… - Energy Reverse Holo" (MEGA Dream ex likadant). Här bär expansionen bara FAMILJEN — VILKET
 * mönster kortet har står i blueprintens version ("Love Ball Reverse Holo", CT:s stavfel "PoKé Ball",
 * "Reverse Friend Ball Holo"). Energy-mönstret är setets vanliga reverse holo. Okänt mönster ⇒ null.
 */
export function patternExpansion(name: string, version: string | null | undefined): { set: string; label: string } | null {
  const ball = ballExpansion(name);
  if (ball) return ball;
  const m = /^(.*?) - (Ball & Rocket|Energy) Reverse Holo$/i.exec(name.trim());
  if (!m) return null;
  const v = String(version ?? "").toLowerCase();
  const label =
    /master\s*ball/.test(v) ? VARIANT_MASTER_BALL
    : /quick\s*ball/.test(v) ? VARIANT_QUICK_BALL
    : /love\s*ball/.test(v) ? VARIANT_LOVE_BALL
    : /friend\s*ball/.test(v) ? VARIANT_FRIEND_BALL
    : /dusk\s*ball/.test(v) ? VARIANT_DUSK_BALL
    : /pok[eé]\s*ball/.test(v) ? VARIANT_POKE_BALL
    : /rocket/.test(v) ? VARIANT_ROCKET
    : /energy/.test(v) && /^energy$/i.test(m[2]) ? VARIANT_REVERSE_HOLO
    : null;
  return label ? { set: m[1].trim(), label } : null;
}

const SET_STOPWORDS =new Set(["pokemon", "tcg", "the", "and", "ex", "set", "collection", "card", "game", "of", "sub"]);

/** Setnamnets innehållsord, singular: "Holon Phantoms" → {holon, phantom}. */
export function setTokens(name: string): Set<string> {
  return new Set(
    name
      // Koden i parentes ("DP Promos (DP-P)") är inget innehållsord — utan det missade
      // vakten 2026-10-15 fem japanska set vi redan hade (23 dubbletter, städade).
      .replace(/\([^)]*\)/g, " ")
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

/**
 * JAPANSKT NUMMERHÅL (2026-11-25): etiketten är bara en SÄLLSYNTHET ("Ultra Rare", "Full-Art",
 * "Gold Secret Rare") — då är blueprinten setets vanliga kort på sitt nummer, ingen egen
 * tryckning. CardTrader sätter sällsyntheten i versionsfältet på V/VSTAR/Radiant-korten, och
 * regeln "etikett ⇒ eget kort" höll därför 58 ordinarie VSTAR Universe-kort utanför katalogen.
 * ⛔ Stämplar, "Prerelease", "Cosmos Holo", mönster m.m. är INTE sällsyntheter — de faller.
 */
const RARITY_WORD =
  /^(common|uncommon|rare|holo|non-holo|promo|ultra|secret|shiny|gold|hyper|rainbow|double|triple|illustration|special|art|full[- ]art|character|super|amazing|radiant|ace spec|trainer gallery|k|a|h|r|rr|rrr|sr|ur|hr|ar|sar|csr|chr|s|ss|ssr|tr|pr)$/;
export function isRarityOnlyLabel(label: string): boolean {
  const words = label.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0 || words.length > 4) return false;
  // "Holo" / "Non-Holo" ENSAMT är två tryckningar av samma nummer i äldre set — ingen sällsynthet.
  if (/^(holo|non-holo)$/.test(words.join(" "))) return false;
  // "full art" / "ace spec" / "trainer gallery" är två ord — pröva paren först.
  const joined = words.join(" ").replace(/\bfull art\b/g, "full-art").replace(/\bace spec\b/g, "ace_spec").replace(/\btrainer gallery\b/g, "trainer_gallery");
  return joined.split(" ").every((w) => RARITY_WORD.test(w.replace("_", " ")));
}

/**
 * Inom en Cardmarket-expansion ligger id:n i NUMMERORDNING (verifierat 2026-08-30, jp-sets.md).
 * Ett id passar numret när närmaste LÄNKADE granne nedåt bär ett lägre id och närmaste uppåt ett
 * högre — och BÅDA grannarna finns. Används som bevis när CardTraders namn inte håller med
 * Cardmarkets (CT bär italienska tränarnamn: "Petra" = Roxanne): numret + ordningen avgör då,
 * och namnet tas från Cardmarket.
 */
export function cmIdFitsNumberOrder(n: number, idProduct: number, linkedByNumber: Map<number, number>, requireBoth = true): boolean {
  let below: number | null = null, above: number | null = null;
  let belowN = -Infinity, aboveN = Infinity;
  for (const [num, id] of linkedByNumber) {
    if (num < n && num > belowN) { belowN = num; below = id; }
    if (num > n && num < aboveN) { aboveN = num; above = id; }
  }
  // `requireBoth: false` (namnen håller redan med): en saknad granne är inget motbevis, en granne
  // på fel sida är det.
  if (requireBoth && (below == null || above == null)) return false;
  return (below == null || below < idProduct) && (above == null || idProduct < above);
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

/**
 * PRIS FÖR KORT SOM BARA FINNS PÅ CARDMARKET (ägaren 2026-10-15: "de har ett Near Mint
 * From-pris men visas som uppskattat"). Prisleverantören har inte de här produkterna, så
 * den enda CM-källan är prisguiden. Dess `low` = Cardmarkets lägsta annons för PRODUKTEN —
 * det "From" CM:s produktsida visar (Marnie's Morpeko svOM 020: low 13,38 € = sidans From).
 * Regeln "aldrig guidens low" gäller vanliga kort, där produkten bär annonser på ALLA språk
 * (en tysk/japansk kopia blir golvet). De här produkterna är var och en EN språkutgåva (JP-
 * startdäck, engelska stämplar, bollmönster), så språkfelet finns inte; kvar är skicket.
 * Därför en rimlighetsvakt, men BARA för kort värda något: under `CM_ONLY_GUARD_FROM_EUR` (2 €)
 * är low verklighetens From (0,02 € för en common), och mätt 2026-10-15 gick 81 % av de
 * fällda till just sådana kort. Från 2 € måste low vara minst `CM_ONLY_LOW_MIN_SHARE` (50 %)
 * av det LÄGSTA av försäljningssnitten (trend/avg30/avg7). Fälld ⇒ uppskattning (median av
 * trend/avg/avg30).
 * ⛔ `low` är lägsta annons i ALLA SKICK — guiden har inget NM-golv. 25 % släppte igenom ett
 * Poor-exemplar som pris (Ancient Mew 19,95 € mot försäljningar 78–110 €, visad 221 kr; ägaren
 * 2026-10-23: "221 kr är Poor, Near Mint är ~1 182 kr"). 50 % ⇒ uppskattningen 108,98 €.
 * ⛔ UTROPSVAKTEN GÄLLER ÄVEN HÄR (2026-11-25): vakten ovan fångar bara en FÖR LÅG low. En low
 * långt ÖVER allt som säljs gick rakt igenom — Rare Candy · League Promos 2 000 € mot försäljningar
 * ≤ 65,89 € visades som 22 480 kr, Kiawe (JP) 49,99 € mot 0,20 €. Samma regel som singlarna
 * (ägarbeslut 2026-10-12/16: > 10x högsta försäljningssnittet OCH > 25 € över, minst två snitt,
 * `fromIsOutlierAsk`) ⇒ uppskattning. Mätt: 23 av 9 411 levande priser, ingen ägd post.
 * En ENSAM annons utan något försäljningssnitt döms INTE — det finns inget att döma mot.
 */
export const CM_ONLY_LOW_MIN_SHARE = 0.5;
export const CM_ONLY_GUARD_FROM_EUR = 2;
export function cmOnlyGuidePrice(g: {
  low?: number | null; trend?: number | null; avg?: number | null; avg30?: number | null; avg7?: number | null;
  avg1?: number | null;
} | null | undefined): { eur: number; live: boolean } | null {
  if (!g) return null;
  const pos = (v: number | null | undefined) => (typeof v === "number" && v > 0 ? v : null);
  const refs = [pos(g.trend), pos(g.avg), pos(g.avg30)].filter((v): v is number => v != null).sort((a, b) => a - b);
  const mid = refs.length ? (refs.length % 2 ? refs[refs.length >> 1] : (refs[refs.length / 2 - 1] + refs[refs.length / 2]) / 2) : null;
  const low = pos(g.low);
  const sales = [pos(g.trend), pos(g.avg30), pos(g.avg7)].filter((v): v is number => v != null);
  const floor = sales.length ? Math.min(...sales) : null;
  const outcry = fromIsOutlierAsk(low, [g.trend, g.avg, g.avg1, g.avg7, g.avg30]);
  if (low != null && !outcry && (floor == null || (pos(g.trend) ?? 0) < CM_ONLY_GUARD_FROM_EUR || low >= CM_ONLY_LOW_MIN_SHARE * floor))
    return { eur: low, live: true };
  // ⛔ En uppskattning kräver en FÖRSÄLJNINGSSIGNAL (trend/avg30/avg7). Ett ensamt `avg` utan
  // annonser och utan affärer är inget pris: Pikachu XY-P7af (JP, idProduct 554270) hade bara
  // avg = 100 000 € och visades som 1 118 000 kr (2026-10-16). Hellre "–".
  if (!sales.length) return null;
  return mid != null ? { eur: mid, live: false } : null;
}
