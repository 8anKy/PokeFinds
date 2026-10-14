/**
 * MOTSÄGELSER MELLAN TRADERA-ANNONSEN OCH KATALOGPOSTEN (2026-10-14, ägarbeslut: ingen AI i Tradera-
 * kontrollen). Varje regel kommer ur ett handgranskat fall och är mätt mot facit
 * (scripts/tmp-rules-vs-key.ts) innan den lades till. Ren och testad; `setNames` = katalogens setnamn
 * (CardSet, läses en gång per körning).
 */
const L = "\\p{L}";

function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9& ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Eranamn som står som prefix i nästan alla titlar — säger inget om VILKET set. */
const ERA = new Set([
  "scarlet & violet", "sword & shield", "sun & moon", "xy", "black & white", "mega evolution", "heartgold & soulsilver",
  "diamond & pearl", "platinum", "base", "pokemon", "promos", "expansion", "shield", "sword", "scarlet", "violet",
]);
/** Erafraser stryks ur texten INNAN setnamn letas — "Mega Evolutions" är eran, inte setet Evolutions. */
const ERA_PHRASE = /mega evolutions?|sword (?:&|and )?shield|scarlet (?:&|and )?violet|sun (?:&|and )?moon|black (?:&|and )?white/g;
/** Eraprefix i ett setnamn ("HS Unleashed", "EX Deoxys") — katalogen skriver ofta bara "Unleashed". */
const SET_PREFIX = /^(?:hs|ex|xy|sm|bw|dp|pl|swsh|sv|me)\s+/;

/** Setnamnen som FINNS i en text — längsta först, och ett namn som ryms i ett längre som också står där räknas inte. */
function setsIn(text: string, setNames: readonly string[]): string[] {
  const t = ` ${norm(text).replace(ERA_PHRASE, " ")} `;
  const hits = setNames
    .map((s) => norm(s))
    .filter((s) => s.length >= 4 && !ERA.has(s) && t.includes(` ${s} `))
    .sort((a, b) => b.length - a.length);
  return hits.filter((s, i) => !hits.slice(0, i).some((longer) => longer.includes(s)));
}

const HAS_PACKS = new RegExp(`(?<![${L}])(?:booster\\w*|paket|pakker|pakke|packs?)(?![${L}])`, "iu");

export function listingContradiction(
  catalogTitle: string,
  catalogCategory: string,
  listingTitle: string,
  description: string | null | undefined,
  setNames: readonly string[] = []
): string | null {
  const desc = (description ?? "").replace(/<[^>]+>/g, " ").replace(/&nbsp;|&amp;|&#\d+;/g, " ");
  // Bara början: längre ned står ofta sökordslistor utan rubrik ("Gengar Pikachu Ascended heroes …").
  const head = desc.split(/sökord|søgeord|tags:|taggar|#pokemon/i)[0].slice(0, 170);
  const text = `${listingTitle}\n${desc}`;
  const cat = norm(catalogTitle);

  // SET: titeln eller beskrivningens början nämner ett ANNAT set och inte katalogens.
  // Bara set-bundna produkter: en samlarbox (Unova Heavy Hitters, UPC) innehåller paket ur ANDRA set.
  if (setNames.length && /^(?:BOOSTER_PACK|BOOSTER_BOX|ETB|BUNDLE)$/.test(catalogCategory)) {
    const catSets = setsIn(catalogTitle, setNames);
    const stem = (x: string) => x.replace(/s$/, "");
    const foreign = (s: string) =>
      !cat.includes(stem(s)) && !cat.includes(stem(s.replace(SET_PREFIX, ""))) && !catSets.some((c) => c.includes(stem(s)) || s.includes(stem(c)));
    const titleSets = setsIn(listingTitle, setNames);
    const other = titleSets.find(foreign);
    if (other && !titleSets.some((s) => !foreign(s))) return `annat set i titeln (${other})`;
    const headSets = setsIn(head, setNames);
    const otherHead = headSets.find(foreign);
    if (otherHead && !headSets.some((s) => !foreign(s))) return `annat set i texten (${otherHead})`;
  }

  // PRODUKTTYP i texten mot katalogen.
  if (catalogCategory === "BOOSTER_BOX" && /\bex box\b|samlarbox|collection box/i.test(head)) return "samlarbox ≠ booster box";
  if (catalogCategory === "TIN" && /\bupc\b|ultra[- ]premium|premium collection/i.test(listingTitle) && !/\btin\b/i.test(listingTitle)) return "UPC/collection ≠ tin";
  if (catalogCategory === "COLLECTION_BOX" && /plåtburk|plåtbox|plåtask|\btin\b/i.test(listingTitle) && !/tin|plåt/i.test(catalogTitle)) return "tin ≠ box";

  // NAMNGIVEN PRODUKT: temadeckens namn, Pokémon Center-städer, Poster Collection.
  const deck = (s: string) => s.match(/([\p{L}'’]+(?:\s[\p{L}'’]+)?)\s+theme deck/iu)?.[1]?.toLowerCase();
  const cd = deck(catalogTitle), ld = deck(listingTitle);
  if (cd && ld && !cd.split(" ").some((w) => ld.includes(w)) && !/pok[eé]mon|tcg|shield|moon|violet|soulsilver/.test(ld)) {
    return `annat temadeck (${ld})`;
  }
  const city = (s: string) => s.match(/pok[eé]mon center\s+(\p{L}+)\s+special/iu)?.[1]?.toLowerCase();
  const cc = city(catalogTitle), lc = city(listingTitle);
  if (cc && lc && cc !== lc) return `annat Pokémon Center (${lc})`;
  if (/poster/i.test(listingTitle) && !/poster/i.test(catalogTitle)) return "Poster Collection ≠ katalogens produkt";
  // Bara WOTC-eran — japanska boxar bär också "1st Edition".
  if (/^(?:base set|base|jungle|fossil|team rocket(?!'s|’s)|gym (?:heroes|challenge)|neo)\b/i.test(catalogTitle) && /shadowless|1st edition|first edition/i.test(text) && !/shadowless|1st edition/i.test(catalogTitle)) {
    return "tryckning (Shadowless/1st Edition)";
  }

  // VERSION SOM INTE ANGES: US-version, årsbundna produkter.
  if (/\(us version\)/i.test(catalogTitle) && !/\bus\b|usa|american|amerikansk|us version/i.test(text)) return "US-version ej angiven";
  const yearly = /toolkit|collector'?s? chest|world championship|advent/i;
  const cy = catalogTitle.match(/(?<!\d)(20\d\d)(?!\d)/);
  if (cy && yearly.test(catalogTitle) && !new RegExp(`(?<!\\d)${cy[1]}(?!\\d)`).test(text)) return `år ej angivet (${cy[1]})`;

  // FLER / FÄRRE: "24 Sleeved Booster", "Half Display Box", "(US Version) x 2", "Promo tins set".
  if (catalogCategory === "BOOSTER_PACK" && /(?<!\d)(?:[2-9]|[1-9]\d)\s+sleeved/i.test(listingTitle)) return "flera paket (sleeved)";
  if (catalogCategory === "BOOSTER_BOX" && !/half|halv/i.test(catalogTitle) && /half (?:booster |display )?box|half display/i.test(text)) return "halv booster box";
  if (/\)\s*[x×]\s?[2-9](?!\d)|tins set\b/i.test(text)) return "flera exemplar";
  if (catalogCategory === "BOOSTER_PACK" && /booster packs\b|boosterpakker\b/i.test(listingTitle)) return "flera paket (pluralis i titeln)";


  // ⛔ "Bara promokort" ur beskrivningen PRÖVADES och togs bort: säljare som listar en FÖRSEGLAD box räknar
  //    ofta upp dess promokort ("Rayquaza GX #SM144 promo …") — 20 äkta annonser fälldes.

  // CHARIZARD X/Y: texten nämner den ANDRA bokstaven.
  const cxy = catalogTitle.match(/charizard\s+(x|y)\b/i)?.[1]?.toLowerCase();
  if (cxy) {
    const other = cxy === "x" ? "y" : "x";
    if (new RegExp(`charizard\\s+${other}\\b(?!\\s*[-/]\\s*[xy])`, "i").test(text) && !/charizard x\s*[-/]\s*y/i.test(text)) return "annan Charizard (X/Y)";
  }

  // ÖPPNAT DECK: "59 kort totalt".
  if (/theme deck|battle deck/i.test(catalogTitle) && /\b\d{1,2}\s+kort totalt\b/i.test(desc)) return "öppnat deck";
  // TOM TIN med trasig teckenkodning: "Pl task med motiv …".
  if (catalogCategory === "TIN" && /pl\s?task|pl\s?tburk/i.test(text) && !HAS_PACKS.test(desc)) return "tom tin";
  return null;
}
