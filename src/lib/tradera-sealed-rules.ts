/**
 * ÄR TRADERA-ANNONSEN FORTFARANDE DEN KOMPLETTA, FÖRSEGLADE VARAN? — utan AI (2026-10-14, ägarbeslut:
 * samma linje som skannern). Ersätter LLM-domens `sealedComplete`. Ren, testad.
 *
 * Läser titel + beskrivning (GetItem) på svenska, danska, norska och engelska. Returnerar ett skäl när
 * annonsen BEVISLIGEN inte är den förseglade varan (öppnad, tom, bara asken, saknar innehåll,
 * omförseglad, kopia), annars null. ⛔ Ett ord som NEKAS ("oöppnad", "ej öppnad", "aldrig öppnad",
 * "uåbnet", "unopened", "saknar inget") är motsatsen och får aldrig fälla annonsen.
 * ⛔ Kosmetiska skavanker (buckla, repa, veck, solblekt) på en förseglad vara är INTE ett fel —
 * samma regel som LLM-prompten hade.
 */

/** Bokstav enligt Unicode — JS `\b` räknar inte å/ä/ö som ordtecken. */
const L = "\\p{L}";
const word = (body: string) => new RegExp(`(?<![${L}])(?:${body})(?![${L}])`, "iu");

/** Ord som vänder betydelsen när de står strax före (inom två ord). */
const NEGATORS = "ej|inte|icke|aldrig|ingen|inget|inga|utan|uden|uten|ikke|aldri|not|never|no|non|un|without|0";

function negated(text: string, index: number): boolean {
  const before = text.slice(Math.max(0, index - 40), index).toLowerCase();
  // Trasig teckenkodning: "oöppnad" kommer ibland som "o o ppnad" — det inledande "o" ÄR nekningen.
  if (/(?:^|\s)o\s?$/.test(before)) return true;
  return new RegExp(`(?<![${L}])(?:${NEGATORS})(?:\\s+[${L}-]+){0,2}\\s*$`, "iu").test(before);
}

/**
 * Butikens VILLKOR, inte varans skick (granskningsfacit 2026-10-14): "Öppnad vara ersätts inte",
 * "fått tillbaka öppnade varor", "Saknar du något särskilt kort?".
 */
function boilerplate(text: string, index: number, hit: string): boolean {
  const around = text.slice(index, index + hit.length + 30).toLowerCase();
  const after = text.slice(index + hit.length, index + hit.length + 60).toLowerCase();
  const before = text.slice(Math.max(0, index - 12), index).toLowerCase();
  return (
    /^(?:öppnad|öppnade|opened)\s+(?:vara|varor|produkt\w*|items?|goods)/u.test(around) ||
    /^saknar du/u.test(around) ||
    // Returvillkor och demonstrationer: "Öppnad boosterpack = förbrukad ångerrätt",
    // "(ett öppnat paket demonstreras i annonsen)".
    /ångerrätt|ersätts|återköp|returrätt|refund|demonstrer|förbrukad/u.test(after) ||
    // Säljaren öppnade en ANNAN vara och säljer paketen ur den: "Jag öppnade precis Booster boxen".
    /jag\s+$/u.test(before)
  );
}

/** Första icke-nekade träffen av mönstret (som inte är butiksvillkor), eller null. */
function firstHit(text: string, re: RegExp): string | null {
  const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
  for (const m of text.matchAll(g)) {
    const i = m.index ?? 0;
    if (!negated(text, i) && !boilerplate(text, i, m[0])) return m[0];
  }
  return null;
}

const OPENED = word(
  // ⛔ Inga former för trasig teckenkodning ("o ppnad"): MÄTT — "Oöppnad" kommer lika ofta som
  //    "O ppnad", dvs formen är tvetydig och fällde 15+ helt förseglade annonser.
  "öppnad|öppnat|öppnade|oppnad|oppnat|uppöppnad|uppbruten|" +
    "(?:korten|kort) (?:är |har )?(?:redan )?(?:direkt )?(?:lagda|lagts|satta) i (?:fick\w*|pärm\w*|plastfick\w*)|" +
    "bruten (?:försegling|plast|plastfilm)|" +
    "åbnet|åbnede|åpnet|åpna|opened|unsealed|seal (?:is )?broken|broken seal|ripped seal|resealed|" +
    "seal brudt|brudt (?:seal|forsegling|plast)|uden (?:folie|plast)|uten (?:folie|plast)|utan folie|" +
    "omförseglad|omförseglat|ompackad|"
    + "plasten (?:är )?(?:borta|borttagen|avtagen|trasig|sönder)|utan plast|without (?:the )?(?:plastic|shrink ?wrap)"
);
const EMPTY = word(
  "tom(?:ma|t)? (?:ask|låda|box|boxen|tin|burk|förpackning|kartong|etb|display)|" +
    "endast (?:ask(?:en)?|låd(?:a|an)|förpackning(?:en)?|kartong(?:en)?|box(?:en)?|tin(?:en)?|display(?:en)?)|" +
    "bara (?:ask(?:en)?|låd(?:a|an)|förpackning(?:en)?|kartong(?:en)?|box(?:en)?|tin(?:en)?|display(?:en)?)|" +
    "utan (?:innehåll|boosters?|boosterpaket|paket|kort(?:en)?)|empty (?:box|tin|case|display|etb)|box only|tin only|" +
    "tom(?:me)? (?:æske|boks|eske)|kun (?:æske(?:n)?|boks(?:en)?|eske(?:n)?)|uden indhold|uten innhold|" +
    "indeholder ikke|inneholder ikke|innehåller inga kort|säljer ej|säljes ej|säljer inte|sælges ikke|not for sale"
);
/**
 * SKADAD PLAST (granskningsfacit 2026-10-14): ett hål/en reva i förseglingsplasten = inte längre
 * fabriksförseglad. ⛔ Fabrikens små ventilhål i HÖRNEN räknas inte ("hålen från fabrik", "corners").
 * Kartongskador (buckla, "buk i pappet") är kosmetiska och fäller aldrig.
 */
const PLASTIC_DAMAGE = word(
  "(?:hål|hålet|h l|hul|hullet|reva|revor|rip|rips|brud|tear|hole|holes|skada|skade|öppning)" +
    "(?:\\s+[\\p{L}]+){0,4}\\s+(?:i|in|på|on|ved)\\s+(?:the\\s+)?(?:plast(?:en)?|folie(?:n)?|sealing(?:en)?|plastic|shrink(?:wrap)?|seal(?:et)?)|" +
    "lillebitte brud|(?:liten|lille) (?:reva|rip|brud)|tear in the plastic|" +
    "seal is not (?:so )?tight|not the best seal|småhål|små hål(?! från)|løse? folie|lösa? folie|loose (?:seal|foil|shrink)"
);
const PLASTIC_OK = /(?:från fabrik|fra fabrik|factory|tillverkning|manufactur|i hörnen|at the corners|inga hål|inga synbara|ingen reva|inga revor|uden rips|uden huller|0 holes|no holes)/iu;

const MISSING = word("saknar|saknas|missing|mangler|ofullständig|inte komplett|incomplete|ej komplett");
const FAKE = word("proxy|proxies|kopia|kopior|replica|fake|förfalskad|förfalskning|repro|reproduktion|custom made|inofficiell");

export function sealedListingProblem(title: string, description: string | null | undefined): string | null {
  const text = `${title}\n${description ?? ""}`;
  const opened = firstHit(text, OPENED);
  if (opened) return `öppnad/oförseglad ("${opened}")`;
  const empty = firstHit(text, EMPTY);
  if (empty) return `tom/endast förpackningen ("${empty}")`;
  const damage = firstHit(text, PLASTIC_DAMAGE);
  if (damage) {
    const at = text.toLowerCase().indexOf(damage.toLowerCase());
    const around = text.slice(Math.max(0, at - 60), at + damage.length + 60);
    if (!PLASTIC_OK.test(around)) return `skadad förseglingsplast ("${damage}")`;
  }
  const fake = firstHit(text, FAKE);
  if (fake) return `inte äkta ("${fake}")`;
  // "saknar" bara när det gäller INNEHÅLLET — "saknar repor" är ett plus, inte ett fel.
  const missing = firstHit(text, MISSING);
  if (missing) {
    const at = text.toLowerCase().indexOf(missing.toLowerCase());
    const tail = text.slice(at, at + 60).toLowerCase();
    if (/(booster|paket|pack|kort|card|innehåll|content|promo|tärning|dice|sleeve|delar|del )/.test(tail)) {
      return `saknar innehåll ("${text.slice(at, at + 40).trim()}")`;
    }
  }
  return null;
}
