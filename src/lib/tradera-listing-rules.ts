/**
 * TRADERA-ANNONSEN MOT KATALOGPRODUKTEN — det titelmatcharen inte ser (2026-10-14, ägarbeslut: ingen AI,
 * samma linje som skannern). Körs EFTER `matchListingToProduct` (som redan dömt set, serie, språk,
 * karaktär, form …) och ersätter LLM-domens `sameProduct`-halva för de klasser AI:n fångade:
 *
 *   1. ANTAL: katalogen är ETT booster pack men annonsen säljer flera ("4 booster packs", "Boosterpakker").
 *   2. PAKETVARIANT: Fun Pack / Sleeved / Mini booster / Checklane mot ett vanligt booster pack.
 *   3. NAMNGIVNA PRODUKTLINJER: "Premium Collection" ≠ "…Box", "Build & Battle Stadium" ≠ "…Box".
 *
 * ⛔ BARA TITELN. Beskrivningen MÄTTES och var för brusig här ("booster packs" och "fyra boosters" står i
 * allmän produkttext om enskilda pack). Ren och testad. Förseglat-frågan: `tradera-sealed-rules.ts`.
 */

const L = "\\p{L}";
const re = (body: string) => new RegExp(`(?<![${L}\\d])(?:${body})(?![${L}])`, "iu");

const NUM_WORDS = "två|tre|fyra|fem|sex|sju|åtta|nio|tio|to|fire|seks|syv|otte|ni|ti|two|three|four|five|six|seven|eight|nine|ten";
const PACK_NOUN = "booster ?packs|boosterpaket|boosterpakker|boosters|paket|packs|pakker|pack|booster";

/** "4 booster packs", "fyra boosterpaket", "3 st booster", "x3 booster", "4-pack", "Boosterpakker". */
const MULTI_PACK = re(
  `(?:[2-9]|1\\d|${NUM_WORDS})\\s*(?:st\\.?|stk\\.?|x)?\\s*(?:oöppnade\\s+|nya\\s+|forseglede\\s+)?(?:${PACK_NOUN})|` +
    `(?:[2-9]|1\\d)\\s*-\\s*(?:pack|pak|pakke)(?![${L}])|x\\s?(?:[2-9]|1\\d)\\s+(?:${PACK_NOUN})|boosterpakker`
);

const PACK_VARIANTS: { name: string; re: RegExp }[] = [
  { name: "Fun Pack", re: re("fun ?packs?") },
  { name: "Sleeved", re: re("sleeved") },
  { name: "Mini booster", re: re("mini ?boosters?|mini booster ?packs?") },
  { name: "Checklane", re: re("checklane|check lane") },
  { name: "Sampler", re: re("sampler|sampling pack|trial pack") },
];

const NAMED_LINES: { name: string; re: RegExp; words: string[] }[] = [
  { name: "Premium Collection", re: re("premium collection"), words: ["premium", "collection"] },
  { name: "Ultra-Premium", re: re("ultra[- ]?premium"), words: ["ultra", "premium"] },
  { name: "Super-Premium", re: re("super[- ]?premium"), words: ["super", "premium"] },
  { name: "Build & Battle Stadium", re: re("build (?:&|and|och) battle stadium"), words: ["stadium"] },
  { name: "Half Booster Box", re: re("half (?:booster )?box|halv(?:a)? (?:booster)?box"), words: ["half"] },
];

/**
 * ANNONSEN SOM HELHET MOT KATALOGPOSTEN (granskningsfacit 2026-10-14, ~700 handgranskade par).
 * Titel + beskrivning. Varje regel är mätt mot facit innan den lades till — se
 * scripts/tmp-rules-vs-key.ts — och ska ha nära noll felträffar.
 */
// ⛔ Inte "3 kort": fraktmallar ("1-3 kort kan skickas med frimärke") och General Mills (3 kort) fälldes.
const DESC_FUN_PACK = re("fun ?packs?|sampling ?packs?|trial pack");
const SELLER_MULTI = re(
  `(?:säljer|säljes|annons för|detta är|dette er|selling|sælger|these are)\\s+(?:nu\\s+|et sæt med\\s+|ett set med\\s+)?` +
    `(?:[2-9]|[1-9]\\d|${NUM_WORDS})\\s*(?:st\\.?|stk\\.?|stycken)?\\s*(?:oöppnade\\s+|nya\\s+|forseglede\\s+)?(?:pokemon\\s+|pokémon\\s+)?[\\p{L} &]{0,40}?(?:${PACK_NOUN})|` +
    `(?:^|\\n)(?:[2-9]|${NUM_WORDS})\\s+(?:st\\.?\\s+|stk\\.?\\s+|stycken\\s+)?(?:oöppnade\\s+|forseglede\\s+)?(?:${PACK_NOUN})|` +
    `(?<!innehåller\\s|indeholder\\s|contains\\s|med\\s|with\\s)(?:[2-9]|1\\d|[2-9]\\d)\\s*(?:st|stk|stycken)\\.?\\s+(?:oöppnade\\s+)?(?:${PACK_NOUN})|` +
    // Var som helst: "Fyra oöppnade boosterpaket", "– Två oöppnade Booster Packs", "To uåbnede …".
    `(?<!innehåller\\s|indeholder\\s|contains\\s|med\\s|with\\s|varje\\s|hver\\s|each\\s)(?:${NUM_WORDS}|[2-9])\\s+(?:oöppnade|uåbnede|forseglede|nya)\\s+(?:[\\p{L}&]+\\s+){0,5}(?:${PACK_NOUN})|` +
    `(?:^|\\n)\\s*(?:oöppnad\\w*\\s+)?(?:${NUM_WORDS})\\s+(?:${PACK_NOUN}|oöppnade|forseglede)|` +
    `(?:[2-9])\\s?×|×\\s?[2-9]|(?:[2-9]|\\d\\d)\\s?x\\s+(?:sleeved|booster)`
);
const LOT = re(
  "ett parti|parti med|lot of|samlet som sæt|sælges samlet|" +
    "(?:[2-9]|två|tre|fyra|fem|sex) ?(?:st|stk|stycken)\\.? (?:[\\p{L}&’']+\\s+){0,6}(?:tins|boxar|boxes|box|æsker|etb|blister|collections?)|" +
    "\\)\\s*[x×]\\s?[2-9](?![\\p{L}\\d])|god pack"
);
const STORAGE_ONLY = re("förvaring|opbevaring|storage|småting|småsaker|tomme?|tomma|endast plåtburken|bara burken|plåtask|plåtburk|samlerdåse");
/** Särdrag som fäller en annons vars text MOTSÄGER katalogposten. */
const SERIES_NO = /series\s*(\d)/i;
const YEAR = /(?<!\d)(19[9]\d|20[0-3]\d)(?!\d)/;
const JP_MARK = /japan|japansk|japanska|japanskt|japanese|\bjp\b|\(jp\)|日本/i;
/** Namn som finns på BÅDA språken — bara där måste en japansk annons säga att den är japansk. */
const SHARED_JP_EN_NAME = /pok[eé]mon card 151|\b151\b|black bolt|white flare|scarlet ex|violet ex/i;
const HAS_PACKS = re("booster|paket|pakker|pakke|packs?");
const PROMO_ONLY = /promo/i;
const PROMO_CODE = /(?:#\s?\d{2,3}\b|\b(?:swsh|svp|xy|sm|bw)\s?\d{2,3}\b)/i;

/** Problem i annonsen som helhet (titel + beskrivning) mot katalogposten. */
export function listingWholeProblem(
  catalogTitle: string,
  catalogCategory: string,
  listingTitle: string,
  description: string | null | undefined,
  characterNames: (t: string) => Set<string>,
  catalogLanguage?: string | null
): string | null {
  const desc = (description ?? "").replace(/<[^>]+>/g, " ").replace(/&nbsp;|&amp;|&#\d+;/g, " ");
  const text = `${listingTitle}\n${desc}`;
  // Beskrivningens början — sökordslistor ("Sökord: Pikachu Charizard …") räknas inte som påståenden.
  const head = desc.split(/sökord|søgeord|tags:|#pokemon/i)[0].slice(0, 300);
  // SPRÅK: en japansk katalogpost måste säga sig vara japansk; en engelsk får inte säga "Språk: Japanese".
  // Bara när namnet finns på båda språken — rent japanska setnamn (Triplet Beat, Nihil Zero …) räcker själva.
  if (catalogLanguage === "JP" && SHARED_JP_EN_NAME.test(catalogTitle) && !JP_MARK.test(text)) return "japansk produkt, annonsen säger inte japansk";
  if (catalogLanguage === "EN" && /(?:språk|sprog|language)\s*:\s*(?:japanese|japanska|japansk)/i.test(desc)) return "annonsen anger japanska";
  // MOTSÄGELSER mellan katalogpost och annonstext.
  const cs = catalogTitle.match(SERIES_NO), ts = text.match(SERIES_NO);
  if (cs && ts && cs[1] !== ts[1]) return `annan serie (Series ${ts[1]})`;
  const cy = catalogTitle.match(YEAR), ly = listingTitle.match(YEAR);
  if (cy && ly && cy[1] !== ly[1]) return `annat år (${ly[1]})`;
  const cxy = catalogTitle.match(/charizard\s+(x|y)\b/i), txy = text.match(/charizard\s+(x|y)\b(?!\s*-\s*[xy])/gi);
  if (cxy && txy && txy.some((t) => !t.toLowerCase().endsWith(cxy[1].toLowerCase())) && !txy.some((t) => t.toLowerCase().endsWith(cxy[1].toLowerCase()))) {
    return "annan Charizard (X/Y)";
  }
  if (/celebrations?/i.test(catalogTitle) && !/30th|30 /i.test(catalogTitle) && /30th|30 års|30 celebration|30th anniversary/i.test(text)) return "30th ≠ Celebrations (25th)";
  if (/30th/i.test(catalogTitle) && /25th|25-års|25 års/i.test(text)) return "25th ≠ 30th Celebration";
  // Tins/blistrar identifieras av karaktären: nämner beskrivningen andra karaktärer och INGEN av katalogens?
  if (catalogCategory === "TIN" || catalogCategory === "BLISTER") {
    const want = characterNames(catalogTitle);
    const said = characterNames(head);
    if (want.size > 0 && said.size > 0 && ![...want].some((n) => said.has(n))) return `annan karaktär i texten (${[...said].join("/")})`;
  }
  // Ett ENSKILT kort ("152/145") eller ett graderat paket.
  if (/(?<![\d/])\d{1,3}\/\d{2,3}(?![\d/])/.test(listingTitle)) return "singelkort (kortnummer i titeln)";
  // Titeln, eller "graderad hos/av" i texten — säljarblurbar som "PSA-graderade kort" fällde förut 33 äkta annonser.
  if (/graderad|graded|\bpsa\s?\d|\bcgc\s?\d|\bbgs\s?\d|rauk ?card/i.test(listingTitle) || /graderad (?:hos|av)|graded by/i.test(desc)) return "graderad";
  // Tillbehör i titeln: "ETB skydd".
  if (/(?<![\p{L}])(?:skydd|protector|fodral)(?![\p{L}])/iu.test(listingTitle) && !/skydd|protector|fodral/i.test(catalogTitle)) return "tillbehör";
  // Ofullständig/tom: "Ej komplett", "inga packs tillkommer", "Säljer en tom … Elite Trainer Box", "Tom askar".
  if (/ej komplett|inte komplett|ofullständig|incomplete|inga (?:packs|paket|boosters?)(?: tillkommer| ingår)?|tom askar|en tom (?:[\p{L}'’]+\s+){0,5}(?:box|etb|låda|ask|tin)/iu.test(text)) return "ofullständig/tom";
  // Fel produkttyp: katalogen är INTE ett pack men annonsen säljer ett ("Evolutions Boosterpakke" mot en B&B-box).
  if (catalogCategory !== "BOOSTER_PACK" && catalogCategory !== "BLISTER" && /booster ?(?:pakke|paket|pack)(?!\w)/i.test(listingTitle) && !/(?:box|bundle|display|etb|elite|collection|tin|blister|case|deck)/i.test(listingTitle)) {
    return "ett booster pack ≠ katalogens produkt";
  }
  // Katalogen ÄR ett pack men annonsen säljer en bundle/collection.
  if (catalogCategory === "BOOSTER_PACK" && !/collection|bundle/i.test(catalogTitle) && /(?<![\p{L}])(?:bundel|bundle|collection|samlarbox|kollektion)(?![\p{L}])/iu.test(listingTitle)) {
    return "bundle/collection ≠ ett pack";
  }
  // Fun Pack/Sampling Pack i BESKRIVNINGEN mot ett vanligt pack eller en blister.
  if ((catalogCategory === "BOOSTER_PACK" || catalogCategory === "BLISTER") && DESC_FUN_PACK.test(text) && !DESC_FUN_PACK.test(catalogTitle)) {
    return "Fun Pack/Sampling Pack ≠ katalogens produkt";
  }
  // Flera paket enligt säljarens egen text, mot ETT pack.
  if (catalogCategory === "BOOSTER_PACK") {
    const m = text.match(SELLER_MULTI);
    if (m) return `flera paket ("${m[0].trim().slice(0, 40)}")`;
  }
  // Parti / flera exemplar i samma annons.
  const lot = text.match(LOT);
  if (lot) return `parti/flera exemplar ("${lot[0].trim()}")`;
  // Tom tin: annonsen beskriver en burk för förvaring och nämner inga paket.
  if (catalogCategory === "TIN" && STORAGE_ONLY.test(text) && !HAS_PACKS.test(desc)) return "tom tin (förvaring, inga paket)";
  // Bara promokort: "Empoleon V promo Tyranitar V promo", "Zapdos ex 145 … Promo".
  if (catalogCategory !== "BOOSTER_PACK" && PROMO_ONLY.test(listingTitle) && PROMO_CODE.test(text) && !HAS_PACKS.test(text) && !/sealed|förseglad|forseglet/i.test(text)) {
    return "bara promokort";
  }
  // Art set (fyra paket med olika omslag) i TITELN mot ett pack.
  if (catalogCategory === "BOOSTER_PACK" && /art ?-?set/i.test(listingTitle)) return "flera paket (art set)";
  // TVÅ PRODUKTER i samma annons: "ETB och Tin", "Booster Bundle och Tin Umbreon", "ETB & Mega Evolution".
  if (/(?:etb|elite trainer box|bundle|box|tin|collection|blister)\s+(?:och|og|and|&|\+)\s+(?:\p{L}+\s+){0,3}(?:etb|elite trainer box|bundle|box|tin|collection|blister)/iu.test(listingTitle)) {
    return "två produkter i samma annons";
  }
  // Katalogposten ÄR en kombination ("Booster Bundle + Detective Club") men annonsen säljer bara ena delen.
  const plus = catalogTitle.match(/\+\s*([\p{L}' ]{3,})$/u);
  if (plus && !text.toLowerCase().includes(plus[1].trim().toLowerCase().split(" ")[0])) return "katalogens kombination saknas i annonsen";
  // Katalogen är en SLEEVED booster men annonsen säger inte sleeved.
  if (/sleeved/i.test(catalogTitle) && !/sleeved/i.test(text)) return "Sleeved ej angivet";
  // Tom vara: "Crown Zenith Tin - TOM", "Pokémon Mini Tins (tomma)".
  if (catalogCategory !== "BOOSTER_PACK" && /(?<![\p{L}])(?:tom|tomma|tomme|empty)(?![\p{L}])/iu.test(listingTitle)) return "tom (titeln)";
  // Halv box: "(18 boosters)", "halv booster box".
  if (catalogCategory === "BOOSTER_BOX" && !/half|halv/i.test(catalogTitle) && /(?<![\d])18\s*(?:st\s*)?(?:boosters?|paket|packs|pakker)|halv(?:a)?\s+(?:booster\s*)?box/iu.test(text)) {
    return "halv booster box";
  }
  // Katalogen namnger varianten (Koraidon/Miraidon-ETB, Mega Lucario-ETB, Tyranitar V Tin) men annonsen
  // nämner ingen av dess karaktärer — vilken av varianterna är det? Gissas aldrig.
  if (catalogCategory === "ETB" || catalogCategory === "COLLECTION_BOX" || catalogCategory === "TIN" || catalogCategory === "BLISTER") {
    const want = characterNames(catalogTitle);
    if (want.size > 0) {
      const have = characterNames(text);
      if (![...want].some((n) => have.has(n))) return `variant ej angiven (${[...want].join("/")})`;
    }
  }
  return null;
}

export function listingProductProblem(catalogTitle: string, catalogCategory: string, listingTitle: string): string | null {
  if (catalogCategory === "BOOSTER_PACK") {
    const m = listingTitle.match(MULTI_PACK);
    if (m && !MULTI_PACK.test(catalogTitle)) return `flera paket ("${m[0].trim()}")`;
    // Mot en BLISTER är "Checklane" samma sak som 1-pack — därför bara mot ett pack.
    for (const v of PACK_VARIANTS) {
      if (v.re.test(listingTitle) && !v.re.test(catalogTitle)) return `${v.name} ≠ katalogens produkt`;
    }
  }
  for (const v of NAMED_LINES) {
    // Ordföljden spelar ingen roll ("Figure Premium Collection" = "Premium Figure Collection").
    if (v.re.test(listingTitle) && !v.re.test(catalogTitle) && !v.words.every((w) => new RegExp(`(?<![\p{L}])${w}(?![\p{L}])`, "iu").test(catalogTitle))) {
      return `${v.name} ≠ katalogens produkt`;
    }
  }
  return null;
}
