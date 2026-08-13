/**
 * Fuzzy-matchning av inkommande produkttitlar mot Product-katalogen.
 * Strategi: normalisera → token-överlapp (Dice-koefficient på bigram)
 * plus bonus för matchande setnummer (t.ex. "123/198").
 */
import { prisma } from "../lib/db";
import { decodeTitle, normalizeTitle } from "../lib/utils";
import { detectListingLanguage } from "../lib/listing-language";
import { MARKETPLACE_MIN_PRICE_RATIO } from "../lib/listing-plausibility";
import { listingFitsVariant } from "../lib/print-variant";
import { MAX_NAME_WORDS, POKEMON_NAMES } from "./pokemon-names";

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

/**
 * Normaliserad kortnummer-nyckel: bokstavsprefix (gemener) + heltal utan
 * inledande nollor + eventuellt bokstavsSUFFIX. "RC5"→"rc5", "GG01"→"gg1",
 * "006"→"6", "115a"→"115a". Total-delen ignoreras med flit — promo-set anger
 * ofta fel total i annonser ("RC5/RC32" mot katalogens "RC5/83"), men SJÄLVA
 * kortnumret (RC5) är kortets identitet.
 *
 * SUFFIXET ÄR IDENTITET (fix 2026-07-25): regexen tog förut bara PREFIX-
 * bokstäver, så "115a" blev "115". Guzma 115a (Burning Shadows league-promo)
 * och Guzma 115 (vanlig uncommon) är OLIKA kort med olika pris — 45 Tradera-
 * offers hade parkerat den billiga tryckningens pris på den dyra produkten
 * (41 av dem hade dessutom syskonkortet i vår egen katalog, dvs bevisat fel).
 */
export function cardNumberKey(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const m = /^\s*([a-z]+)?0*(\d{1,4})([a-z]?)/i.exec(raw);
  if (!m) return null;
  return (m[1]?.toLowerCase() ?? "") + parseInt(m[2], 10) + (m[3]?.toLowerCase() ?? "");
}

/** Tryckt kortnummer (vänstersidan av "X/Y") ur en titel, som cardNumberKey. */
export function printedNumberKey(title: string): string | null {
  const m = /\b([a-z]{0,4})(\d{1,3})([a-z]?)\s*[/／]\s*[a-z]{0,4}\d{1,3}\b/i.exec(title);
  if (!m) return null;
  return m[1].toLowerCase() + parseInt(m[2], 10) + (m[3]?.toLowerCase() ?? "");
}

/**
 * Ord som gör ett efterföljande tal till NÅGOT ANNAT än ett kortnummer
 * ("annons 2", "del 3", "bild 1"). Utan dem skulle t.ex.
 * "Zamazenta - Destined Rivals - Holo - (Annons 2)" läsas som kort nr 2.
 */
const NON_CARD_NUMBER_PREFIX = /\b(annons|bild|del|lot|nr|no|styck|version|sida|vol|serie)$/;
/** Ord EFTER talet som gör det till mängd/pris ("3 st", "10 kort", "59 kr"). */
const NON_CARD_NUMBER_SUFFIX = /^(st|styck|kort|kr|sek|pack|packs|paket|mm|cm)\b/;

/**
 * Kandidat-kortnummer i en annonstitel som SAKNAR "X/Y"-form.
 *
 * Svenska Tradera-titlar skriver ofta bara numret: "Brock's Scouting 146 Journey
 * Together". Både printedNumberKey och extractSetNumber kräver snedstreck, så
 * numret var helt osynligt för nummer-vakten → den BILLIGA ordinarie tryckningen
 * prissatte den DYRA secret-raren (mätt 2026-07-25: 677 Tradera-offers, bl.a.
 * "Milotic ex 42" på produkt 217 och "Jynx ex - MEW 151 - 191" på Mew ex 193).
 *
 * Konservativ med flit: 1–3 siffror (årtal faller bort av sig själva), siffror
 * som ingår i ett "X/Y"-uttryck plockas bort först, och kända icke-nummer-
 * sammanhang filtreras. Returnerar tom lista när inget kandidat-nummer finns —
 * då dömer vakten inte alls.
 */
export function bareCardNumbers(normalized: string): number[] {
  const stripped = normalized.replace(/\b[a-z]{0,4}\d{1,3}\s*[/／]\s*[a-z]{0,4}\d{1,3}\b/gi, " ");
  const out = new Set<number>();
  for (const m of stripped.matchAll(/(?<![\w])(\d{1,3})(?![\w])/g)) {
    const n = parseInt(m[1], 10);
    if (n <= 0) continue;
    if (NUMERIC_SET_NAMES.has(m[1])) continue; // "151" är ett SETNAMN, inte ett kortnummer
    if (NON_CARD_NUMBER_PREFIX.test(stripped.slice(0, m.index).trimEnd())) continue;
    if (NON_CARD_NUMBER_SUFFIX.test(stripped.slice(m.index + m[0].length).trimStart())) continue;
    out.add(n);
  }
  return [...out];
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
  if (/(portfolio|binder|samlarp(ä|a)rm|\bp(ä|a)rm\b|\balbum\b|sleeves?\b|playmat|spelbordsmatta|spelmatta|toploader|deck\s*box)/.test(t)) return "accessory";
  // Eventbiljetter (prerelease-/turneringsdeltagande) är inte produkter alls —
  // DL:s "Deltagarbiljett – Pitch Black Pre-release" matchade annars boostern.
  // OBS: håll orden biljett-specifika — "tournament" ensamt får INTE hit
  // ("Iono Premium Tournament Collection" är en riktig produktlinje).
  if (/(deltagarbiljett|\bbiljett\b|deltagaravgift|pre.?release)/.test(t)) return "event";
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
  // "Build & Battle" (Box/Kit/Stadium/Display) = egen produktfamilj. Får ALDRIG
  // matcha en booster box/ETB bara för att set-namnet delas — en butiks "Surging
  // Sparks Build & Battle" (~599 kr) hamnade annars som offer på "Surging Sparks
  // Booster Box" (~2 000 kr). Egen form före box/display/collection-reglerna.
  if (/build\s*&?\s*battle/.test(t)) return "buildbattle";
  // "Surprise Box" = egen produktfamilj, av exakt samma skäl som Build & Battle.
  // Utan den föll Shinycards "Prismatic Evolutions Suprise Box Collection" (999 kr)
  // ihop med varje annan "… Collection" i samma set: den blev först offer på
  // "Super-Premium Collection" (0,7195) och — när gradvakten stoppat det — på
  // "Poster Collection" (0,7038), medan den RÄTTA produkten "Prismatic Evolutions
  // Surprise Box" bara nådde 0,6941. Orsaken är att katalogtiteln saknar ordet
  // "Collection" som butiken skriver ut, så det generiska formordet drog poängen
  // till fel produkt. En egen form gör frågan binär i stället för att lita på
  // decimaler. MÅSTE ligga före box/collection-reglerna nedan.
  // "suprise" med flit: butikens stavfel är vanligare än det rätta ordet i feedar,
  // och en form som inte tål det hade lämnat exakt det här fallet olöst.
  if (/\bsu[r]?prise\s*box\b/.test(t)) return "surprisebox";
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
  // "Battle Academy" = egen starter-produktfamilj (Pikachu/Eevee/Cinderace,
  // Battle Academy 2024 …) — ALDRIG en booster/deck för ett annat Pokémon. Egen
  // "deck"-form så att deckCharacterMismatch förkastar den mot t.ex. "Melmetal V
  // GO Battle Deck" (delar bara linje-ordet "battle"). Efter deck-regeln ovan så
  // att en äkta "Battle Academy ... Deck" inte fastnar fel.
  if (/battle academy/.test(t)) return "deck";
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
  // Sammansatta formord (svenska/hopskrivna) — annars behandlas de som särskiljande
  // ("boosterpack" gjorde att en äkta "Scarlet & Violet Base Boosterpack" förkastades).
  "boosterpack",
  "boosterpaket",
  "boosterbox",
  "boosterboxar",
]);

/** True om alla betydelsebärande ord i kortnamnet finns i den normaliserade titeln. */
function cardNameInTitle(name: string, normalizedListing: string): boolean {
  const words = significantTokens(normalizeTitle(name));
  if (words.length === 0) return false;
  const set = new Set(normalizedListing.split(" "));
  return words.every((w) => set.has(w));
}

/** Tokenisering för databasfiltrering: betydelsebärande ord (längd >= 3). */
/**
 * De sex tokens vi hämtar kandidater på.
 *
 * ⛔ ORDNINGEN ÄR INTE TITELNS (rättat 2026-08-07). Förut togs helt enkelt de sex
 *    FÖRSTA orden — och butiker skriver Pokémon-namnet SIST:
 *      "Pokemon Scarlet & Violet 5: Temporal Forces 3-Pack Blister CLEFFA"
 *       └─── de sex första ──────────────────────────────┘   cleffa föll bort
 *    Kvar blev bara era- och formord ("scarlet", "violet", "blister"), som var och
 *    en har hundratals katalogsyskon och hämtas med `take: 200` UTAN `orderBy` —
 *    alltså ett godtyckligt urval. Rätt tvilling ("Temporal Forces: Cleffa 3-Pack
 *    Blister") kom därför aldrig ens in i kandidatpoolen, och alla vakter och
 *    identitetstester nedanför var meningslösa: de fick aldrig se den.
 *    Mätt: sex av de bildlösa dubblettprodukterna uppstod exakt så.
 *
 * FORMORD OCH ERA-ORD SIST. De är per definition de minst särskiljande (de delas av
 * hela katalogen), medan karaktärs- och setnamn är det som pekar ut EN produkt.
 * Antalet tokens är oförändrat (6) → lika många frågor som förut, ingen extra
 * kostnad; det är URVALET som blivit rätt.
 */
function significantTokens(normalized: string): string[] {
  const tokens = normalized.split(" ").filter((t) => t.length >= 3 && !STOPWORDS.has(t));
  const distinctive = distinctiveWords(normalized);
  const rank = (t: string): number => {
    // ⛔ ERA-ORDEN FÖRST BORT. "scarlet"/"violet" räknas som distinctive (de är
    //    varken stoppord eller formord) men delas av tusentals produkter, och
    //    eftersom de står FÖRST i butikstiteln åt de upp hela kandidattaket innan
    //    "cleffa" ens hann frågas. Mätt: tokens blev ["scarlet","violet",…] och
    //    poolen fylldes med 400 godtyckliga S&V-produkter — noll av dem tvillingen.
    if (ERA_TOKENS.has(t)) return 2;
    if (distinctive.has(t)) return 0; // karaktärs-/setnamn
    if (FORM_WORDS.has(t)) return 3; // "booster", "blister", "box" …
    return 1; // siffror, övrigt
  };
  // Stabil sortering: samma rang → titelns ordning (Array.prototype.sort är stabil
  // i Node). Deterministiskt urval, ingen slump.
  return tokens
    .map((t, i) => ({ t, i, r: rank(t) }))
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .slice(0, 6)
    .map((x) => x.t);
}

/** Era-/serievarumärke någonstans i titeln? (icke-global → säkra .test-anrop). */
const ERA_RE = /\b(mega evolution|scarlet( and| &)? violet|sword( and| &)? shield|sun( and| &)? moon)\b/i;

/**
 * Enskilda ord ur era-namnen. Används BARA för att prioritera ned dem när
 * kandidat-tokens väljs (se significantTokens) — de är inte stoppord, för i
 * "Scarlet & Violet Booster Box" ÄR de produktens identitet.
 * ⚠️ "mega"/"evolution" står MED FLIT inte här: "Mega Evolution" är också ett
 *    riktigt setnamn, och att ranka ner det hade tömt kandidatpoolen för de seten.
 */
const ERA_TOKENS = new Set(["scarlet", "violet", "sword", "shield", "sun", "moon"]);

/**
 * Sifferset-namn som ÄR produktidentitet trots att de börjar på siffra ("151" =
 * Scarlet & Violet 3.5). Utan detta tappar distinctiveWords dem → 151-produkten får
 * noll särskiljande ord och kan aldrig vinna mot bas-S&V. Lägg till fler vid behov.
 */
const NUMERIC_SET_NAMES = new Set(["151"]);
/** Särskiljande ord (ej stoppord/formord/siffror) — set-namn, Pokémon-namn osv. */
function distinctiveWords(normalized: string): Set<string> {
  const words = new Set(
    normalized
      .split(" ")
      .filter(
        (t) =>
          t.length >= 3 &&
          !STOPWORDS.has(t) &&
          !FORM_WORDS.has(t) &&
          (!/^\d/.test(t) || NUMERIC_SET_NAMES.has(t))
      )
  );
  // "base" är vintage-set-IDENTITET (Base Set 1999) BARA utan era-fras. Med en era-fras
  // ("Scarlet & Violet Base Boosterpack") är "base" en redundant kvalificerare — räkna
  // det då inte som identitet, annars kolliderar S&V-"Base"-annonser med vintage
  // "Base Booster Pack" (delade ordet "base" gav 0,64 träff på fel produkt).
  if (words.has("base") && ERA_RE.test(normalized)) words.delete("base");
  return words;
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
  // PLURAL-s ÄR INTE VALFRITT. Samlarhobby skriver "Mega EvolutionS" — utan `s?` matchar
  // \b inte, era-frasen blir kvar, och "mega"+"evolutions" räknas som produktIDENTITET.
  // Följd: nonEraCoverage föll till 0,40 för "Pokémon, Mega Evolutions, ME04: Chaos Rising,
  // Display / Booster Box" mot katalogens "Pokémon TCG: Chaos Rising Booster Box" → vetot
  // slog till trots att distinctiveOverlap var 1,00 → auto-importen skapade en DUBBLETTSTUB
  // (2026-07-13). Samma fälla väntar varje butik som pluraliserar serienamnet.
  /\bmega evolutions?\b/g,
  /\bscarlet( and| &)? violet\b/g,
  /\bsword( and| &)? shield\b/g,
  /\bsun( and| &)? moon\b/g,
];
/** Butiksbrus som inte särskiljer produkt (kvantitetsgräns, skick, varianttext). */
const NOISE_WORDS = new Set([
  "max", "per", "kund", "styck", "version", "kopia", "copy", "exklusivt", "exclusive", "promo",
  "hushall", "hushåll", "person", "antal", "pokemonkort", "pokémonkort", "forseglad", "oppen", "obs",
  // Skick/tryck-upplaga/förlag = generiskt brus, aldrig produkt-IDENTITET. Utan detta
  // sänker de nonEraCoverage för äkta men brusiga annonser (t.ex. vintage "Base Set
  // Booster Pack 1999 WOTC Unlimited Shadowless oöppnad"). ASCII (normalizeTitle
  // strippar diakritik). "unlimited"/"shadowless" = tryck-upplagor vi ej katalogför
  // → tryggt brus. Delset-NAMN (Perfect Order, Cyber Judge) är INTE här → precisionen
  // hålls. OBS: "base" får ALDRIG in här (äkta vintage-setnamn). "set" däremot ÄR brus:
  // ordet står alltid BREDVID den riktiga identiteten ("Base SET", "151 SET") och bar
  // det ensamt sänkte täckningen för äkta vintage-annonser ("Base Set Booster Pack"
  // mot katalogens "Base Booster Pack" = 0,5) när tröskeln skärptes till 0,6.
  "wotc", "unlimited", "shadowless", "unopened", "ooppnad", "oanvand", "anvand",
  "nyskick", "fabriksforseglad", "farsk", "ladan", "helt", "aldrig", "mint", "factory",
  "set",
]);
/**
 * Korta set-markörer som distinctiveWords annars tappar (för korta/numeriska),
 * men som ÄR det enda som skiljer två annars identiska produkter åt.
 * "go" = Pokémon GO (SWSH10.5) — utan detta matchar "...10.5 Pokémon GO Booster
 * Pack" fel mot bas-"Sword & Shield Booster Pack" (sword/shield är en era-fras).
 * Lägg till fler markörer här vid behov.
 */
const SET_QUALIFIER_WORDS = new Set(["go"]);
/**
 * Set-koder (sv01, swsh12, sm11 …) är IDENTIFIERARE för setet, inte särskiljande
 * delprodukt-ord. En äkta engelsk "SV01 Scarlet & Violet Booster Pack" fick annars
 * nonEraCoverage=0 (scarlet/violet är era-ord som stryks → "sv01" blev det enda
 * kvarvarande ordet, saknas i katalogtiteln → förkastad). Japanska delset förkastas
 * ändå av sitt DELSET-NAMN (Cyber Judge, Paradise Dragona) som är kvar. JP-basseten
 * sv1S/sv1V fångas av JP_SET_MARKERS. Behåll listan snäv (kända serie-prefix).
 */
/*
 * OBS: `me` (Mega Evolution: ME01–ME05) SAKNADES här, trots att den bredare SET_CODE_RE
 * längre ner i filen redan kände igen `me\d`. De två reglerna hade glidit isär, och det
 * kostade en dubblettstub: "ME04" räknades som produktidentitet i nonEraCoverage, inte som
 * den set-KOD den är. Håll dem i synk — en ny serie måste in i BÅDA.
 */
const SET_CODE = /^(sv|swsh|sm|xy|bw|dp|hgss|me)\d{1,3}[a-z]?$/i;
/** Inkommande titelns särskiljande ord MINUS era-varumärken, set-koder och butiksbrus. */
function nonEraDistinctiveWords(title: string): Set<string> {
  let t = normalizeTitle(title);
  for (const re of ERA_PHRASES) t = t.replace(re, " ");
  const words = distinctiveWords(t);
  // Behåll set-markörer (t.ex. "go") som distinctiveWords tappar — annars osynlig
  // skillnad mot en bas-produkt som saknar markören.
  for (const tok of t.split(" ")) if (SET_QUALIFIER_WORDS.has(tok)) words.add(tok);
  for (const n of NOISE_WORDS) words.delete(n);
  for (const w of [...words]) if (SET_CODE.test(w)) words.delete(w);
  return words;
}

/**
 * BÅDA riktningarna är fullständiga: kandidatens alla särskiljande ord finns i annonsen
 * OCH annonsens alla icke-era-ord täcks av kandidaten. Då är identitets-ORDMÄNGDERNA
 * identiska — bara era-namn ("Mega Evolutions"), set-koder ("ME04") och formord
 * ("Display / Booster Box") skiljer formuleringarna åt.
 *
 * VARFÖR DEN BEHÖVS: intervallet 0,55–0,85 avgjordes ENBART av en LLM-dom (Haiku). När
 * Anthropic-kvoten tog slut (2026-07-13: "You have reached your specified API usage limits")
 * returnerade judgeSameProduct null → varje gränsfall blev en DUBBLETTSTUB. Det var så
 * "Pokémon, Mega Evolutions, ME04: Chaos Rising, Display / Booster Box" (0,789) hamnade
 * bredvid katalogens "Pokémon TCG: Chaos Rising Booster Box" i stället för på den.
 *
 * SÄKERHETEN ligger i att detta körs EFTER alla tvåsidiga vakter (form, set-kod, karaktär,
 * kortsuffix, språk, Pokémon Center, Ultra-Premium, blister, antal, årtal). Skiljer
 * produkterna sig i något av det är kandidaten redan förkastad. Kvar är bara olika sätt att
 * SKRIVA samma vara — vilket är exakt det här ska fånga, utan att fråga en LLM om lov.
 */
export function identicalIdentity(incoming: string, candidate: string): boolean {
  return distinctiveOverlap(incoming, candidate) === 1 && nonEraCoverage(incoming, candidate) === 1;
}

/**
 * ATT LÄNKA OCH ATT MERGA ÄR INTE SAMMA BESLUT — och får inte dela tröskel.
 *
 *   LÄNKA  (fästa en offer på en produkt): en falsk BLOCKERING är dyr, för den är osynlig.
 *          Var därför generös. Fel? Offern hamnar på en stub som syns och kan städas.
 *   MERGA  (radera en katalogprodukt): en falsk SAMMANSLAGNING är KATASTROFAL — produkten
 *          är borta, dess pris och bevakningar med den. Var därför strikt. En utebliven
 *          merge kostar bara en dubblett som ligger kvar och syns i rapporten.
 *
 * Regeln: efter att era-namn ("Mega Evolutions"), set-koder ("ME04", "sv1S") och rent
 * fyllnadsord ("Pokémon", "TCG") tagits bort, och kända SYNONYMER normaliserats
 * (booster DISPLAY = booster BOX), måste ordmängderna vara EXAKT LIKA.
 *
 * Varje falsk merge som dry-runen ville göra faller på precis detta — de skiljer sig åt i
 * ett ord som poängsättningen räknar som brus men som ÄR produktidentitet:
 *   "Charizard ex BOX"              vs "Charizard ex PREMIUM COLLECTION"
 *   "GALLADE XY Premium Checklane"  vs "SILVER TEMPEST: Gallade Premium Checklane"
 *   "EX Deoxys Booster (5 CARDS)"   vs "Deoxys Booster PACK"
 *   "Journey Together Checklane"    vs "Journey Together PREMIUM Checklane"
 *   "Black Bolt DELUXE Booster Pack" vs "Black Bolt 1 booster pack"
 * medan de äkta dubbletterna går igenom:
 *   "Mega Evolutions, ME04: Chaos Rising, Display / Booster Box" == "Chaos Rising Booster Box"
 *   "Surging Sparks Booster Display"                             == "Surging Sparks Booster Box"
 */
const MERGE_FILLER = new Set([
  "pokemon", "tcg", "trading", "card", "game", "the", "of", "and", "för", "for",
]);
/** Butikernas synonymer för EXAKT samma form. Håll listan SNÅL — varje rad är en risk. */
const MERGE_SYNONYMS: Record<string, string> = {
  display: "box", // "Booster Display" = "Booster Box"
  displays: "box",
  boxes: "box",
  boosters: "booster",
  packs: "pack",
  japanese: "japansk",
  english: "engelsk",
  // En CHECKLANE-blister ÄR en 1-pack-blister — samma vara, olika namn. Det är inte en
  // gissning: blisterMismatch() i den här filen bygger redan på exakt den ekvivalensen
  // ("checklane ≡ 1-pack, men 1 ≠ 3"). Butikerna (Dragon's Lair, Spelexperten) säger
  // "Checklane Blister" där katalogen säger "1-Pack Blister".
  // OBS: 1 ≠ 3 gäller fortfarande — "3-pack" är ett eget token och krockar som det ska.
  checklane: "1-pack",
};
/**
 * Set-koder FÖR MERGE — kräver BOKSTAVSPREFIX (ME04, sv1S, swsh12, m1s).
 *
 * Använd ALDRIG SET_CODE_RE här: den har en gren för BARA SIFFROR (`\d{1,2}`), och ett naket
 * tal är IDENTITET, inte en kod. Den grenen strök "2" ur "Base SET 2 Booster Pack", varpå
 * ordmängden blev identisk med "Mega Evolution BASE SET: Booster Pack" och dry-runen ville
 * merga Base Set 2 med Base Set (2026-07-13). Samma fälla gäller "151" och "Series 2".
 */
const MERGE_SET_CODE_RE = /^(me|sv|swsh|sm|xy|bw|dp|hgss)\d{1,3}(\.\d)?[a-z]?$|^m\d[sl]$/i;

function mergeTokens(title: string): Set<string> {
  const stripped = stripEra(normalizeTitle(title));
  const out = new Set<string>();
  for (let w of stripped.split(/[\s/]+/)) {
    // Skiljetecken som blivit egna tokens ("Scarlet ex - sv1S" → "-") är inte identitet.
    // Utan detta skilde sig ordmängderna åt på ett bindestreck och en äkta dubblett missades.
    if (!w || !/[a-z0-9]/.test(w)) continue;
    if (MERGE_FILLER.has(w)) continue;
    if (MERGE_SET_CODE_RE.test(w)) continue; // ME04, sv1S, sv11B — men ALDRIG ett naket tal
    w = MERGE_SYNONYMS[w] ?? w;
    out.add(w);
  }
  return out;
}
/**
 * HELA den tvåsidiga vaktbatteriet i ETT anrop. Sann = titlarna motsäger varandra konkret.
 *
 * VARFÖR DEN FINNS: matchProduct körde alla dessa vakter, men veckodedupen (dedupe-stubs)
 * körde bara FYRA av dem (series, set-markör, språk, tin-display). Den skillnaden var inte
 * medveten — den hade bara glidit isär. Dry-runen 2026-07-14 visade vad det kostade: LLM:en
 * fick döma par som matchProduct aldrig ens hade övervägt, och sa "samma SKU" om
 *   "Umbreon V Tin (US VERSION)"    vs "Umbreon V Tin"
 *   "General Mills 2019 Booster"    vs "General Mills 25TH ANNIVERSARY Booster"
 *   "ACRYLIC Booster Box Display"   vs "Sun & Moon Booster Box + Acrylic case"   (tillbehör!)
 * och GTIN-förfiltret mergade "Pitch Black: GENGAR Premium Checklane" med "…LUXRAY…" (samma
 * sortiments-streckkod, olika karaktär) helt utan vakter.
 *
 * ALLA nya merge-vägar ska gå genom den här. En vakt som bara körs i EN kodväg är ingen vakt.
 */
export function productsConflict(a: string, b: string): boolean {
  const na = normalizeTitle(a);
  const nb = normalizeTitle(b);
  // Tillbehör (akrylfodral, pärm, spelmatta) är aldrig samma vara som produkten det rymmer.
  if (isAccessoryListing(a) !== isAccessoryListing(b)) return true;
  if (isSingleCardListing(a) !== isSingleCardListing(b)) return true;
  return (
    languageMismatch(na, nb) ||
    setMarkerMismatch(na, nb) ||
    setCodeMismatch(a, nb) ||
    seriesMismatch(na, nb) ||
    characterMismatch(a, nb) ||
    cardSuffixMismatch(a, nb) ||
    pokemonCenterMismatch(na, nb) ||
    premiumGradeMismatch(na, nb) ||
    regionVersionMismatch(na, nb) ||
    cardCountMismatch(na, nb) ||
    yearMismatch(a, nb) ||
    blisterMismatch(a, nb) ||
    unitCountMismatch(a, nb)
  );
}

/** Exakt samma vara, bara olika formulerad? Enda regeln som får radera en produkt. */
export function mergeEquivalent(a: string, b: string): boolean {
  const ta = mergeTokens(a);
  const tb = mergeTokens(b);
  if (ta.size !== tb.size || ta.size === 0) return false;
  for (const w of ta) if (!tb.has(w)) return false;
  return true;
}

/**
 * BÅDA titlarna har ett EGET identitetsord som den andra saknar.
 *
 * En äkta dubblett har det ALDRIG: butiken LÄGGER TILL ord (serienamn, set-kod, formord) —
 * den byter inte ut produktens namn. Men två OLIKA produkter gör precis det:
 *   "KANTO Friends Pikachu Tin"   vs "PALDEA Friends Pikachu Tin"
 *   "Generic LOVE Ball Tin"       vs "Generic LURE Ball Tin"
 *   "Galar PALS Mini Tin"         vs "Galar POWER Mini Tin"
 *   "Battle REGION Booster (JP)"  vs "Battle PARTNERS Booster (JP)"
 * Alla fyra länkades i prod med Dice 0,91–0,97 — alltså ÖVER auto-link-gränsen 0,85, helt
 * utan LLM-dom. Vakterna missade dem: "kanto"/"love"/"pals" är inte Pokémon-namn, och
 * täckningsgrinden släpper igenom på 0,667 mot tröskeln 0,60.
 *
 * DEN HÄR ANVÄNDS INTE SOM VETO. Mätt mot facit blockerar den 6 av 217 VERIFIERAT KORREKTA
 * länkar (butiken skriver "Suddgummi" där katalogen skriver "Eraser", "Summer 2026" där
 * katalogen skriver "Moonlit"). En falskt blockerad korrekt länk är värre än en felmatch —
 * den syns aldrig. I stället TAKAS konfidensen (se CONFLICT_CONFIDENCE_CAP): paret får inte
 * auto-länkas, utan måste förtjäna länken via identitetskontroll eller LLM-dom. Ingen länk
 * går förlorad; den tvivelaktiga slutar bara smyga in sig gratis.
 */
export function mutualIdentityConflict(incoming: string, candidate: string): boolean {
  const a = nonEraDistinctiveWords(incoming);
  const b = nonEraDistinctiveWords(candidate);
  if (a.size === 0 || b.size === 0) return false; // för lite info → låt övriga vakter avgöra
  const stem = (w: string) => (w.length > 3 && w.endsWith("s") ? w.slice(0, -1) : w);
  const A = new Set([...a].map(stem));
  const B = new Set([...b].map(stem));
  const onlyA = [...A].some((w) => !B.has(w));
  const onlyB = [...B].some((w) => !A.has(w));
  return onlyA && onlyB;
}

/**
 * Taket när båda sidor bär ett eget identitetsord. Precis UNDER auto-link-gränsen 0,85 →
 * paret hamnar i bandet som kräver bekräftelse (identisk ordmängd eller LLM-dom) i stället
 * för att bindas gratis. Aldrig under matcher-golvet 0,55: då hade länken FÖRSVUNNIT, och
 * en osynlig länk är precis det vi inte får orsaka.
 */
const CONFLICT_CONFIDENCE_CAP = 0.84;

/**
 * Minsta avstånd mellan bästa och näst bästa kandidat för att valet ska räknas som
 * avgjort. Under det är annonsen tvetydig och får ingen länk alls. Se marginal-
 * blocket i slutet av matchProduct för mätningen bakom talet.
 */
const AMBIGUITY_MARGIN = 0.03;

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
  // KANDIDATEN MÅSTE OCKSÅ ERA-RENSAS. Annars kan kandidatens ERA-ord "täcka" annonsens
  // PRODUKTNAMN, och era-ordet maskerar sig som identitet:
  //   annons   "Scarlet & Violet: SCARLET ex Booster Box"  → identitet {scarlet}
  //   kandidat "Scarlet & Violet: VIOLET ex Booster Box"   → orensad {scarlet, violet}
  // Kandidatens era-"scarlet" täckte då annonsens produkt-"scarlet" → coverage 1,00 i
  // stället för 0,50, vetot uteblev, och Dice 0,913 länkade Scarlet ex → VIOLET ex med
  // konfidens 1,000 (hittat 2026-07-13). Efter rensning: {violet} täcker inte {scarlet}
  // → coverage 0,50 → vetot slår till, som det ska.
  const cand = new Set([...nonEraDistinctiveWords(candidate)].map(stem));
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

// ── VAKTER FRÅN UPPFÖLJNINGEN 2026-07-14 ──────────────────────────────────────
// De 26 felaktiga länkar som 07-13-vakterna INTE fångade delade tre mönster, alla
// avgörbara ur TITELN (artikelnummer-spåret är utrett och dött — se
// scripts/generate-pokemon-names.ts + minnesanteckningen: POK-koder finns i ≥2
// butiker för bara 13 produkter, och Dragon's Lair, vår största felkälla, saknar
// dem helt). Alla tre är TVÅSIDIGA: de fäller bara när BÅDA titlarna anger något
// och det som anges KROCKAR. En ensidig variant ("kandidaten har ett ord annonsen
// saknar") är exakt den reverse-coverage-vakt som blockerade 178 korrekta länkar.

/**
 * Set-koder ur en titel: JP-baserade (sv1S, sv2P, sv4K, sv9a, s6h, sm12a) och
 * Mega Evolution-numreringen (ME02, ME4). Normaliseras till prefix + heltal +
 * ev. bokstavssuffix så att "ME02" och "ME2" är samma kod men "ME2" ≠ "ME4".
 *
 * Detta är setets IDENTITET. Två japanska displayer har nästan identisk Dice-likhet
 * ("Scarlet & Violet: Scarlet ex - sv1S, Display / Booster Box (Japansk)" mot
 * "… Snow Hazard - sv2P, …") — koden är det enda som skiljer dem åt.
 */
const SET_CODE_TOKEN = /^(sv|swsh|sm|xy|bw|me|s)(\d{1,2})([a-z])?$/;
export function setCodes(title: string): Set<string> {
  const codes = new Set<string>();
  for (const tok of normalizeTitle(title).split(" ")) {
    const m = SET_CODE_TOKEN.exec(tok);
    if (m) codes.add(`${m[1]}${parseInt(m[2], 10)}${m[3] ?? ""}`);
  }
  return codes;
}
/** True när båda titlarna anger set-kod(er) och INGEN delas → olika set. */
export function setCodeMismatch(a: string, b: string): boolean {
  const ca = setCodes(a);
  const cb = setCodes(b);
  if (ca.size === 0 || cb.size === 0) return false; // ensidigt → vet vi inget
  for (const c of ca) if (cb.has(c)) return false;
  return true;
}

/**
 * Kortsuffixet (ex/GX/V/VMAX/VSTAR) är produktidentitet, inte dekoration:
 * "Melmetal ex Battle Deck" och "Pokémon GO Battle Deck Melmetal V" är olika
 * produkter med samma karaktär — bara suffixet skiljer dem åt (och Dice ser dem
 * som nästan identiska).
 */
const CARD_SUFFIXES = new Set(["ex", "gx", "v", "vmax", "vstar", "vunion"]);
function cardSuffixes(title: string): Set<string> {
  const found = new Set<string>();
  for (const tok of normalizeTitle(title).split(" ")) {
    if (CARD_SUFFIXES.has(tok)) found.add(tok);
  }
  return found;
}
/** True när båda titlarna anger kortsuffix och INGET delas (ex ≠ V ≠ VMAX). */
export function cardSuffixMismatch(a: string, b: string): boolean {
  const sa = cardSuffixes(a);
  const sb = cardSuffixes(b);
  if (sa.size === 0 || sb.size === 0) return false;
  for (const s of sa) if (sb.has(s)) return false;
  return true;
}

/**
 * Karaktären (Pokémon eller tränare) är SKU:n i produktlinjer som annars delar
 * varenda ord: "Stellar Crown Checklane – Porygon2" ≠ "Stellar Crown: Koraidon
 * Premium Checklane Blister", "Generations 1 Booster (Venusaur Artwork)" ≠
 * "(Charizard Artwork)". deckCharacterMismatch gjorde detta för DECKS genom att
 * stryka linje-ord; den metoden går inte att generalisera (för sealed är de
 * kvarvarande orden setnamn, inte karaktärer). Här används i stället en riktig
 * karaktärsvokabulär — se src/scrapers/pokemon-names.ts (genererad).
 */
export function characterNames(title: string): Set<string> {
  // SNEDSTRECKET ÄR EN AVGRÄNSARE, INTE EN BOKSTAV. `normalizeTitle` behåller "/"
  // (kortnummer som "4/102" behöver det), så "psyduck/golduck" blev EN token som
  // förstås inte står i namnlistan — och titeln lästes som HELT karaktärslös. För
  // blistrar är det inte ett tomrum utan en motsägelse (blisterCharacterMismatch), så
  // "…3 Pack Blister (Psyduck/Golduck)" avvisades mot katalogens "…: Psyduck 3-Pack
  // Blister" trots att de delar karaktär. MÄTT 2026-08-07 över alla katalogtitlar och
  // butiksannonser: 20 titlar innehåller "ord/ord" och exakt 5 påverkas — alla fem får
  // karaktärer de borde ha haft (Sneasel/Weavile, Psyduck/Golduck, Zacian/Koraidon).
  // Ingen titel FÖRLORAR ett namn: en split kan bara ge fler tokens att slå upp.
  const toks = normalizeTitle(title).split(/[\s/]+/);
  const found = new Set<string>();
  for (let i = 0; i < toks.length; i++) {
    // Längsta n-gram först ("team rocket" före "rocket").
    for (let n = MAX_NAME_WORDS; n >= 1; n--) {
      if (i + n > toks.length) continue;
      const gram = toks.slice(i, i + n).join(" ");
      if (POKEMON_NAMES.has(gram)) {
        found.add(gram);
        break;
      }
    }
  }
  return found;
}
/**
 * True när båda titlarna namnger karaktärer och INGEN delas. Snittbaserad (inte
 * likhet): "Pikachu & Zekrom" mot "Zekrom" delar zekrom → ingen krock.
 */
/**
 * BLISTRAR IDENTIFIERAS AV KARAKTÄREN — och därför är en ENSIDIG karaktär en
 * motsägelse, inte ett tomrum.
 *
 * `characterMismatch` ger med flit upp när bara ena sidan nämner en Pokémon ("låt
 * övriga vakter avgöra"). Det är rätt för de flesta former, men fel för blistrar:
 * Cardmarket namnger alla 486 blistrar "Set: KARAKTÄR N-Pack Blister", dvs
 * karaktären ÄR SKU:n. Mätt 2026-08-07 band matcharen därför ihop
 *   "…Journey Together Checklane Blister SCRAGGY" → "…Journey Together Premium
 *    Checklane Blister" (0,95 — över auto-link-gränsen!)
 * och "…Stellar Crown … ROARING MOON" → "Stellar Crown: ANCIENT …". Båda är olika
 * varor, och 0,95 hade länkats utan att någon fick frågan.
 *
 * ⛔ Bara för form `blister` i BÅDA titlarna. En ETB-titel får gärna nämna en
 *    Pokémon som katalogen utelämnar (omslagskonst) — där vore vetot fel.
 */
export function blisterCharacterMismatch(a: string, b: string): boolean {
  if (classifyForm(normalizeTitle(a)) !== "blister") return false;
  if (classifyForm(normalizeTitle(b)) !== "blister") return false;
  const na = characterNames(a);
  const nb = characterNames(b);
  if (na.size === 0 && nb.size === 0) return false; // båda generiska → inget att jämföra
  if (na.size === 0 || nb.size === 0) return true; // en namnger sin, den andra inte
  for (const n of na) if (nb.has(n)) return false;
  return true;
}

/**
 * Skiljer sig titlarna på ett KORT ord som bär produktidentitet?
 *
 * Dice-poängen är blind för ett ensamt tecken, och det är precis där de dyraste
 * felmatchningarna bor. Dokumenterat i `dedupe-catalog.ts`: "Mega Charizard **X** ex Tin"
 * mot "Mega Charizard **Y** ex Tin" väger 1,00, och "Base Set **2** Booster Pack" mot
 * "Base Set Booster Pack" 0,95. Alla är OLIKA varor. MÄTT i produktion 2026-08-08:
 * Hobbykorts `/pokemon-scarlet-violet-base-set-booster-pack` (79 kr) satt på vår
 * "Base Set 2 Booster Pack" (3 275 kr) — och en ren likhetsprövning kallade den KORREKT.
 *
 * Jämförelsen görs på RÅTITELN: `normalizeTitle` behåller tokenet, men Dice tappar det.
 *
 * ⛔ ETT SIFFERTOKEN ÄR INTE ALLTID IDENTITET. "…long crimp, **1** Booster" mot
 *    "Base Set 2 Booster Pack" skiljer sig på "1" — ett ANTAL, inte en vara. Anroparen
 *    säger därför med `sameSet` om posterna redan är bundna till samma set; är de det
 *    kan en siffra inte gärna vara setnamnets, och den ignoreras. Enstaka BOKSTÄVER
 *    (X/Y) är alltid identitet — de är varianten, och de bor inom ett och samma set.
 */
export function identityTokenDifference(a: string, b: string, sameSet: boolean): string | null {
  const toks = (t: string) =>
    decodeTitle(t).toLowerCase().replace(/[^a-z0-9åäö ]+/g, " ").split(/\s+/).filter(Boolean);
  const ta = toks(a), tb = toks(b);
  const onlyIn = (x: string[], y: string[]) => x.filter((t) => !y.includes(t));
  const diff = [...new Set([...onlyIn(ta, tb), ...onlyIn(tb, ta)])];
  const flagged = diff.filter((t) => {
    if (t.length > 2) return false;
    if (/^[a-zåäö]$/.test(t)) return true;
    if (/^\d{1,2}$/.test(t)) return !sameSet;
    return false;
  });
  return flagged.length ? flagged.join("/") : null;
}

export function characterMismatch(a: string, b: string): boolean {
  const na = characterNames(a);
  const nb = characterNames(b);
  if (na.size === 0 || nb.size === 0) return false; // ensidigt → låt övriga vakter avgöra
  for (const n of na) if (nb.has(n)) return false;
  return true;
}

/**
 * De japanska basseten sv1S/sv1V heter "Scarlet ex" / "Violet ex" och kolliderar
 * med engelska "Scarlet & Violet" (delar orden scarlet/violet). En annons som säger
 * "Violet ex Booster Pack" är japansk även utan ordet "japansk" i titeln (säljaren
 * skriver ofta det bara i beskrivningen, som vi inte läser). Engelska produkter heter
 * aldrig "<X> ex" som SET-namn → säker markör. Behandlas som en JP-markör.
 */
const JP_SET_MARKERS = /\b(scarlet|violet)\s+ex\b/i;

/** Titelns språk (JP/CN/KR/EU/EN) inkl. JP-set-markören som språksignal. */
export function titleLanguage(t: string): ReturnType<typeof detectListingLanguage> {
  const l = detectListingLanguage(t);
  return l === "EN" && JP_SET_MARKERS.test(t) ? "JP" : l;
}

/**
 * True om titlarna anger OLIKA språk. Per-språk (inte binärt EN/icke-EN):
 * en koreansk annons fick tidigare matcha en japansk produkt eftersom båda
 * räknades som "icke-EN" — så hamnade Shinycards "…Koreansk"-sidor som offers
 * på "(Japansk)"-produkter.
 */
export function languageMismatch(incoming: string, candidate: string): boolean {
  return titleLanguage(incoming) !== titleLanguage(candidate);
}

/**
 * En annons/produkt som nämner ett sifferset (NUMERIC_SET_NAMES, t.ex. "151") får
 * inte matcha en som inte gör det — annars matchar "Scarlet & Violet 3.5 … 151
 * Booster Pack" fel mot bas-"S&V Booster Pack" (delar era-orden scarlet/violet).
 */
export function setMarkerMismatch(a: string, b: string): boolean {
  const ta = new Set(normalizeTitle(a).split(" "));
  const tb = new Set(normalizeTitle(b).split(" "));
  for (const name of NUMERIC_SET_NAMES) if (ta.has(name) !== tb.has(name)) return true;
  return false;
}

/**
 * "Pokémon Center"-exklusiva varianter (PC ETB m.fl.) är EGNA, dyrare produkter.
 * En vanlig "Obsidian Flames Elite Trainer Box"-annons delar ALLA vanliga
 * särskiljande ord med "Obsidian Flames Pokémon Center Elite Trainer Box"
 * ("pokemon" är stoppord, "center" bara 1 av 3 kandidatord) → den slank igenom
 * och visade en falsk −47%-deal mot PC-boxens CM-pris. Hård vakt: nämner bara
 * ENA sidan "pokemon center" är det olika produkter.
 */
const POKEMON_CENTER_RE = /\bpokemon center\b/;
export function pokemonCenterMismatch(a: string, b: string): boolean {
  return POKEMON_CENTER_RE.test(normalizeTitle(a)) !== POKEMON_CENTER_RE.test(normalizeTitle(b));
}

/**
 * "Ultra-Premium" och "Super-Premium" är EGNA, dyrare produktlinjer — inte formuleringar
 * av "Premium". Graden är namngiven av tillverkaren och står alltid utskriven i både
 * butikens och katalogens titel; den som utelämnar den säljer en annan vara.
 *
 * ULTRA (2026-07-13): "Arceus VSTAR ULTRA-Premium Collection" slank igenom mot katalogens
 * "Arceus VSTAR Premium Collection" med Dice 0,879 — ÖVER auto-link-gränsen 0,85, alltså
 * länkning HELT utan LLM-dom. "premium" är dessutom FORM_NOISE, så "ultra" var det enda
 * som skilde dem — och nonEraCoverage landade på 0,667, precis över 0,6-tröskeln.
 *
 * SUPER (2026-07-29): Shinycards "Prismatic Evolutions Suprise Box Collection" (999 kr)
 * blev offer på "Prismatic Evolutions Super-Premium Collection" med 0,7195 — HÖGRE än
 * den rätta produkten "Prismatic Evolutions Surprise Box" (0,6941), så fel produkt vann
 * på ren poäng. Samma signatur som ultra-fallet: de delar set-namnet, "premium"/"box"/
 * "collection" är formord, och nonEraCoverage blev exakt 0,667 igen. Följden blev
 * synlig direkt på produktsidan — headline-priset visade Surprise Box-priset 999 kr
 * som "lägsta pris" för en produkt vars verkliga golv är ~2 600 kr.
 *
 * Tvåsidig som alla andra vakter, och graderna jämförs mot VARANDRA: den slår när bara
 * ena sidan namnger en grad, ELLER när båda gör det och graderna skiljer sig
 * (Ultra-Premium ≠ Super-Premium). Nämner ingen av dem en grad är den tyst — en ren
 * "Premium Collection"-annons mot en "Premium Collection"-produkt rör vi inte.
 */
const PREMIUM_GRADE_RE = /\b(ultra|super)[\s-]?premium\b/;
export function premiumGradeMismatch(a: string, b: string): boolean {
  return PREMIUM_GRADE_RE.exec(normalizeTitle(a))?.[1] !== PREMIUM_GRADE_RE.exec(normalizeTitle(b))?.[1];
}

/**
 * REGION-VARIANTER ("US Version" / "EU Version") är EGNA CM-SKU:er och får ALDRIG slås ihop
 * — det är ett uttryckligt katalogbeslut. Ändå gav Dice 0,927 för
 * "Flareon VMAX Premium Collection US Version" mot "… EU Version" (bara ETT tecken skiljer
 * ordet åt) → långt över auto-link-gränsen 0,85, alltså länkning UTAN LLM-dom.
 * Tvåsidig: slår bara när båda deklarerar en region OCH de skiljer sig.
 */
const REGION_RE = /\b(us|eu|uk|asia|asian|jp|japanese)[\s-]?version\b/;
export function regionVersionMismatch(a: string, b: string): boolean {
  const ra = REGION_RE.exec(normalizeTitle(a))?.[1];
  const rb = REGION_RE.exec(normalizeTitle(b))?.[1];
  return !!ra && !!rb && ra !== rb;
}

/**
 * "(N Cards)" — antalsvarianter är EGNA katalogprodukter (variant-price-split-beslutet:
 * common → RapidAPI, variant → pokemontcg.io, som SKILDA kort). "EX Deoxys Booster (5 Cards)"
 * är alltså inte "Deoxys Booster Pack". Tvåsidig: bara när båda anger ett antal OCH de skiljer.
 * Anger bara ENA sidan ett antal är den tyst — annars hade vi blockerat massor av korrekta
 * butikslänkar som helt enkelt utelämnar antalet, och en falskt blockerad länk är värre.
 */
/*
 * OBS: normalizeTitle STRIPPAR parenteser — "(6 Cards)" blir "6 cards". Regexet får därför
 * INTE kräva parenteser (första versionen gjorde det och matchade aldrig något).
 */
const CARD_COUNT_RE = /\b(\d{1,3})\s*(?:cards?|kort)\b/;
export function cardCountMismatch(a: string, b: string): boolean {
  const ca = CARD_COUNT_RE.exec(normalizeTitle(a))?.[1];
  const cb = CARD_COUNT_RE.exec(normalizeTitle(b))?.[1];
  return !!ca && !!cb && ca !== cb;
}

/*
 * INGEN premiumTierMismatch-VAKT. Frestande — "Premium Checklane" och "Checklane" ÄR skilda
 * SKU:er med skilda streckkoder (196214140615 vs 196214140547), och Dice gav 0,939 mellan dem.
 * MEN regressionsfixturen underkände den direkt: den blockerade en VERIFIERAT KORREKT länk,
 *     feed "Pokémon ME02 Phantasmal Flames Checklane"
 *     ours "Phantasmal Flames: Blaziken Premium Checklane Blister"
 * — butiken utelämnar helt enkelt ordet "Premium". En falskt blockerad KORREKT länk är värre
 * än en felmatch (den syns aldrig), så vakten får inte finnas. Vill man skilja dem åt är
 * STRECKKODEN rätt verktyg, inte titeln. Återinför den inte utan att köra facit först.
 */

/** "Series N" / "Vol N" ur en titel — produktidentitet för numrerade utgåvor. */
function seriesNumber(t: string): string | null {
  const m = /\b(?:series|serie|vol|volume)\s*(\d{1,2})\b/i.exec(t);
  return m ? m[1] : null;
}
/**
 * Två titlar med OLIKA serienummer är olika produkter — "First Partner Illustration
 * Collection Series 1" ≠ "Series 2" (siffran tappas annars i distinctiveWords, så
 * de delar alla särskiljande ord och matchar fel). Bara ett hårt nej när BÅDA anger
 * ett nummer och de skiljer sig.
 */
export function seriesMismatch(a: string, b: string): boolean {
  const sa = seriesNumber(a);
  const sb = seriesNumber(b);
  return sa !== null && sb !== null && sa !== sb;
}

/**
 * Butiks-skräp i annonstitlar som varken är produktidentitet eller språk:
 * köpbegränsningar, förbokningsmarkörer, butikens egna kopie-/antalssuffix.
 * Tas bort innan titeln används som katalognamn eller matchas — annars hamnar
 * "(MAX 1 per kund)" i produkttiteln och sänker matchpoängen så att samma SKU
 * från olika butiker blir dubblettprodukter.
 */
const LISTING_TITLE_JUNK: RegExp[] = [
  /\(?\bmax\.? ?\d+(?: ?st\.?)?\s*(?:\/|per\b)? ?(?:kund|hushåll|person|customer)?!?\)?/gi,
  /\(?\bförhandsbok\w*\)?/gi,
  /\(?\bpre-?order\w*\)?/gi,
  /\((?:copy|kopia)(?: \d+)?\)/gi,
  /[-–—]\s*(?:copy|kopia)(?: \d+)?\s*$/gi,
  /\(\d+ ?(?:pcs|st)\.?\)/gi,
  // Innehållsbeskrivare i parentes: "(5 Cards)" = kort per paket, "(30 Boosters)"/
  // "(20 Pack)" = paket per display. INTE produktidentitet. Paket-varianten kräver
  // ≥5 så en eventuell lot-annons "(3 boosters)" inte tvättas till enskild produkt
  // (riktiga displayer har 10+, riktiga lotar 2–4 → multipack-vakten tar dem).
  /\(\d+ ?(?:cards?|kort)\)/gi,
  /\((?:[5-9]|\d{2,}) ?(?:boosters?|packs?|paket)\)/gi,
  // OMSLAGSKONST: "(Charizard X Artwork)", "(Venusaur Artwork)". Samma SKU, annan
  // packbild — Cardmarket modellerar det inte separat och ägaren räknar det som dubblett.
  // Att strippa den HÄR är självläkande: alla omslagsvarianter normaliseras till SAMMA
  // titel, så variant nr 2 auto-länkar till variant nr 1 (poäng 1,00) i stället för att
  // bli en ny katalograd. Utan det blev varje omslag en egen produkt — och att merga dem
  // hjälpte inte: butiks-URL:en blev herrelös och restock-skanningen skapade om stubben
  // inom minuter (mätt 2026-07-14: tre stubbar återuppstod 19:52, sju minuter efter merge).
  /\([^)]*\b(?:artwork|art)\b[^)]*\)/gi,
  // DANSK MOMSORDNING: "… / Brugtmoms" vs "… / Alm. moms". Rogerz (rogerz.dk, wave 5)
  // listar VARJE begagnad vara TVÅ gånger — en gång under vinstmarginalordningen för
  // begagnat och en gång under vanlig moms. Det är samma fysiska SKU till olika
  // prissättning, alltså butiksadministration, inte produktidentitet.
  // MÄTT 2026-08-13: 331 av 898 nyimporterade titlar bar taggen, och 156 av dem var
  // rena tvillingpar som blev var sin katalogprodukt. Noll av katalogens 31 216
  // äldre titlar innehåller orden — regeln kan inte röra befintlig data.
  // Strippningen är självläkande på samma sätt som omslagskonsten ovan: båda
  // varianterna normaliserar till samma titel, så den andra auto-länkar (1,00) i
  // stället för att bli en ny rad. Formen är delimiterad ("- Alm. moms /", "/ Brugtmoms")
  // eftersom taggen även dyker upp MITT i titeln ("… Box - Alm. moms / Mewtwo X …").
  /\s*[-–—/|]\s*(?:brugtmoms|alm\.?\s*moms)\b/gi,
];

/**
 * Ledande "Pokémon TCG:" / "Pokemon Trading Card Game" — rent brus i katalognamn
 * (ägarbeslut 2026-07-19): HELA katalogen är Pokémon TCG, prefixet särskiljer
 * inget. Bara LEDANDE prefix strippas — "Pokémon GO", "Pokémon 151" osv. mitt i
 * titeln är set-identitet och lämnas orörda.
 */
const TCG_PREFIX_RE = /^pok[eé]mon\s*(?:tcg|trading\s*card\s*game)\b\s*[:\-–—]*\s*/i;
export function stripTcgPrefix(title: string): string {
  const stripped = title.replace(TCG_PREFIX_RE, "").trim();
  return stripped.length >= 4 ? stripped : title;
}

/** Rensar butiks-skräp ur en annonstitel (identitet + språkmarkörer lämnas orörda). */
export function cleanListingTitle(title: string): string {
  // HTML-entiteter från feeds (Quickbutik skickar "&amp;") — avkoda innan
  // matchning/namnsättning, annars blir "&amp;" en del av katalogtiteln.
  let s = title
    .replace(/&amp;/gi, "&")
    .replace(/&#0?39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/&nbsp;/gi, " ");
  for (const re of LISTING_TITLE_JUNK) s = s.replace(re, " ");
  const cleaned = s
    .replace(/[[(]\s*[\])]/g, " ") // tomma parentes-/hakparentespar efter junk-strip
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([,)!])/g, "$1")
    .replace(/^[\s,–—-]+|[\s,–—-]+$/g, "")
    .trim();
  // Sist så att prefixet fångas även när butiksjunk låg framför det.
  return stripTcgPrefix(cleaned);
}

// ─────────────────────────────────────────────────────────────────────────────
// VAKTER FRÅN KATALOGREVISIONEN 2026-07-13
//
// Varje butikslänk hämtades live och jämfördes mot produkten vi kopplat den till.
// 76 av 1 275 pekade på FEL produkt. Vakterna nedan är byggda mot det facit — och
// mätta mot det: de får inte avvisa ett enda par som dagens vakter släpper igenom
// korrekt. Se tests/unit/matching-audit.test.ts, som kör hela facit som regression.
// ─────────────────────────────────────────────────────────────────────────────

/** Årtal i en produkttitel (2015–2035). Kalenderår ÄR produktidentitet. */
const YEAR_RE = /\b(20[1-3]\d)\b/g;
function years(t: string): Set<string> {
  return new Set(t.match(YEAR_RE) ?? []);
}
/**
 * Poké Ball Tin **2025** ≠ Poké Ball Tin **2026**. Trainer's Toolkit 2025 ≠ 2023.
 * Trick or Trade 2024 ≠ 2023. Fall 2026 Mini Portfolio ≠ Fall 2024.
 * Butikerna säljer flera årgångar samtidigt och Dice-likheten är nästan 1 —
 * årtalet är det ENDA som skiljer dem. 6 felaktiga länkar kom härifrån.
 * Bara när BÅDA titlarna bär ett årtal: saknas det på ena sidan vet vi inget.
 */
export function yearMismatch(a: string, b: string): boolean {
  const ya = years(a);
  const yb = years(b);
  if (ya.size === 0 || yb.size === 0) return false;
  for (const y of ya) if (yb.has(y)) return false; // minst ett gemensamt år → ok
  return true;
}

/**
 * Ser annonsen ut som ett ENSKILT KORT? Butiker som Samlarhobby/Shinycards säljer
 * både sealed och singlar ur samma feed. Ett kortnummer/promokod/graderingsbetyg i
 * titeln = singel, och en singel får ALDRIG bli offer på en sealed-produkt:
 *   "Skeledirge ex - SVP081 Black Star Promo"      → "Paldean Fates: Skeledirge ex Premium Collection"
 *   "Reshiram & Charizard GX (sm12a 220) - PSA 10" → "Tag Team ... Premium Collection"
 *   "Charizard (CEL BS 4) Celebrations - PSA 10"   → "Celebrations: Lance's Charizard V Tin"
 * Formvakten missade dem: en singel-titel saknar formord → classifyForm = null →
 * `fa && fb && fa !== fb` hoppades över helt. 8 felaktiga länkar kom härifrån.
 */
const SINGLE_CARD_SIGNS = [
  // "(sm12a 220)", "(CEL BS 4)", "(FLF 11)" — setkod MELLANSLAG kortnummer.
  // Mellanslaget är KRAVET: utan det träffas japanska SETKODER "(sv3)" "(sv6)" "(sv7)",
  // som sitter på riktiga booster box-annonser → 3 korrekta länkar blockerades.
  /\(\s*[a-z]{2,6}\d{0,2}[a-z]?\s+(?:bs\s+)?\d{1,3}\s*\)/i,
  /\bsvp\s*\d{2,3}\b/i, // SVP081 Black Star Promo
  /\bblack star promo\b/i,
  /\bpsa\s*\d{1,2}\b/i, // graderat kort
  /\b(bgs|cgc)\s*\d{1,2}(\.\d)?\b/i,
  // "Noctowl #141". Krav på blanksteg/parentes före # — annars träffar HTML-entiteten
  // &#039; (apostrof) i feed-titlar: "Cynthia&#039;s Garchomp" flaggades som singel.
  /(?:^|[\s(])#\s?\d{1,3}\b/,
  // SAMLARNUMMER/TOTAL — "Gapejaw Bog 213/195", "Raihan TG27/TG30", "050/071".
  // Det vanligaste singel-tecknet av alla, och det saknades: butikerna vi hämtade
  // förut sålde nästan bara sealed, så hålet syntes aldrig. Pocketmonsters
  // (leksaksbutik med 1 592 poster under "pokemonkort") fyllde en hel provkörning
  // med sådana titlar som alla passerade som "sealed".
  //
  // ⛔ MÄTT FÖRE PÅSLAG (2026-08-07): 0 av 1 466 sealed-titlar i de fem befintliga
  //    butikernas riktiga feedar och 0 av 1 633 sealed-produkter i katalogen träffas.
  //    Måttet är kravet — tecknet sitter i productsConflict och en falsk träff där
  //    BLOCKERAR en korrekt butikslänk, tyst.
  // ⛔ Kräver avgränsare runt hela uttrycket: utan dem träffar "1/2" i "1/2 pris" och
  //    årtal som "2024/2025".
  // Bokstavsprefixet är valfritt och gäller BÅDA sidor: delserierna numrerar så
  // ("TG27/TG30", "GG08/GG70", "SWSH034/SWSH299") och det är just de tryckningar
  // någon bryr sig om att lista — en vanlig common säljs sällan styckvis.
  /(?:^|[\s(\[])[A-Za-z]{0,3}\d{1,3}\s*\/\s*[A-Za-z]{0,3}\d{2,3}(?:$|[\s)\]])/,
];
export function isSingleCardListing(title: string): boolean {
  return SINGLE_CARD_SIGNS.some((re) => re.test(title));
}

/**
 * Ser annonsen ut som ett TILLBEHÖR? Spelmatta, pärm/portfolio, sleeves, deckbox,
 * akrylskydd. Samma hål som ovan (inget formord → ingen vakt):
 *   "Mega Charizard X/Y Spelmatta"        → "Mega Charizard X ex Tin"
 *   "Charmander Mini Pärm - 3 Pocket"     → "Phantasmal Flames Booster + Mini Pärm"
 *   "Acrylic Booster Box Display"         → "Sun & Moon Display / Booster Box"
 * ⛔ Pärm/portfolio ÄVEN MED booster är tillbehör (ägarbeslut, två gånger:
 *    denylisten 2026-07-18 och kataloggenomgången 2026-08-08 raderade VARJE
 *    "Mini Portfolio + Booster"/"Mini Album with Booster"). Det gamla undantaget
 *    ("portfolio som innehåller en booster är en riktig SKU") är därför BORTTAGET —
 *    det var exakt hålet som släppte in dem igen via de nya butikerna.
 */
// "long crimp"/"short crimp" = vintagepåse SÅLD PÅ KRYMPNINGEN (samlarobjekt värderat
// på förpackningsdetaljen, inte innehållet) — ingen katalog-SKU (ägarbeslut 2026-08-08).
// Ordparet förekommer aldrig i en riktig produkttitel, så det bor bland tillbehörstecknen
// trots att det inte är ett tillbehör: effekten (aldrig en katalogprodukt) är densamma.
const ACCESSORY_SIGNS =
  /\b(spelmatta|playmat|lekmatta|sleeves?|kortfodral|deck ?box|kortl[åa]da|akryl\w*|acrylic|skyddsfodral|toploader|binder|(long|short)[- ]?crimp)\b/i;

// INNEHÅLLET INGÅR INTE = inte varan (2026-08-08). TCG Store sålde tio "Mini Tin +
// Art Card & Coin (Boosters ingår ej)" — TOMMA tins, alla blev katalogprodukter
// bredvid de riktiga. En titel som säger att kort/boosters INTE följer med beskriver
// ett tillbehör oavsett vilka formord den bär, så den här vakten står ÖVER
// sealed-formordet (till skillnad från merch-vakten).
const CONTENT_EXCLUDED_SIGNS =
  /\b(ingår|medföljer)\s+(ej|inte)\b|\bnot\s+included\b|\butan\s+boosters?\b/i;

// Lösa mynt/jumbokort som säljs separat ur en collection ("151 Ultra Premium
// Collection Jumbo Mynt", 2026-08-08). Bart "mynt"/"coin" är FÖRBJUDET — riktiga
// blistrar skriver ut att promos + mynt ingår.
const LOOSE_EXTRAS_SIGNS = /\bjumbo\s?(mynt|coin|kort|card)\b/i;

// RAM = en tom bildram, inte kortet i den (2026-07-26). "Mega Darkrai ex 116/084
// Extended Artwork-ram för Pokémonkort" (179 kr) matchade kortet med samma nummer
// och blev produktens lägsta pris — mot CM:s 3 207 kr. Annonsen bär kortets NAMN och
// NUMMER, så varken nummervakten eller namnlikheten kan skilja dem; bara ordet "ram"
// gör det. `\bram\b` är säkert i just det här ordförrådet: ordgränsen skyddar
// Rampardos/Rampage/Ramos, och ett kort SÅLT i ram är ändå ett paket, inte kortet.
const FRAME_SIGNS = /\b(kortram|ram|ramar|ramen|inramad|inramning|card\s?frame)\b/i;
const PORTFOLIO_SIGNS = /\b(p[äa]rm|portfolio|album|pocket)\b/i;

// Tredjeparts-TILLVERKARE av tillbehör. Ingen av dem tillverkar Pokémon-kort, så
// namnet ensamt räcker som dom. Exakta fraser — "ultra" ensamt är FÖRBJUDET, det
// finns riktiga SKU:er som heter "Ultra Premium Collection".
const ACCESSORY_BRANDS =
  /\b(ultra[- ]?pro|ultimate guard|evoretro|dragon shield|gamegenic|arkero|palms off|zenaq)\b/i;

// Skydds-/förvaringsord. Måste slå ÄVEN när titeln innehåller "booster", för det är
// just då de smiter förbi: "Ultra Pro Booster Pack UV ONETOUCH Magnetic Holder" och
// "Evoretro PET Protectors for Pokemon Booster Display Boxes (5-Pack)" lästes båda
// som sealed av classifyForm ("Booster Pack" / "Booster Display") och importerades
// som produkter (2026-07-14). Butikssidorna säger uttryckligen "Booster pack and
// cards not included".
// Bart "case" är FÖRBJUDET här — "Booster Case" är en RIKTIG sealed-SKU (en kartong
// displayer), t.ex. "Paldea Evolved 24 Sleeved Booster Case".
const PROTECTOR_SIGNS =
  /\b(one[- ]?touch|magnetic holder|protectors?|skyddsplast|display[- ]?skydd)\b/i;

// ── OMSLAGSKONST ÄR INTE EN EGEN PRODUKT (2026-07-14) ────────────────────────
// Samlarhobby säljer vintage-boosters på PACKETS BILD:
//   "Pokémon, XY: Flashfire, 1 Booster (Charizard X Artwork)"
//   "Pokémon, XY: Flashfire, 1 Booster (Charizard Y Artwork)"   ← samma vara, annan bild
// Det är EN SKU. Cardmarket modellerar inte omslagskonst separat, och ägaren har sagt
// rakt ut: samma vara med olika omslag = dubblett.
//
// Utan den här regeln blev VARJE omslag en egen katalogprodukt — och att MERGA dem
// hjälpte inte: merge:n raderar stubbens offer (unik nyckel: en offer per butik och
// produkt), butiks-URL:en blir HERRELÖS, och nästa restock-skanning ser en sealed-URL
// utan offer och SKAPAR OM stubben inom minuter. Mätt: tre stubbar återuppstod 19:52,
// sju minuter efter att de mergats bort. Whack-a-mole tills matchningen känner igen dem.
const WRAPPER_ART = /\(([^)]*\b(?:artwork|art)\b[^)]*)\)/i;
export function isWrapperArtListing(title: string): boolean {
  return WRAPPER_ART.test(title);
}
export function stripWrapperArt(title: string): string {
  return title.replace(WRAPPER_ART, " ").replace(/\s{2,}/g, " ").replace(/\s+,/g, ",").trim();
}

/** En ENSKILD booster-påse (inte display/box, inte blister, inte bundle). */
function isSingleBoosterPack(t: string): boolean {
  const s = t.toLowerCase();
  if (/\b(box|display|case|bundle|blister|tin|etb|elite trainer)\b/.test(s)) return false;
  return /\bbooster\b|\bpack\b/.test(s);
}
/** "(5 Cards)", "(3 Cards)" = EGNA CM-SKU:er (Dollar Tree m.fl.) — aldrig samma som baspacken. */
const CARD_COUNT_PAREN = /\(\s*\d+\s*cards?\s*\)/i;

/**
 * Är butikens omslagskonst-annons samma SKU som vår baspack?
 *
 * DETERMINISTISK och GRATIS — körs i 0,55–0,85-bandet FÖRE LLM-domen, precis som
 * identicalIdentity. Det är avgörande: Anthropic-kvoten är slut, och utan den här
 * regeln föll hela bandet tillbaka på "skapa en stub".
 *
 * SMAL MED FLIT. Tre krav, alla måste hålla:
 *   1. Annonsen bär omslagskonst i parentes.
 *   2. BÅDA är enskilda booster-påsar. En påse är ALDRIG en box — och utan formkravet
 *      vann faktiskt boxen: "Flashfire Booster Box" fick 0,65 mot baspackens 0,64 när
 *      artwork-parentesen strippats (färre tokens → högre Dice). Se packVsBoxMismatch.
 *   3. Kandidaten har INGET kortantal i parentes. "(5 Cards)"/"(3 Cards)" är egna SKU:er.
 */
export function wrapperArtSameProduct(feedTitle: string, candidateTitle: string): boolean {
  if (!isWrapperArtListing(feedTitle)) return false;
  if (CARD_COUNT_PAREN.test(candidateTitle)) return false;
  const stripped = stripWrapperArt(feedTitle);
  if (CARD_COUNT_PAREN.test(stripped)) return false;
  if (!isSingleBoosterPack(stripped) || !isSingleBoosterPack(candidateTitle)) return false;
  // Setet måste vara detsamma — "Flashfire" mot "Generations" får aldrig bindas.
  if (distinctiveOverlap(normalizeTitle(stripped), normalizeTitle(candidateTitle)) < 0.6) return false;
  return scoreSimilarity(stripped, candidateTitle) >= 0.55;
}

/**
 * En PÅSE är aldrig en BOX. Saknades helt som vakt: "Pokémon, XY: Flashfire, 1 Booster"
 * matchade "Flashfire Booster Box" med 0,65 och INGEN vakt slog. Boxen kostar 100x påsen.
 */
export function packVsBoxMismatch(a: string, b: string): boolean {
  const box = (t: string) => /\b(booster\s*)?(box|display|case)\b/i.test(t);
  const pack = (t: string) => !box(t) && /\bbooster\b|\bpack\b/i.test(t);
  return (box(a) && pack(b)) || (pack(a) && box(b));
}

export function isAccessoryListing(title: string): boolean {
  if (ACCESSORY_SIGNS.test(title)) return true;
  if (ACCESSORY_BRANDS.test(title)) return true;
  if (PROTECTOR_SIGNS.test(title)) return true;
  if (FRAME_SIGNS.test(title)) return true;
  if (CONTENT_EXCLUDED_SIGNS.test(title)) return true;
  if (LOOSE_EXTRAS_SIGNS.test(title)) return true;
  // Pärm/album/portfolio = tillbehör, ÄVEN med booster (ägarbeslut — se ovan).
  // ⛔ UNDANTAG: "… Album 2-Pack Blister" är en RIKTIG CM-SKU (albumet säljs I en
  //    blister: Guardians Rising Collector's Album, Goodra Mini Album — mätt mot
  //    katalogen 2026-08-08, de enda två träffarna). Ägarens raderade bundlar sa
  //    alla "Portfolio + Booster"/"Album with Booster", aldrig "Blister".
  if (PORTFOLIO_SIGNS.test(title) && !/\bblister\b/i.test(title)) return true;
  return false;
}

// ANDRA TCG-FRANCHISER: butikernas Pokémon-kollektioner läcker ibland grannspel
// (Speltrollets akrylfodral "for One Piece Booster Box" mejlades som "ny produkt"
// 2026-07-16 — och en ÄKTA One Piece-box hade blivit en katalogprodukt). En Pokémon-
// katalog importerar/larmar aldrig om dem. DENYLIST med flit — "kräv pokemon i titeln"
// hade fällt äkta SKU:er som "Ascended Heroes Booster Bundle". Bart "magic"/"altered"/
// "sorcery" är FÖRBJUDET (för generiska ord); MTG känns igen på "MTG"/"Magic: "/"Magic
// the Gathering".
// "naruto" m.fl. anime-TCG:er saknades — "Naruto Mythos TCG: First Set Special Pack
// Collection Box" blev en katalogprodukt via Pokétalk (ägarens kataloggenomgång
// 2026-08-08). Orden nedan förekommer aldrig i en Pokémon-titel.
// ⚠️ EN BLOCKLISTA KAN ALDRIG BLI KOMPLETT: "KPop Demon Hunters Energy Edition
// Booster Box" (Beam Cardshop) tog sig in för att ingen kände till franchisen.
// Därför finns numera även den POSITIVA vakten hasPokemonTitleSignal nedan —
// den här listan är kvar som snabbt förstahandsfilter (den fångar även TILLBEHÖR
// för andra spel, som den positiva vakten inte ser).
const OTHER_FRANCHISE_SIGNS =
  /\b(one\s?piece|lorcana|yu-?gi-?oh|yugioh|digimon|dragon\s?ball|star\s?wars|flesh\s?and\s?blood|riftbound|union\s?arena|weiss\s?schwarz|grand\s?archive|gundam|mtg|magic\s+the\s+gathering|naruto|jujutsu\s?kaisen|demon\s?slayer|my\s?hero\s?academia|hunter\s?x\s?hunter|mythos\s?tcg|k-?pop|demon\s?hunters)\b|\bmagic:\s/i;
export function isOtherFranchiseListing(title: string): boolean {
  return OTHER_FRANCHISE_SIGNS.test(title);
}

/**
 * POSITIV POKÉMON-EVIDENS (2026-08-08): en NY katalogprodukt måste kunna BEVISA att
 * den är Pokémon — ordet Pokémon, ett Pokémon-namn i titeln, ett känt setnamn ur vår
 * egen katalog, eller en produktlinje som bara finns hos Pokémon (Elite Trainer Box,
 * VMAX/VSTAR, Poké Ball …). Frånvaro av ALLA signaler = varan kan vara vad som helst
 * ("KPop Demon Hunters Energy Edition Booster Box" bar ingen enda signal).
 *
 * ⛔ Används BARA vid SKAPANDET av nya produkter (som karaktärslös-vakten): en
 *    annons som matchar en befintlig produkt (ägd URL, GTIN, titel, LLM-dom) länkas
 *    som vanligt oavsett signal. Kostnaden för en falsk avvisning är alltså en
 *    UPPSKJUTEN produkt, aldrig en förlorad länk.
 * ⛔ setNames MÅSTE vara normaliserade (normalizeTitle) och ≥ 3 tecken — tvåtecknare
 *    som "XY" substrängmatchar skräp ("galaxy").
 */
const POKEMON_LINE_SIGNS =
  /\b(pok[eé]mon|pikachu|elite\s*trainer|etb|vmax|vstar|v-?union|pok[eé]\s?ball|premium\s*tournament\s*collection|trainer'?s\s*toolkit|build\s*(&|and)\s*battle|trick\s*or\s*trade)\b/i;
export function hasPokemonTitleSignal(title: string, normalizedSetNames: ReadonlySet<string>): boolean {
  if (POKEMON_LINE_SIGNS.test(title)) return true;
  // Bindestrecksvarianten också: "Reshiram-EX Tin"/"Ho-Oh GX" tokeniseras annars som
  // "reshiram-ex" och missar namnlistan (mätt: 8 vintage-EX-tins föll på det).
  if (characterNames(title).size > 0 || characterNames(title.replace(/-/g, " ")).size > 0) return true;
  const padded = ` ${normalizeTitle(title)} `;
  for (const name of normalizedSetNames) {
    if (name.length >= 3 && padded.includes(` ${name} `)) return true;
  }
  return false;
}

/**
 * BUTIKSEGNA BUNDLES — butikens egen hopsättning, inte en tillverkar-SKU.
 * "Swepoke Mystery Pack 1.0 (4 Booster Packs)", "Mini Tin Luminose City: Alla fem
 * tins". De har inget pris att jämföra mellan butiker (ingen annan säljer exakt
 * samma påse), ingen streckkod och inget Cardmarket-motsvarighet — de hör alltså
 * inte hemma i en PRISKATALOG. Ägarbeslut 2026-08-07.
 *
 * ⛔ Smalt med flit. "Mystery" ensamt är förbjudet: katalogen har riktiga kort som
 *    heter "Mystery Garden", "Mystery Plate" och "Mystery Energy" — en bred regel
 *    hade raderat dem. Kräver därför mystery + box/pack/påse, eller "alla N tins".
 */
const STORE_BUNDLE_SIGNS =
  /\bmystery\s*(box|pack|påse|bag)\b|\bmysterybox\b|\balla\s+(fem|5|fyra|4|tre|3)\s+(tins?|askar|paket)\b/i;

// SORTIMENT = butiken väljer åt dig ("1st random Tin", "Mini Tin - Assorted",
// "Slumpad blister"). Vilken tin/blister kunden får är odefinierat, så annonsen
// motsvarar INGEN tillverkar-SKU — den kan varken prisjämföras eller länkas till en
// karaktärsprodukt. Ägarens kataloggenomgång 2026-08-08 raderade fyra sådana
// (Lumiose City "1st random Tin" med 11 butikslänkar, två "Assorted"-tins, en
// generisk mini tin); tidigare denylist-poster (Kanto Power, Ascended Heroes,
// Paradox Destinies) var samma sak. "1st" är svenskans "1 st", inte "first".
const ASSORTMENT_SIGNS =
  /\b\d+\s?st\s+random\b|\brandom\s+(mini\s*)?(tins?|blisters?|packs?|boosters?)\b|\bassorted\b|\bslumpad\w*\b|\bslumpm[äa]ssig\w*\b|\ben\s+av\s+(fem|fyra|tre|5|4|3)\b/i;

export function isStoreBundleListing(title: string): boolean {
  return STORE_BUNDLE_SIGNS.test(title) || ASSORTMENT_SIGNS.test(title);
}

/**
 * KARAKTÄRSLÖS BLISTER/MINI TIN — den största dubblettklassen i ägarens
 * kataloggenomgång 2026-08-08 (30+ av mergarna): butiken skriver "Pokémon SV6:
 * Twilight Masquerade Premium Checklane Blister" medan katalogens produkter heter
 * "…: Kingdra Premium Checklane Blister". För blistrar och mini tins ÄR karaktären
 * identiteten (CM namnger alla 486 blistrar "Set: KARAKTÄR N-Pack Blister"), så en
 * karaktärslös annons kan aldrig mekaniskt bindas till rätt produkt — och
 * blisterCharacterMismatch hindrar med rätta matcharen från att gissa.
 *
 * ANVÄNDS BARA VID SKAPANDET (ensureListingProduct, efter att all matchning
 * misslyckats): en karaktärslös annons som ändå matchar (ägd URL, GTIN, LLM-dom)
 * länkas som vanligt. Vakten avgör bara att en NY produkt aldrig skapas för den —
 * hellre en osynlig butikslänk än en dubblett som skuggar hela karaktärsfamiljen.
 *
 * ⚠️ "Ancient"/"Future"-blistrarna (Stellar Crown) är äkta karaktärslösa SKU:er —
 *    de finns redan i katalogen via CM-importen och nås via matchningen, så vakten
 *    kostar dem ingenting. ETB/boxar/bundles hör INTE hit: de är set-nivå-SKU:er
 *    och karaktärslösa av naturen.
 */
const CHARACTER_IDENTITY_FORMS = /\b(blister|checklane|mini[- ]?tins?)\b/i;
export function isUnspecifiedCharacterListing(title: string): boolean {
  if (!CHARACTER_IDENTITY_FORMS.test(title)) return false;
  return characterNames(title).size === 0;
}

/**
 * MERCH ÄR INTE TCG (2026-08-07). Tillbehörsvakten täcker spelmattor, sleeves och
 * pärmar — allt sådant som ligger BREDVID korten i en kortbutik. Den täcker INTE
 * leksaksaffärens sortiment, för ingen av de butiker vi hade tidigare sålde det.
 *
 * Det gör de nya. Pocketmonsters har 268 gosedjur, 515 figurer, 220 artiklar "till
 * barnrummet", 149 pärmar, 73 klädesplagg och 26 affischer i sina Pokémon-kategorier
 * (mätt 2026-08-07 via deras egen Store-API). Ett gosedjur bär inget formord, så
 * `classifyForm` ger null och `guessCategory` landar på OTHER — som med flit räknas
 * som sealed (se product-category.ts) — och varje sådan annons hade blivit en egen
 * katalogprodukt. Det är samma hål som tillbehören föll i 2026-07-14, fast tusenfalt.
 *
 * ⛔ SEALED-ORDET VETAR ALLTID. Regeln slår bara när titeln saknar formord — precis
 *    som pärm-undantaget ovan, och av samma skäl: en riktig SKU kan bära ett merch-ord
 *    ("Ultra-Premium Collection" innehåller en figur, "Mega Evolution Tin" en Poké
 *    Ball-replika). Ett gosedjur bär däremot aldrig "Booster"/"ETB"/"Tin". Den
 *    ordningen gör att ett falskt merch-ord kostar ingenting, medan ett glömt kostar
 *    en katalogprodukt — den asymmetrin ska vakten luta åt.
 * ⛔ Bart "kalender" är FÖRBJUDET: Pokémons adventskalender är en äkta sealed-SKU
 *    (booster packs i luckorna) och säljs av butiker vi redan har.
 * ⛔ Bart "ball" är FÖRBJUDET: Poké Ball är ett riktigt trainer-kort. Krävs ihop med
 *    ett föremålsord.
 */
const MERCHANDISE_SIGNS =
  /\b(gosedjur|mjukisdjur|plush(ie)?|plysch|figur(er|in|ine)?s?|funko|nendoroid|amiibo|affisch(er)?|poster|tavla|mugg(ar)?|nyckelring|keychain|t-?shirt|tr[öo]ja|hoodie|keps|m[üu]ss(a|or)|strumpor|kl[äa]der|ryggs[äa]ck|pennfodral|pussel|puzzle|lego|mega\s?construx|s[äa]ngkl[äa]der|handduk|termos|vattenflaska|matl[åa]da|godis|choklad)\b|\bpok[eé]\s?ball\s+(figur|leksak|replika|beh[åa]llare)\b/i;

/** Formord som bevisar att annonsen ÄR en sealed TCG-vara, oavsett merch-ord.
 *  "poster collection" (2026-08-08): en riktig TCG-produktlinje (boosters + affisch,
 *  CM-modellerad, säljs av 9 butiker) — utan frasen här åt merch-vaktens "poster"-ord
 *  upp varje ny butikslänk för dem, tyst. Hittad av katalogsvepningen. */
const SEALED_FORM_WORD =
  /\b(booster|boosters|display|etb|elite\s*trainer|blister|bundle|tin|tins|booster\s*box|premium\s*collection|poster\s*collection|build\s*(&|and)\s*battle|checklane|theme\s*deck|battle\s*deck|starter\s*deck)\b/i;

/** Merch (gosedjur, figurer, kläder, affischer) — aldrig en TCG-katalogprodukt. */
export function isMerchandiseListing(title: string): boolean {
  if (SEALED_FORM_WORD.test(title)) return false;
  return MERCHANDISE_SIGNS.test(title);
}

/**
 * Blister-underformer är EGNA SKU:er, inte samma sak. classifyForm klumpar ihop dem
 * till "blister" → vakten släppte igenom:
 *   "Perfect Order - Blister (1-pack)"   ≠ "Perfect Order 3-pack Blister"
 *   "Perfect Order Checklane Makuhita"   ≠ "Perfect Order 3-pack Blister"
 *   "Journey Together Checklane Blister" ≠ "Journey Together: Scrafty 3-Pack Blister"
 * 10 felaktiga länkar kom härifrån. Checklane ≠ N-pack, och N ≠ M.
 */
/**
 * En CHECKLANE-blister ÄR en 1-pack-blister — samma SKU, olika ord. Facit visade det:
 * "Destined Rivals Checklane Zarude" och "Destined Rivals: Zarude 1-Pack Blister" är
 * samma produkt, och en tidig version av vakten blockerade 18 sådana KORREKTA länkar.
 * Checklane räknas därför som 1, och bara ANTALET får skilja (1 ≠ 3).
 */
function blisterKind(t: string): number | null {
  if (/\bchecklane\b/i.test(t)) return 1;
  const m = /\b(\d)\s*[-\s]?p(?:ack\b|\b)/i.exec(t);
  return m ? Number(m[1]) : null;
}
export function blisterMismatch(a: string, b: string): boolean {
  if (!/\bblister|checklane\b/i.test(a) && !/\bblister|checklane\b/i.test(b)) return false;
  const ka = blisterKind(a);
  const kb = blisterKind(b);
  if (!ka || !kb) return false; // vet vi inte → låt andra vakter avgöra
  return ka !== kb;
}

/**
 * Enstaka enhet ≠ display/flerpack av samma enhet. Priset blir grovt fel:
 *   "Kanto Power Mini Tin"          ≠ "Kanto Power Mini Tin 5-Pack Box"
 *   "Crown Zenith: Mini Tin"        ≠ "Crown Zenith: Mini Tin Display"
 *   "Surging Sparks Booster Small Display" ≠ "Surging Sparks Booster Box"
 */
const MULTI_UNIT = /\b(display|\d\s*[-\s]?pack box|small display)\b/i;
export function unitCountMismatch(a: string, b: string): boolean {
  const ma = MULTI_UNIT.test(a);
  const mb = MULTI_UNIT.test(b);
  if (ma === mb) return false;
  // "Booster Box" ÄR en display → räkna den som flerpack, annars falsklarm.
  const boxA = /\bbooster box\b/i.test(a);
  const boxB = /\bbooster box\b/i.test(b);
  return (ma || boxA) !== (mb || boxB);
}

/**
 * BAS-ANNONS mot UNDERSET-PRODUKT — den dyraste systematiska buggen i revisionen.
 *
 * matchProduct kollar bara ETT håll: "annonsens identitetsord täcks av kandidaten"
 * (nonEraCoverage). Den frågar ALDRIG om kandidatens EGNA identitetsord finns i
 * annonsen. Alltså matchar bas-annonsen "Mega Evolution Booster" vår mer specifika
 * "Mega Evolution Chaos Rising Booster Pack" — "chaos rising" saknas i annonsen men
 * ingen vakt bryr sig. Samma fel hos MaxGaming, Swepoke OCH Spelexperten.
 * (dedupe-catalog kollar BÅDA hållen — matcharen gjorde det inte.)
 *
 * En trubbig omvänd täckningskoll blockerade 178 KORREKTA länkar, för den räknade
 * FORMORD ("display" i "Display / Booster Box"), PLURAL ("Tins" vs "Tin") och
 * SETKODER ("ME4" vs "ME04") som identitet. Här jämförs bara ÄKTA identitetsord:
 * formord och setkoder rensas bort först.
 */
const FORM_NOISE = new Set([
  "display", "displays", "box", "boxes", "booster", "boosters", "pack", "packs",
  "paket", "blister", "blisters", "tin", "tins", "etb", "elite", "trainer",
  "bundle", "collection", "checklane", "sleeved", "mini", "premium", "pokemon",
  "tcg", "card", "cards", "game", "trading", "the", "of", "and",
]);
/** Setkoder: ME4/ME04/ME2.5, SV8/sv7a, M1S/M1L, sv10 5. Formatet varierar per butik. */
const SET_CODE_RE = /^(me\d{1,2}(\.\d)?|sv\d{1,2}[a-z]?|m\d[sl]|\d{1,2}(\.\d)?)$/i;

/** Tar bort era-/seriemarkören (Mega Evolution, Scarlet & Violet …) — den är familjen,
 *  inte produkten. Global variant av ERA_RE så alla förekomster försvinner. */
// PLURAL-s: samma fälla som i ERA_PHRASES. De två era-reglerna MÅSTE hållas i synk —
// "Mega EvolutionS" (Samlarhobby) slank igenom här också och räknades som produktidentitet.
const ERA_STRIP_RE = /\b(mega evolutions?|scarlet( and| &)? violet|sword( and| &)? shield|sun( and| &)? moon|pokemon go)\b/gi;
function stripEra(normalized: string): string {
  return normalized.replace(ERA_STRIP_RE, " ").replace(/\s{2,}/g, " ").trim();
}

function identityWords(normalized: string): Set<string> {
  const out = new Set<string>();
  for (const w of normalized.split(" ")) {
    if (!w || w.length < 3) continue;
    if (FORM_NOISE.has(w)) continue;
    if (SET_CODE_RE.test(w)) continue;
    out.add(w);
  }
  return out;
}

/**
 * OPT-IN-SPÅRNING AV MATCHNINGEN.
 *
 * Tre gånger nu har felsökningen av en felmatchning/dubblett stannat på frågan "kom
 * kandidaten ens in i poolen?" — och tre gånger har svaret krävt att någon läser 250
 * rader vaktkedja och gissar (kandidaturvalet 2026-08-07, take-utan-orderBy 2026-07-13,
 * tokenurvalet samma dag). Den här kroken gör frågan mätbar i stället.
 *
 * ⛔ NULL I DRIFT. `tracer?.()` på en null-referens är en null-check per kandidat och
 *    ingenting annat — inga strängar byggs, ingen loggning sker. Sätts BARA av
 *    scripts/diagnose-listing-match.ts.
 */
export interface MatchTrace {
  poolSize: number;
  /** Kandidater som överlevde HELA vaktkedjan, med sin slutpoäng. */
  survivors: { normalizedTitle: string; score: number }[];
  best: { normalizedTitle: string; score: number } | null;
  runnerUp: { normalizedTitle: string; score: number } | null;
  /** Varför matchningen slutade som den gjorde. */
  outcome: "exakt" | "singel-identitet" | "identitetslik" | "tvetydig" | "under-golvet" | "ingen-kandidat" | "poäng";
  inPool?: boolean;
}
let matchTracer: ((t: MatchTrace) => void) | null = null;
/** Sätt (eller nollställ med null) spårningen. Endast för diagnosskript. */
export function setMatchTracer(fn: ((t: MatchTrace) => void) | null): void {
  matchTracer = fn;
}

/** Lägsta andel delade särskiljande ord för att en kandidat ska godkännas. */
const MIN_DISTINCTIVE_OVERLAP = 0.5;

/**
 * Tröskel för nonEraCoverage — STRIKT över hälften. Vid exakt 0,5 (2 egna ord,
 * 1 täckt) är det otäckta ordet nästan alltid produktidentitet: "Dragon MAJESTY
 * Booster Pack" matchade vintage-"Dragon Booster Pack" (−76 %-fejkdeal) och
 * "Charizard ex SPECIAL Collection" matchade "Charizard EX Box" (−65 %) — båda
 * passerade på pricken 0,5. Äkta brusord (skick/butiksfraser) rensas redan av
 * NOISE_WORDS, så en kvarvarande otäckt term ska väga tyngre än så här.
 */
const MIN_NONERA_COVERAGE = 0.6;

/**
 * Försöker matcha en normaliserad titel mot en produkt i katalogen.
 * Returnerar bästa kandidat med konfidens, eller null om ingen är
 * tillräckligt lik.
 */
/** En katalograd som matchningen behöver. Samma fält som DB-vägen väljer. */
export type MatchCandidate = {
  id: string;
  normalizedTitle: string;
  card: { name: string; number: string } | null;
  /** Tryckning (Base): se tryckningsvakten i matchProduct. */
  variantLabel?: string | null;
};
/** Hela katalogen i minnet — se matchProduct för VARFÖR. */
export type MatchIndex = MatchCandidate[];

/**
 * Läser hela matchnings-indexet EN gång (~22k rader, några MB).
 *
 * Varför: matchProduct gjorde per ANNONS en `contains`-fråga PER TOKEN (5–6 st, var
 * och en en seq-scan över hela Product) plus en rå LIKE-scan till. Med GitHub-runnern
 * i us-east och Neon i Frankfurt kostade det ~1 SEKUND per annons — 2 879 annonser
 * per pass = ~48 min av scrape-all:s 59–100 min, och jobbet dunkade i 120-min-taket.
 * Samma algoritm i minnet är mikrosekunder.
 */
export async function loadMatchIndex(): Promise<MatchIndex> {
  return prisma.product.findMany({
    select: {
      id: true,
      normalizedTitle: true,
      variantLabel: true,
      card: { select: { name: true, number: true } },
    },
  });
}

/**
 * @param rawTitle Butikens OBEARBETADE titel. Vakterna nedan behöver den: normalizeTitle
 *   kastar parenteser och bindestreck, och då försvinner just de tecken som avslöjar en
 *   singel ("(sm12a 220)") eller ett antal ("1-pack"). Utelämnas den hoppas de vakterna
 *   över — anropare som HAR råtiteln bör alltid skicka med den.
 */
/**
 * @param excludeProductId Produkt som ALDRIG får returneras. Behövs när frågan är
 *   "finns det en ANNAN produkt som är samma vara som den här?" — dvs dubblett-
 *   städningen, som annars bara får tillbaka produkten själv på exakt-träffen.
 *   Import-vägen skickar den aldrig: där finns produkten ännu inte.
 */
export async function matchProduct(
  normalizedTitle: string,
  index?: MatchIndex,
  rawTitle?: string,
  excludeProductId?: string
): Promise<{ productId: string; confidence: number } | null> {
  const normalized = normalizeTitle(normalizedTitle);
  if (!normalized) return null;
  // Avkoda entiteter men BEHÅLL parenteser/bindestreck — vakterna nedan bygger på dem.
  const raw = decodeTitle(rawTitle ?? normalizedTitle);

  // 1. Exakt träff på normaliserad titel
  const exact = index
    ? index.find((p) => p.normalizedTitle === normalized && p.id !== excludeProductId)
    : await prisma.product.findFirst({
        where: { normalizedTitle: normalized, ...(excludeProductId ? { id: { not: excludeProductId } } : {}) },
        select: { id: true },
      });
  if (exact) return { productId: exact.id, confidence: 1 };

  // 2. Kandidater: hämta per token (union) så att sällsynta tokens som
  //    "ascended" inte drunknar bland tusentals "pokemon"-träffar.
  const tokens = significantTokens(normalized);
  if (tokens.length === 0) return null;

  const candidateMap = new Map<string, MatchCandidate>();
  for (const t of tokens) {
    // take 200 (ej 60): vanliga namn ("charizard") har >100 produkter och rätt
    // kort måste rymmas i poolen för nummer-passet nedan.
    // normalizedTitle är gemener (normalizeTitle) → `contains` i Postgres och
    // String.includes ger samma träffmängd; "take utan ordning" är godtycklig i
    // BÅDA fallen, så minnesvägen ändrar inte semantiken.
    if (index) {
      // INGEN take/cap i minnesvägen. take:200 + break vid 400 fanns BARA för att
      // DB-rader kostade pengar/tid — och de var aktivt skadliga: Postgres "take utan
      // orderBy" ger en GODTYCKLIG delmängd, så rätt kandidat föll ofta utanför och
      // matchningen returnerade null (verifierat mot prod: 200 riktiga butikstitlar,
      // där DB-vägen missade JP-produkter som minnesvägen träffar med konfidens 1.00).
      // I minnet är hela kandidatmängden gratis → bästa kandidaten kan alltid vinna.
      for (const r of index) if (r.normalizedTitle.includes(t)) candidateMap.set(r.id, r);
      continue;
    }
    const rows = await prisma.product.findMany({
      where: { normalizedTitle: { contains: t } },
      select: { id: true, normalizedTitle: true, card: { select: { name: true, number: true } } },
      take: 200,
    });
    for (const r of rows) candidateMap.set(r.id, r);
    // ⛔ BRYT INTE FÖRE SISTA TOKEN. Taket låg på 400 och stoppade loopen efter två
    //    vanliga ord — de SÄRSKILJANDE orden längre bak frågades aldrig, så rätt
    //    produkt kunde inte finnas i poolen hur bra vakterna än var. Taket finns
    //    kvar som skydd mot orimliga pooler, men ligger nu ovanför 6 × 200.
    if (candidateMap.size >= 1400) break;
  }

  // Katalogtiteln kan vara en ren delmängd av en brusig butikstitel ("white flare
  // booster pack" ⊂ "scarlet violet 10 5 white flare booster pack"). Token-unionen
  // ovan missar den då varje token har >200 katalog-syskon och fel 200 hämtas
  // (take utan ordning). Lägg därför till produkter vars HELA normaliserade titel
  // finns som delsträng i den inkommande — exakt, billigt, få träffar.
  // normalizedTitle är alnum+mellanslag → inga LIKE-jokrar att escapa.
  if (index) {
    for (const p of index) {
      if (p.normalizedTitle.length >= 8 && normalized.includes(p.normalizedTitle)) candidateMap.set(p.id, p);
    }
  } else {
    const subsetIds: { id: string }[] = await prisma.$queryRaw`
      SELECT id FROM "Product"
      WHERE char_length("normalizedTitle") >= 8
        AND ${normalized} LIKE '%' || "normalizedTitle" || '%'
      LIMIT 50`;
    if (subsetIds.length > 0) {
      const rows = await prisma.product.findMany({
        where: { id: { in: subsetIds.map((s) => s.id) } },
        select: { id: true, normalizedTitle: true, card: { select: { name: true, number: true } } },
      });
      for (const r of rows) candidateMap.set(r.id, r);
    }
  }

  // ── TRYCKNINGSVAKT (2026-07-28) ─────────────────────────────────────────────
  // Base finns som tre katalogposter per kort (Unlimited/Shadowless/1st Edition).
  // De delar kortnamn OCH kortnummer, så singel-identiteten nedan ger TRE lika
  // starka träffar och fuzzy-poängen hade fått avgöra — dvs slumpen bestämmer om
  // en 40-kronorsannons landar på 1st Edition-produkten. En annons som inte SÄGER
  // något om tryckning är per konvention den ordinarie; bara en annons som nämner
  // tryckningen får matcha de andra två.
  // Sedan 2026-08-03 gäller samma fråga ALLA varianter, inte bara Base-trion:
  // reverse holo blev egna produkter och föll rakt igenom den gamla
  // `isPrintVariantLabel`-grinden. Se `listingFitsVariant`.
  const candidates = [...candidateMap.values()].filter(
    (c) => c.id !== excludeProductId && listingFitsVariant(c.variantLabel, raw, c.card?.name)
  );
  const trace: MatchTrace | null = matchTracer
    ? { poolSize: candidates.length, survivors: [], best: null, runnerUp: null, outcome: "ingen-kandidat" }
    : null;
  const emit = (outcome: MatchTrace["outcome"]) => {
    if (!trace || !matchTracer) return;
    trace.outcome = outcome;
    matchTracer(trace);
  };
  if (candidates.length === 0) {
    emit("ingen-kandidat");
    return null;
  }

  const incomingSetNum = extractSetNumber(normalized);
  const incomingForm = classifyForm(normalized);
  // Lot-annonser (flera produkter i en annons) får ALDRIG matcha någon
  // katalogprodukt — inte ens singelkort (vars form är null och därför
  // annars slinker förbi formvakten).
  if (incomingForm === "multipack" || incomingForm === "case" || incomingForm === "combo" || incomingForm === "event") {
    return null;
  }

  // ── Singel-identitet: tryckt nummer + Pokémon-namn ──────────────────────
  // Promo-/setnummer (RC5, GG01, 6) är kortets identitet. Fuzzy namnöverlapp
  // kollapsar annars varje "Charizard X" mot kortet vars enda särskiljande ord
  // är "charizard". Kräver SAMMA nummernyckel OCH att kortnamnet finns i titeln
  // → hög konfidens även utan setnamn (säljare utelämnar ofta setet i promos).
  // Bara för singel-listningar (incomingForm === null); sealed har formord.
  if (!incomingForm) {
    const listingKey = printedNumberKey(normalized);
    if (listingKey) {
      const hits = candidates.filter(
        (c) =>
          c.card &&
          cardNumberKey(c.card.number) === listingKey &&
          cardNameInTitle(c.card.name, normalized)
      );
      if (hits.length === 1) return { productId: hits[0].id, confidence: 0.9 };
      if (hits.length > 1) {
        // Samma kortnummer i flera set → bryt lika på total (165 i "6/165").
        const total = extractSetNumber(normalized)?.total;
        const byTotal = hits.filter(
          (c) => extractSetNumber(c.normalizedTitle)?.total === total
        );
        if (byTotal.length === 1) return { productId: byTotal[0].id, confidence: 0.9 };
      }
    }
  }

  let best: { productId: string; confidence: number; normalizedTitle: string } | null = null;
  /** Tvåan — behövs för marginalvakten efter loopen. */
  let runnerUp: { productId: string; confidence: number; normalizedTitle: string } | null = null;
  /** Kandidater som är identitetslika OCH konfliktfria — se blocket längst ned i loopen. */
  const identicalHits: { productId: string; confidence: number }[] = [];

  // Bara tal (utan "X/Y") i en singel-annons: samma vakt som matchListingToProduct.
  // Utan den fastnar "Milotic ex 42 Surging Sparks" på specialarten 217.
  const bareNums = !incomingForm ? bareCardNumbers(normalized) : [];

  for (const c of candidates) {
    let score = scoreSimilarity(normalized, c.normalizedTitle);
    // Olika produktform (t.ex. booster pack vs booster box) → förkasta
    const candidateForm = classifyForm(c.normalizedTitle);
    if (incomingForm && candidateForm && incomingForm !== candidateForm) {
      continue;
    }
    if (bareNums.length > 0 && c.card) {
      const key = cardNumberKey(c.card.number);
      const num = key ? parseInt(key.replace(/[a-z]/g, ""), 10) : NaN;
      if (Number.isFinite(num) && !bareNums.includes(num)) continue;
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
    // Fel sifferset (151 vs bas-S&V) → förkasta
    if (setMarkerMismatch(normalized, c.normalizedTitle)) {
      continue;
    }
    // Fel serienummer (Series 1 vs Series 2) → förkasta
    if (seriesMismatch(normalized, c.normalizedTitle)) {
      continue;
    }
    // Pokémon Center-exklusiv variant ≠ vanlig produkt → förkasta
    if (pokemonCenterMismatch(normalized, c.normalizedTitle)) {
      continue;
    }
    // Ultra-/Super-Premium ≠ Premium — dyrare, egna SKU:er. Dice 0,879 (ÖVER auto-link-
    // gränsen) hade annars länkat "Arceus VSTAR Ultra-Premium" till "Arceus VSTAR
    // Premium", och "Prismatic Evolutions Suprise Box Collection" vann "…Super-Premium
    // Collection" på 0,7195 mot rätt produkts 0,6941.
    if (premiumGradeMismatch(normalized, c.normalizedTitle)) {
      continue;
    }
    // US Version ≠ EU Version (0,927), Premium Checklane ≠ Checklane (0,939),
    // "(5 Cards)" ≠ "(6 Cards)". Alla tre låg ÖVER 0,85 → länkades utan LLM-dom.
    if (regionVersionMismatch(normalized, c.normalizedTitle)) {
      continue;
    }
    if (cardCountMismatch(normalized, c.normalizedTitle)) {
      continue;
    }

    // ── VAKTER FRÅN KATALOGREVISIONEN 2026-07-13 ────────────────────────────
    // Mätta mot facit: 76 verifierat felaktiga länkar + 989 verifierat korrekta.
    // Tillsammans fångar de 15 av de felaktiga UTAN att blockera en enda korrekt.
    // Kör på RÅTITELN — normalizeTitle strippar de tecken de bygger på.

    // Årtal = produktidentitet (Poké Ball Tin 2025 ≠ 2026, Toolkit 2025 ≠ 2023).
    if (yearMismatch(raw, c.normalizedTitle)) {
      continue;
    }
    // SINGEL ↔ SEALED får aldrig blandas, i BÅDA riktningar.
    // (a) En singel-annons ("Skeledirge ex - SVP081 Black Star Promo") får inte bli
    //     offer på en sealed-produkt. Formvakten missade det helt: en singel-titel har
    //     inget formord → classifyForm = null → `fa && fb && ...` hoppades över.
    // (b) En SEALED-annons ("Mega Zygarde Ex Box") får inte matcha ett SINGELKORT
    //     ("Mega Zygarde ex — Perfect Order 47/88"). Kandidater med c.card är kort.
    if (!c.card && isSingleCardListing(raw)) {
      continue;
    }
    if (c.card && incomingForm && incomingForm !== "single") {
      continue; // annonsen har en sealed-form → kan inte vara ett enskilt kort
    }
    // Tillbehör (spelmatta, pärm utan booster, akrylskydd) ≠ sealed produkt.
    if (isAccessoryListing(raw) && !isAccessoryListing(c.normalizedTitle)) {
      continue;
    }
    // Blister-underform: checklane(=1-pack) ≠ 3-pack, 1 ≠ 3.
    if (blisterMismatch(raw, c.normalizedTitle)) {
      continue;
    }
    // Enstaka enhet ≠ display/flerpack av samma enhet (Mini Tin ≠ Mini Tin Display).
    if (unitCountMismatch(raw, c.normalizedTitle)) {
      continue;
    }

    // ── VAKTER FRÅN UPPFÖLJNINGEN 2026-07-14 (tvåsidiga — se definitionerna) ──
    // Olika set-kod (sv1S ≠ sv2P, ME02 ≠ ME04) → olika set.
    if (setCodeMismatch(raw, c.normalizedTitle)) {
      continue;
    }
    // Olika kortsuffix (Melmetal ex ≠ Melmetal V) → olika produkt.
    if (cardSuffixMismatch(raw, c.normalizedTitle)) {
      continue;
    }
    // Olika karaktär (Checklane Porygon2 ≠ Checklane Koraidon) → olika SKU.
    if (characterMismatch(raw, c.normalizedTitle)) {
      continue;
    }
    // Blister: även EN ENSIDIG karaktär är en motsägelse — se funktionen.
    if (blisterCharacterMismatch(raw, c.normalizedTitle)) {
      continue;
    }
    // En PÅSE är aldrig en BOX. Saknades: en enskild booster kunde vinna boxen på ren
    // Dice-poäng (färre tokens i "Flashfire Booster Box" → 0,65 mot baspackens 0,64).
    // Boxen kostar ~100x påsen — den felmatchen är dyr och alltid fel.
    if (packVsBoxMismatch(raw, c.normalizedTitle)) {
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
    if (nonEraCoverage(normalized, c.normalizedTitle) < MIN_NONERA_COVERAGE) {
      continue;
    }
    // Liten bonus för högre ordöverlapp — föredrar "Mega Evolution Booster Pack"
    // framför "Mega Evolution Chaos Rising Booster Pack" vid likvärdig Dice.
    score = Math.min(1, score + 0.15 * overlap);
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
    // ── TAK, INTE VETO ──────────────────────────────────────────────────────
    // Bär BÅDA titlarna ett eget identitetsord (Kanto↔Paldea, Love↔Lure, Pals↔Power)
    // är det nästan alltid olika produkter — men inte alltid (butiken kan skriva
    // "Suddgummi" där katalogen skriver "Eraser"). Ett veto hade dödat 6 av 217
    // verifierat korrekta länkar. Vi SÄNKER därför bara taket under auto-link-gränsen:
    // paret får inte bindas gratis, det måste bekräftas av identitetskontrollen eller
    // LLM-domen. Ingen länk går förlorad — den tveksamma måste bara förtjäna sig.
    if (mutualIdentityConflict(normalized, c.normalizedTitle)) {
      score = Math.min(score, CONFLICT_CONFIDENCE_CAP);
    }
    // ── IDENTITET SLÅR POÄNG (2026-08-07) ───────────────────────────────────
    // Kandidaten har passerat HELA vaktkedjan ovan OCH bär exakt samma
    // identitets-ordmängd (era-namn, setkoder och formord borträknade). Då är det
    // samma vara — oavsett att en ANNAN kandidat råkar få högre Dice-poäng.
    //
    // VARFÖR (mätt 2026-08-07): butiker skriver samma SKU i en annan ordföljd,
    // "…Temporal Forces 3-Pack Blister CLEFFA" mot katalogens "Temporal Forces:
    // CLEFFA 3-Pack Blister" (0,68). Högst poäng fick i stället SYSKONET
    // "…3-Pack Blister CYCLIZAR" (0,92!) — samma butiks egen ordföljd matchar sig
    // själv bäst. Syskonet förkastades korrekt av konfliktvakten, men matchProduct
    // returnerade bara ETT förslag, så anroparens deterministiska identitetstest
    // fick aldrig se den rätta tvillingen och en dubblett skapades. Sex av de
    // bildlösa produkterna kom till exakt så.
    if (identicalIdentity(normalized, c.normalizedTitle) && !productsConflict(normalized, c.normalizedTitle)) {
      identicalHits.push({ productId: c.id, confidence: score });
    }

    trace?.survivors.push({ normalizedTitle: c.normalizedTitle, score });

    if (!best || score > best.confidence) {
      runnerUp = best;
      best = { productId: c.id, confidence: score, normalizedTitle: c.normalizedTitle };
    } else if (!runnerUp || score > runnerUp.confidence) {
      runnerUp = { productId: c.id, confidence: score, normalizedTitle: c.normalizedTitle };
    }
  }
  if (trace) {
    trace.best = best ? { normalizedTitle: best.normalizedTitle, score: best.confidence } : null;
    trace.runnerUp = runnerUp ? { normalizedTitle: runnerUp.normalizedTitle, score: runnerUp.confidence } : null;
  }

  // ⛔ BARA när den är ENTYDIG. Två identitetslika kandidater betyder att vi inte
  //    kan veta vilken som är rätt (t.ex. en 1-pack och en 3-pack vars räkneord
  //    inte fångats) — då får poängen och anroparens övriga prövning avgöra, precis
  //    som förut. Samma "hellre ingen länk än fel länk"-regel som resten av filen.
  if (identicalHits.length === 1) {
    // Poängen behålls som den är: den är bara en sorteringssignal här, identiteten
    // är beviset. Den passerar därför MIN_CONFIDENCE-golvet med flit — ett
    // deterministiskt identitetsbevis ska inte falla på ett Dice-tal.
    emit("identitetslik");
    return identicalHits[0];
  }

  // ── MARGINALEN AVGÖR NÄR TVÅ KANDIDATER ÄR OLIKA VAROR (2026-08-07) ─────────
  // Samma lärdom som skannerns bildmatchning: poängen skiljer inte rätt från fel,
  // MARGINALEN till tvåan gör det. En Tradera-annons med titeln "Crown Elite
  // Trainer Box (ETB)" fick 0,800 mot "Crown Zenith Elite Trainer Box" och 0,786
  // mot "Stellar Crown Elite Trainer Box" — 0,014 isär. Annonsen sålde en Stellar
  // Crown, men Crown Zenith vann och 1 150 kr blev DEN produktens rubrikpris i
  // stället för ~3 000 kr. Ett fel pris är värre än en utebliven länk.
  //
  // ⛔ Bara när kandidaterna faktiskt är OLIKA varor. Två poster för samma sak
  //    (en dubblett vi ännu inte slagit ihop) ligger också tätt, och där är valet
  //    ofarligt — därför krävs att identitetsorden skiljer sig.
  if (best && runnerUp && best.confidence - runnerUp.confidence < AMBIGUITY_MARGIN) {
    if (!identicalIdentity(best.normalizedTitle, runnerUp.normalizedTitle)) {
      emit("tvetydig");
      return null;
    }
  }

  if (best && best.confidence >= MIN_CONFIDENCE) {
    emit("poäng");
    return best;
  }
  emit("under-golvet");
  return null;
}

/**
 * NÄRMASTE KATALOGKANDIDAT — andra chansen INNAN vi skapar en ny produkt.
 *
 * `matchProduct` säger nej av två olika sorters skäl, och auto-importen behandlade dem
 * likadant: som "produkten finns inte". Det stämmer bara för det ena.
 *
 *   (a) Ingen kandidat är i närheten          → ny produkt är RÄTT svar.
 *   (b) Kandidaten finns men får inte VINNA   → ny produkt är en DUBBLETT.
 *
 * (b) är inte ett fel i vaktkedjan. Den är byggd för PRISVÄGEN, där en felaktig länk
 * ger fel pris på en produkt (dyrare fel än en utebliven länk), och den avstår därför
 * med flit: täckningsgolvet, marginalvakten och de tvåsidiga vakterna säger alla hellre
 * "vet inte" än "kanske". Auto-importen ställer en ANNAN fråga — "finns den här varan
 * redan hos oss?" — där ett falskt nej kostar en dubblett.
 *
 * MÄTT på de tre första dubbletterna Wave 4 skapade (2026-08-07):
 *   "Prismatic Evolutions Super-Premium Collection (SPC)"  0,913 mot vår egen post
 *       → alla kandidater föll på vaktkedjan, 0 överlevare
 *   "Scarlet of Violet Booster pack" (butikens STAVFEL)    0,945 mot "Scarlet & Violet
 *       Booster Pack" → nonEraCoverage 0,000 (kandidaten har inga icke-era-ord ALLS)
 *   "Destined Rivals Booster Pack"                         0,858 mot rätt post, men
 *       "Destined Rivals Sleeved Booster" låg 0,014 över → marginalvakten sa null
 *
 * Den här funktionen VÄLJER INTE — den lämnar över till LLM-domaren, samma instans som
 * redan avgör 0,55–0,85-bandet. Därför bara de vakter som handlar om IDENTITET
 * (`productsConflict`, form, påse≠box) och inga poänggolv: ett tal som 0,858 mot 0,872
 * är precis vad domaren finns till för.
 *
 * ⛔ Kort (`c.card`) är alltid uteslutna: en sealed-annons får aldrig landa på en singel.
 * ⛔ `minScore` är ett GOLV mot att fråga domaren om orelaterade varor, inte ett bevis.
 */
export function nearestCatalogCandidate(
  normalizedTitle: string,
  rawTitle: string,
  index: MatchIndex,
  minScore: number
): { id: string; normalizedTitle: string; score: number } | null {
  const normalized = normalizeTitle(normalizedTitle);
  const incomingForm = classifyForm(normalized);
  let best: { id: string; normalizedTitle: string; score: number } | null = null;
  for (const c of index) {
    if (c.card) continue;
    const score = scoreSimilarity(normalized, c.normalizedTitle);
    if (score < minScore || (best && score <= best.score)) continue;
    const candidateForm = classifyForm(c.normalizedTitle);
    if (incomingForm && candidateForm && incomingForm !== candidateForm) continue;
    if (packVsBoxMismatch(rawTitle, c.normalizedTitle)) continue;
    // ⛔ BLISTRAR OCH DECKS IDENTIFIERAS AV KARAKTÄREN, OCH EN ENSIDIG KARAKTÄR RÄCKER.
    //    De två här sitter i matchProducts egen loop men INTE i productsConflict, och
    //    första versionen av den här funktionen ärvde bara den senare. Följden syntes
    //    direkt i Wave 4-importen: "Pokémon: Mega Evolution - Perfect Order 3-Pack
    //    Blister" (utan karaktär) bands till "…Perfect Order, 3-Pack Blister: CHIKORITA"
    //    på 0,814, och "Enhanced 2-Pack Blister" till "…: Genie Trio" på 0,800. CM
    //    namnger ALLA 486 blistrar "Set: KARAKTÄR N-Pack Blister", så en generisk
    //    annons kan vara vilken som helst av dem — att välja en är ett myntkast som
    //    sätter fel pris på en verklig produkt.
    if (blisterCharacterMismatch(rawTitle, c.normalizedTitle)) continue;
    if (deckCharacterMismatch(normalized, c.normalizedTitle)) continue;
    if (productsConflict(rawTitle, c.normalizedTitle)) continue;
    best = { id: c.id, normalizedTitle: c.normalizedTitle, score };
  }
  return best;
}

/**
 * Riktad matchning: passar EN känd produkt mot en annons-titel. Tradera-svepets
 * Fas 0 vet REDAN vilken produkt den namn-sökte → den slipper matchProducts
 * katalog-breda kandidatsökning (dyr seq-scan per annons) och får samtidigt
 * exaktare resultat (ingen kors-match mot fel produkt). SAMMA vakter som
 * matchProduct-loopen → identisk kvalitet. Ren funktion (ingen DB). Anroparen
 * sköter Tradera-kategori-vakten + pris-rimlighet separat.
 */
export function matchListingToProduct(
  listingTitle: string,
  product: {
    normalizedTitle: string;
    card: { name: string; number: string } | null;
    // OBLIGATORISKT, inte valfritt (2026-07-28). Fältet var `variantLabel?:` och
    // INGEN av anroparna valde ut det ur databasen → `undefined` föll rakt igenom
    // `isPrintVariantLabel` och tryckningsvakten nedan var i praktiken bortkopplad
    // i BÅDA Tradera-vägarna. Följden: 84 Shadowless- och 39 1st Edition-produkter
    // fick en offer från en annons som bara sålde det ordinarie kortet (Blastoise
    // 1st Edition visade 119 kr). Ett obligatoriskt fält gör samma miss till ett
    // typfel i stället för en tyst felmatchning — vakten ska aldrig kunna faila
    // öppet bara för att ett select saknar en kolumn.
    variantLabel: string | null;
  }
): number | null {
  const normalized = normalizeTitle(listingTitle);
  if (!normalized) return null;

  // Samma variantvakt som matchProduct: en annons som inte nämner varianten är
  // den ordinarie. Utan den blev varje Base-annons en träff på ALLA TRE
  // produkterna (samma namn, samma nummer) och skena-raderna tredubblades.
  if (!listingFitsVariant(product.variantLabel, listingTitle, product.card?.name)) return null;

  const incomingForm = classifyForm(normalized);
  if (incomingForm === "multipack" || incomingForm === "case" || incomingForm === "combo" || incomingForm === "event") {
    return null;
  }

  const candidateForm = classifyForm(product.normalizedTitle);
  if (incomingForm && candidateForm && incomingForm !== candidateForm) return null;

  // TILLBEHÖR ≠ VARAN (2026-07-27). Butiksvägen (matchProduct) har ställt den här
  // frågan sedan länge; Tradera-vägen gjorde det aldrig. Följden: "Mega Darkrai ex
  // 116/084 Extended Artwork-ram för Pokémonkort" (179 kr) bar kortets namn OCH
  // nummer, passerade nummervakten och namnlikheten, och blev både offer och
  // skena-rad på ett kort vars CM-golv är 3 207 kr. Att ordet "ram" var det enda
  // som skilde dem var känt sedan 2026-07-26 — vakten satt bara i fel kodväg.
  if (isAccessoryListing(listingTitle) && !isAccessoryListing(product.normalizedTitle)) return null;

  // Singel-identitet: tryckt nummer + kortnamn (samma som matchProduct).
  if (!incomingForm && product.card) {
    const ourKey = cardNumberKey(product.card.number);
    const listingKey = printedNumberKey(normalized);
    if (listingKey) {
      if (ourKey !== listingKey) return null;
      if (!cardNameInTitle(product.card.name, normalized)) return null;
      return 0.9;
    }
    // Inget tryckt nummer i annonsen → kräv ändå kortnamnet. Annars matchar vilket
    // kort som helst ur samma set på delade set-ord ("Forretress ex Paldean Fates"
    // fastnade på Xatu/Ralts/Flittle m.fl. via överlapp på just "paldean fates").
    if (!cardNameInTitle(product.card.name, normalized)) return null;
    // Annonsen saknar "X/Y" men nämner ETT ELLER FLERA bara tal — är inget av dem
    // vårt kortnummer är det en ANNAN tryckning av samma kort (den ordinarie i
    // stället för alt-arten). Se bareCardNumbers för varför det här är den enda
    // vakten som fångar dem.
    const ourNum = ourKey ? parseInt(ourKey.replace(/[a-z]/g, ""), 10) : NaN;
    if (Number.isFinite(ourNum)) {
      const bare = bareCardNumbers(normalized);
      if (bare.length > 0 && !bare.includes(ourNum)) return null;
    }
  }

  if (
    incomingForm === "deck" &&
    candidateForm === "deck" &&
    deckCharacterMismatch(normalized, product.normalizedTitle)
  ) {
    return null;
  }
  if (languageMismatch(normalized, product.normalizedTitle)) return null;
  if (setMarkerMismatch(normalized, product.normalizedTitle)) return null;
  if (seriesMismatch(normalized, product.normalizedTitle)) return null;
  if (pokemonCenterMismatch(normalized, product.normalizedTitle)) return null;
  if (premiumGradeMismatch(normalized, product.normalizedTitle)) return null;
  if (regionVersionMismatch(normalized, product.normalizedTitle)) return null;
  if (cardCountMismatch(normalized, product.normalizedTitle)) return null;
  // Uppföljningen 2026-07-14 — samma tvåsidiga vakter som matchProduct.
  if (setCodeMismatch(listingTitle, product.normalizedTitle)) return null;
  if (cardSuffixMismatch(listingTitle, product.normalizedTitle)) return null;
  if (characterMismatch(listingTitle, product.normalizedTitle)) return null;

  const overlap = distinctiveOverlap(normalized, product.normalizedTitle);
  if (overlap < MIN_DISTINCTIVE_OVERLAP) return null;
  if (nonEraCoverage(normalized, product.normalizedTitle) < MIN_NONERA_COVERAGE) return null;

  let score = scoreSimilarity(normalized, product.normalizedTitle);
  score = Math.min(1, score + 0.15 * overlap);

  const incomingSetNum = extractSetNumber(normalized);
  const candidateSetNum = extractSetNumber(product.normalizedTitle);
  if (incomingSetNum && candidateSetNum) {
    if (incomingSetNum.num === candidateSetNum.num && incomingSetNum.total === candidateSetNum.total) {
      score = Math.min(1, score + 0.15);
    } else {
      return null;
    }
  }

  if (score < MIN_CONFIDENCE) return null;
  return score;
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
 *   I den HÄR rena funktionen (butiksannonser, som säljer nytt/NM) finns ingen
 *   under-pris-vakt på singlar. Tradera-vägen (isPlausibleListingPrice) HAR en
 *   sedan 2026-07-17: skick-okända marknadsannonser <15% av NM-facit = spelat ex.
 *
 * Returnerar true när priset är rimligt eller CM-referenspris saknas.
 */
export const MARKETPLACE_MAX_PRICE_RATIO = 2.5;
// Delad med produktsidans läs-filter (src/lib/listing-plausibility.ts) — en vakt som
// bara körs i EN kodväg är ingen vakt, och skena-raderna läses tillbaka dagar senare
// när facit hunnit ändras.
const SEALED_MIN_PRICE_RATIO = MARKETPLACE_MIN_PRICE_RATIO;
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

// Billiga sealed: BARA en UNDRE gräns (ägarens Tradera-safeguard). Övre gräns är opålitlig
// (svensk butiks-markup 2,5× är laglig), men ett pris långt UNDER ett PÅLITLIGT facit =
// öppnat ex / feltajmad auktion (Ascended Heroes-tin: Tradera 19 kr mot verkliga 142 kr).
// Förutsättning: facitet är pålitligt — därför korsvalideras CM-priset mot vår stabila
// historik i isPlausibleListingPrice innan den här gränsen tillämpas.
const CHEAP_SEALED_LOWER_GUARD = new Set(["TIN", "BLISTER", "BOOSTER_PACK"]);

/**
 * REN beslutsdel (ingen DB) — anropare som redan har kategori + CM-referenspris i
 * minnet slipper två DB-rundresor per annons. runScrapeJob förladdar båda per källa;
 * över Atlanten (GitHub-runner i us-east → Neon i Frankfurt) kostade de per-annons-
 * frågorna ~100 ms styck och drev jobbet mot 120-minuterstaket.
 * cmPriceOre = null → inget referenspris → alltid rimligt.
 */
export function isPlausiblePriceFor(
  category: string | null | undefined,
  cmPriceOre: number | null | undefined,
  priceOre: number
): boolean {
  if (cmPriceOre == null) return true;

  const isSingle = category === "SINGLE_CARD" || category === "GRADED_CARD";
  if (isSingle) {
    return (
      priceOre <= cmPriceOre * SINGLES_MAX_RATIO ||
      priceOre - cmPriceOre <= SINGLES_MAX_DIFF_ORE
    );
  }
  // Pris-vakt bara för dyra sealed-kategorier (se ovan). Billiga: alltid rimligt
  // pris-mässigt (form-matchning sköter felmatch där).
  if (!PRICE_GUARDED_SEALED_CATEGORIES.has(category ?? "")) return true;
  return (
    priceOre <= cmPriceOre * MARKETPLACE_MAX_PRICE_RATIO &&
    priceOre >= cmPriceOre * SEALED_MIN_PRICE_RATIO
  );
}

/**
 * DB-hämtande variant som returnerar en ÅTERANVÄNDBAR prisvakt för produkten:
 * en hämtning av facit-underlaget (CM-offer + kategori + stabil historik),
 * sedan ren funktion per pris. Tradera-svepets Fas 0 vaktar upp till 20
 * annonser per produkt — per-annons-DB-frågor hade varit 3 rundresor styck.
 */
export async function getListingPriceGuard(
  productId: string
): Promise<(priceOre: number) => boolean> {
  const [cmOffer, product, snaps] = await Promise.all([
    prisma.offer.findFirst({
      where: { productId, retailer: { name: "Cardmarket" }, price: { not: null } },
      select: { price: true },
    }),
    prisma.product.findUnique({ where: { id: productId }, select: { category: true } }),
    prisma.priceSnapshot.findMany({
      where: { productId }, select: { avgPrice: true }, orderBy: { date: "desc" }, take: 10,
    }),
  ]);

  // ── Ägarens Tradera-safeguard (2026-07-15) ─────────────────────────────────
  // Facitet vi jämför Tradera-priset mot får INTE självt vara korrupt. CM-offer-priset
  // kan vara felmappat/fruset (hela prissagan). En STABIL egen historik (platt, ≥5 pkt)
  // är då ett pålitligare facit: avviker CM-priset >4x från den → använd historik-medianen.
  const vals = snaps.map((s) => s.avgPrice).filter((v) => v > 0).sort((a, b) => a - b);
  const histOre = vals.length >= 5 && vals[vals.length - 1] / vals[0] <= 1.5
    ? vals[Math.floor(vals.length / 2)] : null;
  let refOre = cmOffer?.price ?? null;
  if (histOre != null && (refOre == null || refOre > histOre * 4 || refOre < histOre / 4)) {
    refOre = histOre;
  }

  const category = product?.category;
  const isSingle = category === "SINGLE_CARD" || category === "GRADED_CARD";
  return (priceOre: number) => {
    // Undre-gräns-vakt för billiga sealed: BARA med ett PÅLITLIGT facit = vår STABILA egen
    // historik. Utan historik kan CM-ref vara felmappat HÖGT för en billig pack (860 kr på en
    // 69-kr-pack) → då raderar en CM-baserad undre-vakt det RÄTTA billiga priset och behåller
    // det felaktiga CM-et. Därför kräver vakten historik, inte bara CM. (Facitet i övrigt =
    // refOre, som redan är CM korsvaliderad mot historik.)
    if (histOre != null && CHEAP_SEALED_LOWER_GUARD.has(category ?? "")
        && priceOre < histOre * SEALED_MIN_PRICE_RATIO) {
      return false;
    }
    // Undre gräns även för SINGLAR (ägaren 2026-07-17): vår singel-headline BETYDER
    // "NM engelska (Cardmarket)" — en Tradera-annons långt under NM-facit är i praktiken
    // ett SPELAT ex (Charmander Base 9 kr mot CM-NM 62 kr headline:ade som produktens
    // lägsta pris). Skicket går inte att läsa ur annonsen → <15% av facit = avvisa.
    // Ersätter den gamla hållningen "billiga kort varierar fritt nedåt" — den lät
    // skick-okända annonser låtsas vara NM. Facit = refOre (CM korsvaliderad mot stabil
    // historik ovan), samma tillitskedja som sealed-vakten.
    if (isSingle && refOre != null && priceOre < refOre * SEALED_MIN_PRICE_RATIO) {
      return false;
    }
    return isPlausiblePriceFor(category, refOre, priceOre);
  };
}

/** Engångsvariant (scrape-runner m.fl. som bara vaktar ETT pris per produkt). */
export async function isPlausibleListingPrice(
  productId: string,
  priceOre: number
): Promise<boolean> {
  return (await getListingPriceGuard(productId))(priceOre);
}
