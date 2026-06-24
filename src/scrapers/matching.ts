/**
 * Fuzzy-matchning av inkommande produkttitlar mot Product-katalogen.
 * Strategi: normalisera → token-överlapp (Dice-koefficient på bigram)
 * plus bonus för matchande setnummer (t.ex. "123/198").
 */
import { prisma } from "../lib/db";
import { normalizeTitle } from "../lib/utils";

/** Lägsta konfidens för att en matchning ska accepteras. */
const MIN_CONFIDENCE = 0.55;

/**
 * Extraherar setnummer som "123/198" ur en titel — inkl. promo-format med
 * bokstavsprefix: "RC5/RC32", "TG12/TG30", "GG44/GG70", "H5/H32". Siffrorna
 * plockas ur varje sida (RC5 → 5). Utan detta kastas promo-numret bort och
 * "Charizard RC5/RC32" matchar fel kort ("Charizard 6/165").
 */
export function extractSetNumber(title: string): { num: number; total: number } | null {
  const m = /\b[a-z]{0,4}(\d{1,3})\s*\/\s*[a-z]{0,4}(\d{1,3})\b/i.exec(title);
  if (!m) return null;
  return { num: parseInt(m[1], 10), total: parseInt(m[2], 10) };
}

function bigrams(s: string): Map<string, number> {
  const grams = new Map<string, number>();
  const clean = s.replace(/\s+/g, " ");
  for (let i = 0; i < clean.length - 1; i++) {
    const g = clean.slice(i, i + 2);
    grams.set(g, (grams.get(g) ?? 0) + 1);
  }
  return grams;
}

/**
 * Likhet mellan två strängar: Dice-koefficient på teckenbigram (0..1).
 * Exporteras för enhetstester.
 */
export function scoreSimilarity(a: string, b: string): number {
  const na = normalizeTitle(a);
  const nb = normalizeTitle(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const ga = bigrams(na);
  const gb = bigrams(nb);
  let overlap = 0;
  let totalA = 0;
  let totalB = 0;
  for (const count of ga.values()) totalA += count;
  for (const count of gb.values()) totalB += count;
  for (const [gram, count] of ga) {
    const other = gb.get(gram);
    if (other) overlap += Math.min(count, other);
  }
  if (totalA + totalB === 0) return 0;
  return (2 * overlap) / (totalA + totalB);
}

/**
 * Klassificerar produktform (display/ETB/booster/bundle/...) ur en titel.
 * Används för att hindra att t.ex. en booster-pack matchas mot en booster box.
 */
export function classifyForm(title: string): string | null {
  const t = title.toLowerCase();
  // Tillbehör (inkl. svenska: samlarpärm/pärm/album/4-pocket) — får ALDRIG matcha
  // en sealed-/collection-produkt. "Greninja samlarpärm" ≠ "Greninja ex UPC".
  if (/(portfolio|binder|samlarp(ä|a)rm|\bp(ä|a)rm\b|\balbum\b|sleeves?\b|playmat|toploader|deck\s*box)/.test(t)) return "accessory";
  // Case-/kartongannonser (6 displayer i en kartong) är aldrig en enskild produkt
  if (/\bcase\b|kartong/.test(t)) return "case";
  // Kvantitetslistningar ("4x bundles", "5 x boosterpaket", "3 st booster",
  // "8pkt", "(6 Booster Boxar)", ledande antal "3 Pokemon ... booster box") är
  // multipack-annonser — får aldrig matcha en enskild produkt. OBS: "1x" är
  // vanlig singelnotation, "X 4/108" (Mega Charizard X + setnummer) är inte en
  // kvantitet (kräv 2+ och inget setnummer-snedstreck efter), och antal framför
  // formord begränsas till 2–20 så att set-namn som "151 Booster Box" inte träffas.
  if (
    /\b([2-9]|\d{2,})\s*x\b(?!\s*\d*\/)|\bx\s*([2-9]|\d{2,})\b(?!\s*\/)/.test(t) ||
    /\b([2-9]|\d{2,})\s*(st|pkt|paket)\b/.test(t) ||
    /^\s*([2-9]|1[0-9]|20)\s+/.test(t) ||
    // Antal framför formord kräver radstart/skiljetecken före siffran —
    // annars träffas set-namn som "Base Set 2 Booster Box" eller "Vol 3 Booster"
    /(^|[([+&,;:-])\s*([2-9]|1[0-9]|20)\s+(booster|boosters|boosterpaket|elite|etb|display|displayer|box|boxar|bundle|bundles|tin|tins|blister)\b/.test(t)
  )
    return "multipack";
  // Kombo-annonser: två olika produktformer i samma titel ("ETB och ...
  // Booster Bundle", "bundle + display") eller plus-tecken mellan produkter.
  {
    const formHits = [
      /(elite trainer box|\betb\b)/,
      /(booster\s*box|boosterbox|\bdisplay\b)/,
      /booster ?bundle/,
    ].filter((re) => re.test(t)).length;
    if (formHits >= 2 || /(\s|\d)\+|\+(\s|\d)/.test(t)) return "combo";
  }
  // "Mini Tin Display" = display av MÅNGA tins (dyrt) ≠ en enskild "Mini Tin"
  // (billig). Bara enskild mini tin → "tin"; med "display" faller den vidare
  // till display-regeln nedan så att en singeltin inte matchar ett tin-display.
  if (/mini\s*tin/.test(t) && !/display/.test(t)) return "tin";
  if (/(booster\s*box|boosterbox|display|displaylåda)/.test(t)) return "display";
  if (/(elite trainer box|\betb\b)/.test(t)) return "etb";
  if (/booster ?bundle/.test(t)) return "bundle";
  // Blister före generiska "N-pack": "3-pack Blister" är en enskild butiksprodukt
  if (/(blister|checklane)/.test(t)) return "blister";
  if (/(\b\d+\s*[- ]?pack\b|three pack)/.test(t)) return "multipack";
  // "boosterpaket" = svenska för booster pack (ett ord, så \bbooster\b missar)
  if (/(sleeved booster|booster ?pack|boosterpaket|\bbooster\b)/.test(t)) return "booster";
  if (/\btin\b/.test(t)) return "tin";
  if (/(battle deck|theme deck|league battle|deck)/.test(t)) return "deck";
  // "Chest" (Adventure Chest, Battle Chest …) = collection-/kistprodukt, ALDRIG en
  // booster box. Egen form så formvakten förkastar t.ex. "Paldea Adventure Chest"
  // mot "Paldea Evolved Booster Box" (delar bara set-ordet "paldea").
  if (/\bchest\b/.test(t)) return "chest";
  if (/(collection|premium|box)/.test(t)) return "collection";
  return null;
}

/**
 * Generiska ord som inte särskiljer produkter — får inte styra
 * kandidatval eller ordöverlapp (annars matchar "Ascended Heroes ETB"
 * mot "Destined Rivals ETB" bara för att båda är Pokémon-ETB:er).
 */
const STOPWORDS = new Set([
  "pokemon",
  "pokémon",
  "tcg",
  "the",
  "card",
  "cards",
  "game",
  "trading",
  "and",
  "med",
  "och",
  "for",
  "new",
  "nytt",
  "sealed",
  "english",
  "eng",
]);

/** Ord som beskriver produktform — hanteras av classifyForm, inte ordöverlapp. */
const FORM_WORDS = new Set([
  "booster",
  "boosters",
  "box",
  "display",
  "pack",
  "packs",
  "elite",
  "trainer",
  "etb",
  "bundle",
  "blister",
  "tin",
  "deck",
  "collection",
  "premium",
]);

/** Tokenisering för databasfiltrering: betydelsebärande ord (längd >= 3). */
function significantTokens(normalized: string): string[] {
  return normalized
    .split(" ")
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t))
    .slice(0, 6);
}

/** Särskiljande ord (ej stoppord/formord/siffror) — set-namn, Pokémon-namn osv. */
function distinctiveWords(normalized: string): Set<string> {
  return new Set(
    normalized
      .split(" ")
      .filter(
        (t) => t.length >= 3 && !STOPWORDS.has(t) && !FORM_WORDS.has(t) && !/^\d/.test(t)
      )
  );
}

/**
 * Hur stor andel av KANDIDATENS särskiljande ord som täcks av den inkommande
 * titeln. Kandidatsidan är rätt mått: butikstitlar innehåller ofta extra brus
 * ("Scarlet & Violet 8 ... max 1 per kund") som inte får straffa en korrekt
 * matchning, men kandidatens egna särskiljande ord ("destined rivals",
 * "first partners deluxe pin") MÅSTE finnas i den inkommande titeln.
 * Saknar kandidaten särskiljande ord krävs i stället att den inkommande
 * titeln inte har några egna ("Fusion Strike" får inte matcha "151").
 */
export function distinctiveOverlap(incoming: string, candidate: string): number {
  const a = distinctiveWords(normalizeTitle(incoming));
  const b = distinctiveWords(normalizeTitle(candidate));
  if (b.size === 0) return a.size === 0 ? 1 : 0;
  let shared = 0;
  for (const w of b) if (a.has(w)) shared++;
  return shared / b.size;
}

/**
 * Era-/serievarumärken (Mega Evolution, Scarlet & Violet …). De är GEMENSAMMA för
 * många produkter inom en era och får därför inte ensamma binda en offert till en
 * bas-produkt. De behålls i distinctiveOverlap (skiljer bas-set åt) men exkluderas
 * när vi kollar att offertens EGNA särskiljande ord täcks av kandidaten.
 */
const ERA_PHRASES = [
  /\bmega evolution\b/g,
  /\bscarlet( and| &)? violet\b/g,
  /\bsword( and| &)? shield\b/g,
  /\bsun( and| &)? moon\b/g,
];
/** Butiksbrus som inte särskiljer produkt (kvantitetsgräns, skick, varianttext). */
const NOISE_WORDS = new Set([
  "max", "per", "kund", "styck", "version", "kopia", "copy", "exklusivt", "exclusive", "promo",
  "hushall", "hushåll", "person", "antal", "pokemonkort", "pokémonkort", "forseglad", "oppen", "obs",
]);
/** Inkommande titelns särskiljande ord MINUS era-varumärken och butiksbrus. */
function nonEraDistinctiveWords(title: string): Set<string> {
  let t = normalizeTitle(title);
  for (const re of ERA_PHRASES) t = t.replace(re, " ");
  const words = distinctiveWords(t);
  for (const n of NOISE_WORDS) words.delete(n);
  return words;
}

/**
 * Andel av INKOMMANDE titelns icke-era särskiljande ord som täcks av kandidaten.
 * Låg täckning ⇒ inkommande beskriver en mer specifik/annan produkt (t.ex.
 * "Mega Evolution Perfect Order ETB" mot bas-"Mega Evolution ETB" — "perfect
 * order" saknas i basen). 1 om inkommande saknar egna icke-era-ord (= ren bas-titel).
 */
export function nonEraCoverage(incoming: string, candidate: string): number {
  // Stamma bort plural-/genitiv-s ("rockets"→"rocket", "Rocket's"→"rocket s"→"rocket")
  // så att samma produkt inte felflaggas pga tokeniseringsskillnad.
  const stem = (w: string) => (w.length > 3 && w.endsWith("s") ? w.slice(0, -1) : w);
  const inc = new Set([...nonEraDistinctiveWords(incoming)].map(stem));
  if (inc.size === 0) return 1;
  const cand = new Set([...distinctiveWords(normalizeTitle(candidate))].map(stem));
  let covered = 0;
  for (const w of inc) if (cand.has(w)) covered++;
  return covered / inc.size;
}

/**
 * Deck-produkter (League/Battle/Theme/Starter Deck) delar produktlinje-orden
 * "league/battle/deck/mega/…" men särskiljs av KARAKTÄREN (Palkia, Mewtwo,
 * Lucario …). De linje-orden får därför inte ensamma binda ihop två olika
 * decks. `deckIdentity` = de särskiljande orden MINUS linje-orden = karaktären.
 */
const DECK_LINE_WORDS = new Set([
  "league",
  "battle",
  "theme",
  "starter",
  "challenge",
  "mega",
  "tag",
  "vstar",
  "vmax",
  "gmax",
]);
export function deckIdentity(title: string): Set<string> {
  const words = distinctiveWords(normalizeTitle(title));
  for (const w of DECK_LINE_WORDS) words.delete(w);
  return words;
}

/** True om två deck-titlar beskriver olika karaktärer (inga delade karaktärsord). */
export function deckCharacterMismatch(incoming: string, candidate: string): boolean {
  const a = deckIdentity(incoming);
  const b = deckIdentity(candidate);
  if (a.size === 0 || b.size === 0) return false; // för lite info → låt övriga vakter avgöra
  for (const w of a) if (b.has(w)) return false;
  return true;
}

/** Språkmarkörer i titlar — japanska/kinesiska produkter får inte matcha EN-katalogen. */
const NON_EN_LANGUAGE = /\b(japansk\w*|japanese|jpn?\b|kinesisk\w*|chinese|korean\w*|koreansk\w*)\b/i;

/** True om titlarna har olika språkmarkörer (en har japansk/kinesisk, andra inte). */
export function languageMismatch(incoming: string, candidate: string): boolean {
  return NON_EN_LANGUAGE.test(incoming) !== NON_EN_LANGUAGE.test(candidate);
}

/** Lägsta andel delade särskiljande ord för att en kandidat ska godkännas. */
const MIN_DISTINCTIVE_OVERLAP = 0.5;

/**
 * Försöker matcha en normaliserad titel mot en produkt i katalogen.
 * Returnerar bästa kandidat med konfidens, eller null om ingen är
 * tillräckligt lik.
 */
export async function matchProduct(
  normalizedTitle: string
): Promise<{ productId: string; confidence: number } | null> {
  const normalized = normalizeTitle(normalizedTitle);
  if (!normalized) return null;

  // 1. Exakt träff på normaliserad titel
  const exact = await prisma.product.findFirst({
    where: { normalizedTitle: normalized },
    select: { id: true },
  });
  if (exact) return { productId: exact.id, confidence: 1 };

  // 2. Kandidater: hämta per token (union) så att sällsynta tokens som
  //    "ascended" inte drunknar bland tusentals "pokemon"-träffar.
  const tokens = significantTokens(normalized);
  if (tokens.length === 0) return null;

  const candidateMap = new Map<string, { id: string; normalizedTitle: string }>();
  for (const t of tokens) {
    const rows = await prisma.product.findMany({
      where: { normalizedTitle: { contains: t } },
      select: { id: true, normalizedTitle: true },
      take: 60,
    });
    for (const r of rows) candidateMap.set(r.id, r);
    if (candidateMap.size >= 300) break;
  }
  const candidates = [...candidateMap.values()];
  if (candidates.length === 0) return null;

  const incomingSetNum = extractSetNumber(normalized);
  const incomingForm = classifyForm(normalized);
  // Lot-annonser (flera produkter i en annons) får ALDRIG matcha någon
  // katalogprodukt — inte ens singelkort (vars form är null och därför
  // annars slinker förbi formvakten).
  if (incomingForm === "multipack" || incomingForm === "case" || incomingForm === "combo") {
    return null;
  }
  let best: { productId: string; confidence: number } | null = null;

  for (const c of candidates) {
    let score = scoreSimilarity(normalized, c.normalizedTitle);
    // Olika produktform (t.ex. booster pack vs booster box) → förkasta
    const candidateForm = classifyForm(c.normalizedTitle);
    if (incomingForm && candidateForm && incomingForm !== candidateForm) {
      continue;
    }
    // Två decks med olika karaktär (Palkia VSTAR ≠ Inteleon VMAX) → förkasta.
    // "League Battle Deck" delar linje-orden men karaktären måste stämma.
    if (
      incomingForm === "deck" &&
      candidateForm === "deck" &&
      deckCharacterMismatch(normalized, c.normalizedTitle)
    ) {
      continue;
    }
    // Fel språk (japansk/kinesisk utgåva) → förkasta
    if (languageMismatch(normalized, c.normalizedTitle)) {
      continue;
    }
    // Fel set/kort: kandidaten saknar de särskiljande orden → förkasta
    // (hindrar "Ascended Heroes ETB" från att matcha "Destined Rivals ETB")
    const overlap = distinctiveOverlap(normalized, c.normalizedTitle);
    if (overlap < MIN_DISTINCTIVE_OVERLAP) {
      continue;
    }
    // Offertens EGNA icke-era särskiljande ord ("perfect order", "chaos rising")
    // måste täckas av kandidaten — annars är offerten en mer specifik produkt och
    // får inte matcha bas-produkten (bas-"Mega Evolution ETB" fångar då inte en
    // "Mega Evolution Perfect Order ETB"-annons).
    if (nonEraCoverage(normalized, c.normalizedTitle) < MIN_DISTINCTIVE_OVERLAP) {
      continue;
    }
    // Liten bonus för högre ordöverlapp — föredrar "Mega Evolution Booster Pack"
    // framför "Mega Evolution Chaos Rising Booster Pack" vid likvärdig Dice.
    score = Math.min(1, score + 0.1 * overlap);
    // Setnummer = kortets identitet. Har BÅDA titlarna ett nummer och de KROCKAR
    // (annat num/total) → olika kort → förkasta hårt. Mjuk straff räckte inte:
    // "Charizard 4/102" mot "5/102" har så hög Dice att -0.3 ändå klarade tröskeln.
    const candidateSetNum = extractSetNumber(c.normalizedTitle);
    if (incomingSetNum && candidateSetNum) {
      if (
        incomingSetNum.num === candidateSetNum.num &&
        incomingSetNum.total === candidateSetNum.total
      ) {
        score = Math.min(1, score + 0.15);
      } else {
        continue;
      }
    }
    if (!best || score > best.confidence) {
      best = { productId: c.id, confidence: score };
    }
  }

  if (best && best.confidence >= MIN_CONFIDENCE) return best;
  return null;
}

/**
 * Rimlighetsvakt för marknadsplats-listningar (Tradera): ett pris som
 * kraftigt överstiger produktens Cardmarket-marknadspris är nästan alltid
 * en lot (flera enheter) eller en felmatchad premiumvariant — t.ex.
 * "Pokémon Booster Bundle Ascended Heroes" som visade sig vara 4 bundles
 * för 4 200 kr.
 *
 * Olika regler per produkttyp:
 * - Sealed: > 2,5× CM-priset är orimligt (butikskonkurrens håller svensk
 *   marknad nära CM — högre tyder på flera enheter/fel produkt). OCKSÅ
 *   < 0,15× CM = orimligt billigt: en FELMATCHAD produkt (t.ex. en 149 kr
 *   Webhallen-länk på en 2 333 kr sealed = 6 %, eller en samlarpärm på en UPC).
 *   Tröskeln är AVSIKTLIGT extrem (15 %) — vår sealed-CM-mappning är ibland för
 *   hög (en singel booster pack kan ha fel CM-id → ~250 kr istället för ~60 kr),
 *   och en ärlig billig butiksannons (pack 69 kr ≈ 28 % av fel-CM) får INTE
 *   raderas. Bara grova felmatchningar (< 15 %) fångas.
 * - Singlar/graderade: svenska säljare prissätter billiga kort långt över
 *   CM-trend (69 kr för ett 7-korts-kort är ett riktigt pris) — orimligt
 *   först vid > 4× OCH > 400 kr över CM (fångar boxar/collections som
 *   felmatchats mot singelkort, utan att rensa legitima singel-listningar).
 *   Ingen under-pris-vakt på singlar (billiga kort varierar fritt nedåt).
 *
 * Returnerar true när priset är rimligt eller CM-referenspris saknas.
 */
export const MARKETPLACE_MAX_PRICE_RATIO = 2.5;
const SEALED_MIN_PRICE_RATIO = 0.15;
const SINGLES_MAX_RATIO = 4;
const SINGLES_MAX_DIFF_ORE = 40_000;
/**
 * Pris-vakten (både över och under) gäller BARA inneboende dyra sealed-kategorier.
 * Där är CM pålitligt och det absoluta kr-gapet stort → en bråkdel = säker felmatch,
 * ett mångdubbel = lot. Billiga kategorier (BOOSTER_PACK/TIN/BLISTER) är opålitliga
 * åt BÅDA håll: CM-ref kan vara felmappad för hög, OCH svensk butik markup:ar en
 * 50 kr-pack till 129 kr (2,5×) helt lagligt. Där förlitar vi oss på form-matchning
 * (classifyForm) istället för pris. Lot-annonser fångas av multipack-vakten.
 */
const PRICE_GUARDED_SEALED_CATEGORIES = new Set([
  "BOOSTER_BOX",
  "ETB",
  "COLLECTION_BOX",
  "BUNDLE",
]);

export async function isPlausibleListingPrice(
  productId: string,
  priceOre: number
): Promise<boolean> {
  const [cmOffer, product] = await Promise.all([
    prisma.offer.findFirst({
      where: { productId, retailer: { name: "Cardmarket" }, price: { not: null } },
      select: { price: true },
    }),
    prisma.product.findUnique({ where: { id: productId }, select: { category: true } }),
  ]);
  if (cmOffer?.price == null) return true;

  const isSingle =
    product?.category === "SINGLE_CARD" || product?.category === "GRADED_CARD";
  if (isSingle) {
    return (
      priceOre <= cmOffer.price * SINGLES_MAX_RATIO ||
      priceOre - cmOffer.price <= SINGLES_MAX_DIFF_ORE
    );
  }
  // Pris-vakt bara för dyra sealed-kategorier (se ovan). Billiga: alltid rimligt
  // pris-mässigt (form-matchning sköter felmatch där).
  if (!PRICE_GUARDED_SEALED_CATEGORIES.has(product?.category ?? "")) return true;
  return (
    priceOre <= cmOffer.price * MARKETPLACE_MAX_PRICE_RATIO &&
    priceOre >= cmOffer.price * SEALED_MIN_PRICE_RATIO
  );
}
