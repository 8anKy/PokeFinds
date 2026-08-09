/**
 * Automatisk Cardmarket-prisuppdatering via CardMarket API TCG (RapidAPI Pro).
 * Körs EN gång/dygn (Pro = 3000 anrop/dygn; en full körning ~1100 anrop).
 *
 * - Singlar: engelska NM-lägsta "From" (`lowest_near_mint`) EXAKT (matchar CM 1:1,
 *   ingen utjämning) × live-kurs. Matchas mot vår DB via tcgid = Card.tcgExternalId,
 *   annars cardmarket_id, annars set+samlarnummer+kortnamn (se SET+NUMMER-RESERVEN).
 * - Sealed: CM lägsta (`lowest`) för rätt-matchad produkt (set+form+namnlikhet).
 *
 * Delas av jobb-schemaläggaren (worker.ts/instrumentation) och CLI-wrappers.
 * Prishistoriken/grafen (CM trend) rörs INTE — bara Offer.price.
 */
import { prisma } from "../lib/db";
import { mapPool } from "../lib/concurrency";
import { getRatesOre, priceOreFromEur } from "../lib/exchange-rate";
import { cmImageProxyUrl, cmRenderExists } from "../lib/cm-image";
import {
  cardmarketJapaneseProductUrl,
  cardmarketProductUrl,
  isEnglishCardmarketUrl,
  withFirstEd,
  withNearMint,
  type FirstEdFilter,
} from "../lib/marketplace-urls";
import { judgeSameProduct } from "../lib/same-product";
import { expansionSetJoin } from "../lib/cm-expansion-join";
import { adoptCmName } from "./adopt-cm-name";
import { createSetLabeler } from "./sealed-set-label";
import { runJapaneseSetLabels } from "./jp-set-label";
import { utcToday } from "../lib/utils";
import { classifyForm, scoreSimilarity } from "../scrapers/matching";
import { recomputeProductPriceCache, snapshotStorePricedProducts } from "../services/products";
import { fetchTcgCardById, cardMarketPriceOre } from "../scrapers/adapters/pokemontcg-adapter";
import {
  PRINT_FIRST_EDITION,
  PRINT_UNLIMITED,
  PRINT_VARIANT_LABELS,
  REVERSE_VARIANT_LABELS,
  isPrintVariantLabel,
  printLabelFromVersion,
  printRank,
} from "../lib/print-variant";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
// Samtidiga DB-skrivningar (≤ DB_POOL i db.ts). Kortar 18k sekventiella
// cross-region-uppdateringar från ~30 min till några minuter.
const DB_CONCURRENCY = 8;
// Samtidiga API-sidhämtningar. Döljer nätverkslatens (US-runner → RapidAPI)
// utan att överskrida 300/min: varje task sover throttle×API_CONCURRENCY.
const API_CONCURRENCY = 4;

interface CmCard {
  tcgid: string | null;
  cardmarket_id: number | null;
  name?: string | null; // identitetsvakten: jämförs mot CM:s officiella katalognamn
  // TRYCKNINGEN raden gäller ("1st Edition", "1st Edition Shadowless", "Shadowless",
  // "Unlimited"). Se printRank — WOTC-episoderna har en rad per tryckning och
  // `tcgid` hänger på 1st Edition-raden, som inte är kortet vår katalog håller.
  version?: string | null;
  // Samlarnummer + set — reservnyckeln när `tcgid` inte är pokemontcg.io:s (se
  // SET+NUMMER-RESERVEN nedan). `card_number` är ibland Int, ibland sträng.
  card_number?: string | number | null;
  episode?: { id?: number | null; name?: string | null } | null;
  prices?: { cardmarket?: { lowest_near_mint?: number | null; "30d_average"?: number | null } | null } | null;
}
interface ApiProduct {
  name: string;
  cardmarket_id: number | null;
  image?: string;
  prices?: {
    cardmarket?: {
      lowest?: number | null;
      "30d_average"?: number | null;
      available_items?: number | null;
      // Språk-överstyrda lägsta (DE/FR/ES/IT) — används av tunndata-vakten nedan.
      lowest_DE?: number | null;
      lowest_FR?: number | null;
      lowest_ES?: number | null;
      lowest_IT?: number | null;
    } | null;
  } | null;
  episode?: { name?: string } | null;
}

const norm = (s: string) =>
  s.toLowerCase().replace(/pok[eé]mon|tcg|:/g, "").replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();

// Prisvakt mot glitchad lowest åt BÅDA håll. En äkta CM From/lowest (billigaste
// aktuella annonsen) sitter alltid i botten av spannet: aldrig <20% av 30d-snittet
// (RapidAPI gav 2026-07-03 €0.03 på en €300-box → 0,33 kr) och aldrig långt ÖVER
// det heller — golvet kan per definition inte ligga 1,8x över snittet. 2026-07-03
// gav RapidAPI €9.9 på ett €4.9-snitt (2,0x) för Paradox Rift Booster; det slank
// under 3x-dagvakten och frös headline på ~113 kr. Utanför [0.2x, 1.8x] av snittet
// = glitch → fall tillbaka på 30d-snittet. ponytail: 1.8x fångar glitchen med marg;
// en genuint stigande marknad döljs tillfälligt bakom snittet (self-heal nästa dag).
export const HIGH_MULT = Number(process.env.CM_HIGH_MULT) || 1.8;
export function sanePriceEur(low: number | null | undefined, avg: number | null | undefined): number | null {
  const l = low ?? null, a = avg ?? null;
  if (l != null && l > 0 && (a == null || (l >= a * 0.2 && l <= a * HIGH_MULT))) return l;
  return a;
}

/**
 * Så långt isär får 30-dagssnittet och trenden ligga och ändå räknas som ENIGA.
 * Under det är den lägre siffran en rimlig kalibrering; över det är en av dem
 * korrupt och får inte användas som ursäkt för att släppa igenom en misstänkt låg
 * From. Mätt: friska produkter ligger inom ~2,5x (Prismatic 186/72 = 2,6x), medan
 * vintage där den ena källan spårat ur ligger på 100x+ (EX Team Rocket Returns
 * 1 172/9,2 = 127x).
 */
const REF_AGREEMENT = 5;

/**
 * Är `low` (CM:s "From") trovärdig? TAKET vägs mot trenden (oförändrat). GOLVET får
 * sänkas till 30-dagssnittets nivå — men BARA när Cardmarkets två referenser är
 * ense om storleksordningen.
 *
 * Bakgrund: 0.2x-golvet är kalibrerat mot 30-DAGSSNITTET ("en äkta From ligger aldrig
 * under 20% av snittet") men anropades med TRENDEN. På en snabbt stigande marknad
 * springer trenden ifrån snittet, golvet följer med uppåt och kastar en fullt äkta
 * From — varpå vi publicerar TRENDEN som butikspris. Mätt 2026-07-21: Prismatic
 * Evolutions Poster Collection, From 35 €, snitt 72 €, trend 186 € → 2 166 kr i
 * katalogen mot butikernas 299-599 kr.
 *
 * ENIGHETSKRAVET är inte kosmetiskt — utan det återinför relaxeringen den
 * dokumenterade EMPTY-PACKS-fällan: EX Team Rocket Returns Booster har From 15 € och
 * RapidAPI-snitt 9 € medan CM:s egen guide säger trend 1 172 € / snitt 2 194 €. Där
 * är den låga From:en en annons på ett TOMT omslag, inte ett fynd, och 127x-avståndet
 * mellan referenserna är signalen. Se [[project_daymove_guard_ratchet]].
 *
 * TAKET lämnas mot trenden: relaxering åt det hållet ändrar bara priser där problemet
 * är en skräp-From eller en felaktig länk, inte vakten.
 *
 * Saknas referenser helt släpps `low` igenom (som sanePriceEur alltid gjort).
 */
export function lowIsCredible(
  low: number | null | undefined,
  avg: number | null | undefined,
  trend: number | null | undefined
): boolean {
  if (low == null || low <= 0) return false;
  const refs = [avg, trend].filter((v): v is number => v != null && v > 0);
  if (refs.length === 0) return true;
  const hi = Math.max(...refs);
  const lo = Math.min(...refs);
  const ceiling = (trend != null && trend > 0 ? trend : refs[0]) * HIGH_MULT;
  const floor = (hi / lo <= REF_AGREEMENT ? lo : ceiling / HIGH_MULT) * 0.2;
  return low >= floor && low <= ceiling;
}

// ── CM:s EGEN TREND SOM FACIT (mätt 2026-07-14) ──────────────────────────────
// sanePriceEur behöver en referens (`avg`) för att kunna döma `low`. Saknas den
// släpps `low` igenom OGRANSKAT — se `a == null ||` ovan. RapidAPI saknar
// 30d_average på ~1% av sealed (20 av 1954), så hålet är litet men verkligt.
//
// Referensen hämtas därför från CM:s EGEN officiella prisguide (samma publika
// export som JP-pris redan läser — ingen skrapning). Den är bättre än RapidAPI:s
// snitt på TVÅ sätt: den finns alltid, och den är rätt på tunn vintage där snittet
// är kraftigt underskattat (se kommentaren vid `const ref` i sealed-fasen).
// `trend` är verifierad mot CM:s produktsida och stämde EXAKT (142,93 och 184,90).
//
// VARFÖR trend och inte guidens `low`: CM:s egen "From" är ibland ren skräp.
// Stormfront Booster visar "From 9,95 €" — den annonsen säger ordagrant
// "EMPTY PACKS". Att spegla CM:s lägsta rakt av skulle prissätta en vintage-
// booster till ett tomt omslag. Lägsta är rätt HEADLINE, men trend är rätt
// SANITETSREFERENS.
// Golv: CM:s guide innehåller nollställda/mikroskopiska trend-värden (0,02 € på
// "Emerald Booster Box", "Team Rocket Returns Booster Box", "151: Costco 5-Pack Mini
// Tin Bundle"). En sealed-produkt kostar aldrig under ~0,5 € — ett sådant "facit" är
// korrupt, inte billigt. Utan det här golvet blir facitet en BAKDÖRR: dagvaktens
// nödutgång ser att en glitchad lowest (0,02 €) "stämmer med trenden" och släpper in
// den. Mätt: 151-bundlen skulle läkas 3 309 kr → 0,23 kr.
const MIN_SEALED_EUR = 0.5;
const usable = (v: number | null | undefined): number | null =>
  v != null && v >= MIN_SEALED_EUR ? v : null;
export function cmGuideRefEur(g: CmGuideEntry | undefined): number | null {
  return usable(g?.trend) ?? usable(g?.avg) ?? null;
}

// ── ÄGARENS PRISREGEL FÖR SINGLAR: `lowest_near_mint` RAKT AV ────────────────
// (beslut 2026-07-24, OMBEKRÄFTAT 2026-07-27 efter att guide-substitutionerna rivits)
//
// Singel-headline = RapidAPI:s `lowest_near_mint` EXAKT som fältet står. Det ÄR
// Cardmarkets lägsta NM-annons på ENGELSKA: syskonfälten heter `_DE`/`_FR`/`_ES`/`_IT`
// och basfältet ligger ÖVER dem i API:ts eget exempel (bas 1,00 mot `_DE` 0,90) — hade
// basen varit "alla språk" vore den per definition ≤ det minsta språkfältet.
//
// Ingenting får längre BYTA UT det värdet. Två vakter försökte, båda ur CM:s egen
// prisguide (price_guide_6.json), och båda publicerade priser som inte fanns någonstans
// på Cardmarket:
//
//   GOLVET (fromContradictsCardmarket → guidens `low`, 07-25 … 07-27)
//     Premiss: "engelska+NM är en delmängd av alla annonser, så en engelsk NM-lägsta kan
//     aldrig ligga under guidens low." Premissen kräver att guidens `low` faktiskt ÄR
//     produktens lägsta annons. Det är den inte: för Rayquaza Gold Star (idProduct
//     276510) säger guiden low = 2 900 € medan CM:s EGEN produktsida samma dag visar
//     From 37 000 € — och feeden sa också 37 000 €. Guidens `low` var 12x fel om det
//     enda fall vi kunde kontrollera. En vakt vars facit är osant dömer ut sanningen.
//     Den skrev dessutom en SEALED-produkts golv som Pidgeys pris (3 262 kr).
//
//   TAKET (fromExceedsCardmarket → medianen av guidens sex fält, 07-27)
//     Samma facit, andra riktningen. Rayquaza ★ · Deoxys 107/107: From 37 000 € (exakt
//     vad CM:s produktsida visar för NM+engelska) låg över guidens högsta fält ×2,5 →
//     ersattes av mittpunkten. Ägaren såg 215,61 kr på ett kort vars billigaste
//     NM-engelska annons kostar 37 000 € och underkände hela konstruktionen.
//
// REGELN HÄREFTER: finns `lowest_near_mint` publiceras den. Punkt. Guiden får fortfarande
// FYLLA ETT TOMRUM (uppskattning när From saknas helt, märkt OUT_OF_STOCK) men aldrig
// överpröva ett värde feeden har. Skyddet mot en korrupt feed ligger kvar där det hör
// hemma — på KÖRNINGSNIVÅ (feedMoveShares), som mäter hela katalogen mot sig själv i
// stället för att döma enskilda kort mot en referens som inte är facit.
//
// ⛔ Föreslå ALDRIG en ny per-kort-vakt byggd på price_guide_6.json. Den filen är inte
//    CM:s From, och tre försök i rad (fromElseTrend, cmLow, cmMedian) har bevisat det.
const pos = (v: number | null | undefined): number | null =>
  typeof v === "number" && v > 0 ? v : null;

/**
 * Officiellt CM-namn → jämförbar form. Attack-parentesen (den långa) faller bort,
 * korta klammer-markörer som [C]/[G]/[GL] är NAMNDELAR och behålls:
 *   "Charizard [Energy Burn | Fire Spin]"        → "charizard"
 *   "Donphan [Exoskeleton | ... | Prime]"        → "donphan"
 *   "Rayquaza [C] LV.X [Dragon Spirit | ...]"    → "rayquazaclvx"
 *   "Professor's Research - Professor Oak"       → "professorsresearchprofessoroak"
 */
export function cmNameKey(name: string): string {
  const key = name
    .replace(/\[([^\]]{4,})\]/g, " ")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[^a-z0-9]/g, "");
  return CM_SPELLING[key] ?? key;
}

/**
 * CM:s EGNA STAVNINGAR av kort som pokemontcg.io stavar annorlunda. EXPLICIT
 * tabell, aldrig en generell stavningstolerans: en sådan hade fällt ihop kort
 * som verkligen är olika, och namnvakten är sista ledet i identitetskedjan.
 *
 * "Imposter Professor Oak" (CM) = "Impostor Professor Oak" (Base 73). Utan
 * raden avvisade vakten CM:s Unlimited- och Shadowless-rader för kortet, och
 * Unlimited-produkten blev därför kvar på 1st Edition-radens pris (125 € =
 * 1 382 kr) efter uppdelningen — precis det fel uppdelningen ska ta bort.
 * Vakten hade rätt: den bara saknade ordboken.
 */
const CM_SPELLING: Record<string, string> = {
  imposterprofessoroak: "impostorprofessoroak",
};

/**
 * Är guide-/katalograden för `idProduct` verkligen VÅRT kort?
 *
 * RapidAPI:s `cardmarket_id` kan peka fel: `base1-2` (Blastoise, Base) fick
 * 291582, som enligt CM:s officiella singel-katalog är "Rayquaza [Dual Claw |
 * Dragon Blast]" — guidens rad prissatte alltså Blastoise som en Rayquaza.
 *
 * Domaren är CM:s EGEN katalog, inte prisernas rimlighet. Ett rent pris-
 * avståndstest gick INTE att lita på: för `base1-4` (Charizard, Base) ligger
 * guiden (avg30 2 506 €) och RapidAPI (30d 10,46 €) 240x isär, och där är det
 * RAPIDAPI som är trasig — ett avståndstest kastade den RÄTTA guide-raden och
 * publicerade 116 kr för en Base-Charizard.
 *
 * Prefixmatch åt båda håll: CM skriver ofta ut mer än vi ("Turtwig Lv.10",
 * "Boss's Orders - Ghetsis"). Saknas katalognamn eller kortnamn → betrodd.
 */
export function guideNameMatches(
  officialName: string | null | undefined,
  cardName: string | null | undefined,
): boolean {
  if (!officialName || !cardName) return true;
  const a = cmNameKey(officialName), b = cmNameKey(cardName);
  if (!a || !b) return true;
  return a.startsWith(b) || b.startsWith(a);
}

/**
 * Är guide-raden ens en SINGEL? Namnvakten ovan kan inte svara på det, för dess
 * "saknas katalognamn → betrodd" är sant PRECIS när idProduct inte finns i
 * singel-katalogen — alltså i det värsta fallet.
 *
 * Mätt 2026-07-26: RapidAPI ger Pidgey · Flashfire 75/106 `cardmarket_id` 271938,
 * som enligt CM:s EGNA kataloger är en SEALED-produkt (finns i sealed-listan, saknas
 * bland de 71 586 singlarna). Dess guide-rad (`low` 295 €) passerade namnvakten
 * obemärkt och publicerade boosterlådans golvpris som kortets pris: 3 262,70 kr för
 * en common. Den vägen är stängd sedan guiden inte längre får överpröva feedens From
 * (2026-07-27) — men raden får fortfarande FYLLA ett tomrum när `lowest_near_mint`
 * saknas, och då gäller samma krav: fel produkt ⇒ ingen uppskattning.
 *
 * Domaren är CM:s egen katalog (samma princip som guideNameMatches): finns idProduct
 * inte bland singlarna är raden inte det här kortet, och får inte prissätta det.
 * Kunde katalogen inte hämtas (tom map) står vakten över körningen i stället
 * för att kasta ALLA guide-rader — samma stand-down som fetchCmSingleNames redan har.
 */
export function guideRowIsSingle(
  idProduct: number | null | undefined,
  cmSingleNames: Map<number, string>,
): boolean {
  if (idProduct == null) return false;
  if (cmSingleNames.size === 0) return true; // katalogen otillgänglig → vakten avstår
  return cmSingleNames.has(idProduct);
}

// ── SET+NUMMER-RESERVEN (2026-07-26) ─────────────────────────────────────────
// `tcgid` var enda singel-nyckeln, och den räcker INTE: RapidAPI publicerar tre
// olika lägen för samma fält, och två av dem gör hela set osynliga för prisjobbet.
//   Pitch Black (me5):    tcgid = null           på ALLA 120 korten
//   Perfect Order (me3):  tcgid = "POR-1"        (CM:s setkod, inte "me3-1")
//   Chaos Rising (me4):   tcgid = "CRI-1"        (dito)
// Utfallet: 366 singlar i tre av de nyaste seten hade ingen CM-offer, inget pris
// och ingen CM-historikpunkt — medan produktsidan ÄNDÅ skrev "Cardmarket" över en
// graf byggd på Tradera-annonser. Kortens riktiga identitet fanns hela tiden i
// svaret: set + samlarnummer. Reserven är EXAKT, inte fuzzy — samma set OCH samma
// nummer OCH samma kortnamn, annars ingen match.
//
// Namnet är vakten som gör nummer-nyckeln säker att lita på. Utan den skulle ett
// felmappat nummer prissätta ett annat kort i samma set.

/** Samlarnummer → jämförbar nyckel: "001" = 1 = "1", men "115a" ≠ "115". */
export function cmNumberKey(v: string | number | null | undefined): string {
  const raw = String(v ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
  // Nollutfyllnad bort ur FÖRSTA siffergruppen ("mep001" → "mep1", "084" → "84").
  // Bokstavssuffix behålls: 115a är ett ANNAT kort än 115 (samma fälla som i
  // Tradera-matchningen, se scrapers/matching.ts).
  return raw.replace(/\d+/, (d) => String(parseInt(d, 10)));
}

/**
 * Samma nyckel, fast med SETKODEN avskalad: "MEP 023" → "23".
 *
 * Feeden skriver promo-nummer med setkoden inbakad ("MEP 023") medan vår katalog
 * håller det bara som "023" — `cmNumberKey` behåller prefixet ("mep23") och de två
 * möts därför aldrig. Det spelade ingen roll så länge korten nåddes av `tcgid`
 * eller `cardmarket_id`, men för korten UTAN pokemontcg.io-id är nummerreserven
 * enda återstående vägen (se byNumberNoTcg nedan).
 *
 * ⛔ PREFIXET FÅR BARA FALLA NÄR DET STÅR SOM EGET ORD. "TG10", "GG08", "SWSH034"
 *    och "SV075" är HELA samlarnumret — skalades bokstäverna av där skulle "TG10"
 *    bli "10" och krocka med kort 10 i samma set, dvs precis den sortens tysta
 *    felmatchning nummerreserven finns för att undvika. Separatorn (mellanslag,
 *    bindestreck, punkt) är alltså villkoret, inte bokstäverna i sig.
 * ⛔ BokstavsSUFFIX står kvar: "MEP 115a" → "115a", aldrig "115".
 */
export function cmNumberKeyNoSetCode(v: string | number | null | undefined): string {
  const s = String(v ?? "").trim();
  const m = /^[A-Za-z]{1,5}[\s._-]+(\d+[A-Za-z]?)$/.exec(s);
  return cmNumberKey(m ? m[1] : s);
}

/** Energityperna, som CM skriver som symbol i klammer och kortet stavar ut. */
const ENERGY_TYPE_WORDS = new Set([
  "grass", "fire", "water", "lightning", "psychic", "fighting",
  "darkness", "metal", "colorless", "dragon", "fairy",
]);

/**
 * Nyckel för ENERGIKORT där typen skrivs olika: CM sätter symbolen i klammer
 * ("Shadowy [D] Energy", ibland backslash-escapad som "Bubbly \[W\] Energy")
 * medan kortet stavar ut den ("Shadowy Darkness Energy"). Typordet faller bort
 * på båda sidor — det SÄRSKILJANDE ordet (Shadowy/Bubbly/Voltaic) står kvar, så
 * två olika specialenergier kan aldrig matcha varandra. null = inte ett energikort.
 */
function energyNameKey(name: string): string | null {
  const noBrackets = name.replace(/\[[^\]]*\]/g, " ");
  if (!/energy\s*\\?\s*$/i.test(noBrackets.trim())) return null;
  return noBrackets
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((w) => w && !ENERGY_TYPE_WORDS.has(w))
    .join("");
}

/**
 * Är RapidAPI-kortets namn samma kort som vårt? Prefixmatch åt båda håll (CM
 * skriver ofta ut mer än vi: "Mega Darkrai ex" vs "Mega Darkrai ex [Dusk Raid |
 * Abyss Eye]"). Saknas något namn → INGEN match: reserven får bara användas när
 * identiteten är bevisad, till skillnad från guideNameMatches som bara avgör om
 * en redan matchad rad är trovärdig.
 *
 * Vakten är hela poängen med reserven, och den fångar äkta fel: CM listar Chaos
 * Rising 77 som "Great Haul Net" där vår katalog har "Emma" (och 78 omvänt) —
 * numret ensamt hade prissatt fel kort. Vid oenighet prissätts INGET.
 */
export function cmCardNameAgrees(
  ourName: string | null | undefined,
  cmName: string | null | undefined,
): boolean {
  if (!ourName || !cmName) return false;
  const a = cmNameKey(ourName), b = cmNameKey(cmName);
  if (!a || !b) return false;
  if (a.startsWith(b) || b.startsWith(a)) return true;
  const ea = energyNameKey(ourName), eb = energyNameKey(cmName);
  return ea != null && eb != null && ea === eb;
}

/** Set-/episodnamn → jämförbar nyckel (RapidAPI-episod ↔ vår CardSet). */
export function cmSetNameKey(name: string | null | undefined): string {
  return String(name ?? "").toLowerCase().normalize("NFD").replace(/[^a-z0-9]/g, "");
}

// ── TÄCKNINGSVAKT (2026-07-26) ────────────────────────────────────────────────
// Det som gjorde 366 saknade singlar möjliga var inte matchningsregeln — det var att
// INGENTING larmade. Tre hela set låg utan Cardmarket-data i veckor och varje körning
// var grön: en körning som täcker allt och en som missar ett helt set ser identiska ut
// i loggen. Vakten gör skillnaden synlig och RÖD.
//
// Två frågor, båda billiga DB-läsningar:
//   (a) finns ett set med singlar men NOLL CM-offers? (nytt set som föll ur matchningen)
//   (b) prissatte dagens körning FÄRRE kort än gårdagens? (tystnande täckning)
// (b) mäts på PriceObservation — den enda historiken som finns per källa och dygn.

/**
 * Set där CM bevisligen inte har korten. Sätt BARA in ett set här när du verifierat att
 * CM saknar produkterna — annars döljs nästa riktiga bugg bakom en tystad rad.
 *
 * Verifierat 2026-07-26 med `scripts/probe-cm-from.ts`: RapidAPI ger dessa kort
 * `cardmarket_id: null` och tom `prices.cardmarket` (tk1a-1 Bagon, mcd15-1 Treecko).
 * Ingen CM-produkt = inget pris OCH ingen länk att visa — den ärliga "–" är rätt svar,
 * och det är därför de inte kan få ens en länk-offer.
 */
export const COVERAGE_ALLOWED_EMPTY_SETS: string[] = [
  "sve",   // Scarlet & Violet Energies (16 kort)
  "mcd15", // McDonald's Collection 2015 (12)
  "tk1a",  // EX Trainer Kit Latias (10)
  "tk1b",  // EX Trainer Kit Latios (10)
  "tk2a",  // EX Trainer Kit 2 Plusle (12)
  "tk2b",  // EX Trainer Kit 2 Minun (12)
];

/**
 * Hur stor andel av de PRISSÄTTBARA korten en full körning måste prissätta.
 *
 * Referensen är kataloghens tillstånd (kort med CM-offer minus den kända skulden), INTE
 * "i går". Ett dygnsjämförande mått lät sig luras: 2026-07-25 skrev ett historik-backfill
 * en CM-observation för 20 153 singlar med deras BEFINTLIGA offer-pris (base4-21 Beedrill
 * fick en punkt 07-25 fast dess offer inte rörts sedan 06-13) → dagen efter såg en helt
 * normal körning ut som ett 3 %-tapp. En engångskörning får inte kunna göra nästa dags
 * jobb rött.
 */
export const COVERAGE_MIN_PRICED_SHARE = Number(process.env.CM_COVERAGE_MIN_PRICED_SHARE) || 0.98;

/**
 * En CM-offer som inte rörts på så här många dygn räknas som övergiven.
 *
 * SJU dygn, inte tre, och det är TIDEN som skiljer de två felen från varandra:
 * RapidAPI tappar tillfälligt `cardmarket_id` och priser för enstaka kort (mätt
 * 2026-07-26: base4-21 Beedrill och dp1-44 Cascoon var prissatta i går, i dag är
 * `prices.cardmarket` tomt) — då är rätt beteende att BEHÅLLA det gamla priset och
 * inte skriva någon historikpunkt, och kortet är tillbaka inom ett par dygn. En
 * STRUKTURELL förlust (sidor utanför räckvidd, set som faller ur matchningen) går
 * aldrig över av sig själv. Ett kort som varit orört en hel vecka är därför det
 * andra, inte det första. Dagsfallsregeln fångar händelsen direkt; den här fångar
 * det som ligger kvar.
 */
export const COVERAGE_STALE_DAYS = Number(process.env.CM_COVERAGE_STALE_DAYS) || 7;
/**
 * Antal övergivna CM-offers som redan fanns när vakten byggdes — en RATCHET, inte en
 * tolerans. Mätt 2026-07-26: 777 singlar (ex-serien, Base Set 2, D&P, promos,
 * Trainer Galleries) har inte fått ett nytt CM-pris sedan 2026-06-13, för att RapidAPI
 * ger dem `cardmarket_id: null` och tom `prices.cardmarket` (verifierat på base4-21
 * Beedrill och dp1-44 Cascoon). De visar alltså ett sex veckor gammalt pris.
 *
 * Vakten får inte skickas ut RÖD av en känd, obeslutad skuld — då stängs den av och
 * skyddar ingenting. Den mäter därför REGRESSION: en NY strukturell förlust (de 662
 * korten som föll bort 2026-07-26 hade tagit den här siffran till ~1 440) blir röd.
 * ⛔ SÄNK talet när skulden betas av. Höj det ALDRIG för att tysta ett larm.
 *
 * ── 800 → 150 (2026-08-05) ────────────────────────────────────────────────────
 * Skulden ÄR betald: guide-reserven prissätter numera de kort leverantören tappat
 * ur CM:s egen prisguide, och `scripts/recover-cm-idproduct.ts` gav 49 av dem
 * tillbaka sitt idProduct. Uppmätt efter den körningen: **120** kvar, mot 777 i juli.
 *
 * Och 800 var inte bara föråldrat — det var SKÄLET till att ingen såg felet. Ägaren
 * hittade frusna kurvor manuellt medan 172 stillastående offers låg 4,6x under taket
 * och varje körning var grön. En baseline som ligger långt över verkligheten är en
 * avstängd vakt som ser påslagen ut.
 *
 * De 120 som är kvar är två KÄNDA grupper, ingen av dem en bugg:
 *   ~81 tryckningar (Shadowless/1st Edition) som bara får publiceras med ett ÄKTA
 *       From — de delar CM-produkt och får därför aldrig guide-uppskattas;
 *   ~37 nya SV/SM-promos där CardTrader numrerar korten annorlunda, så identiteten
 *       inte går att styrka (ägarbeslut 2026-08-05: behåll priset, lista dem).
 * Listan när som helst: `scripts/frozen-cm-report.ts`.
 */
export const COVERAGE_STALE_BASELINE = Number(process.env.CM_COVERAGE_STALE_BASELINE) || 150;

export interface CoverageInput {
  /** Set med ≥1 singel men 0 CM-offers: [externalId ?? namn, antal singlar]. */
  emptySets: { set: string; singles: number }[];
  totalSingles: number;
  coveredSingles: number;
  /** CM-offers på singlar som inte rörts på COVERAGE_STALE_DAYS dygn (= känd skuld). */
  staleOffers: number;
  /** Hur många singlar DEN HÄR körningen prissatte (res.singlesUpdated + singlesCreated). */
  pricedThisRun: number;
}

/** Ren dom (testbar utan DB): duger täckningen, och varför inte? */
export function coverageVerdict(inp: CoverageInput): { ok: boolean; problems: string[] } {
  const problems: string[] = [];
  for (const e of inp.emptySets) {
    if (COVERAGE_ALLOWED_EMPTY_SETS.includes(e.set)) continue;
    problems.push(`set "${e.set}" har ${e.singles} singlar och 0 CM-offers`);
  }
  // Prissatte körningen det som ÄR prissättbart? Prissättbart = kort med CM-offer minus
  // den kända skulden (kort feeden inte längre ger något för). Fångar en strukturell
  // förlust SAMMA dygn den inträffar: de 662 korten som föll bort 2026-07-26 hade tagit
  // körningen till ~19 088 av 19 737 prissättbara = 96,7 % → rött direkt.
  const priceable = Math.max(0, inp.coveredSingles - inp.staleOffers);
  if (inp.pricedThisRun > 0 && priceable > 0 && inp.pricedThisRun < priceable * COVERAGE_MIN_PRICED_SHARE) {
    problems.push(
      `körningen prissatte ${inp.pricedThisRun} av ${priceable} prissättbara singlar ` +
      `(${((inp.pricedThisRun / priceable) * 100).toFixed(1)} %, kräver ` +
      `${Math.round(COVERAGE_MIN_PRICED_SHARE * 100)} %)`
    );
  }
  // Ovanstående fångar HÄNDELSEN. Den här fångar TILLSTÅNDET: kort som slutat
  // uppdateras och inte kommer tillbaka. Ett tapp som sker några kort per dygn passerar
  // händelseregeln obemärkt men syns här när det samlats. Mäts efter körningen, så allt
  // körningen rörde har färsk lastSeenAt — det som är kvar är det den INTE hittade.
  if (inp.staleOffers > COVERAGE_STALE_BASELINE) {
    problems.push(
      `${inp.staleOffers} CM-offers har inte uppdaterats på ${COVERAGE_STALE_DAYS} dygn ` +
      `(känd skuld: ${COVERAGE_STALE_BASELINE}) — körningen har tappat ` +
      `${inp.staleOffers - COVERAGE_STALE_BASELINE} kort UTÖVER den`
    );
  }
  return { ok: problems.length === 0, problems };
}

/** CM:s officiella SINGEL-katalog (idProduct → namn). Publik export, ingen scraping. */
let cmSingleNamesCache: Map<number, string> | null = null;
export async function fetchCmSingleNames(): Promise<Map<number, string>> {
  if (cmSingleNamesCache) return cmSingleNamesCache;
  const r = await fetch(CM_SINGLES_URL);
  if (!r.ok) {
    console.error(`[cm-refresh] singel-katalog HTTP ${r.status} — identitetsvakten står över denna körning`);
    return new Map();
  }
  const cat = (await r.json()) as { products: { idProduct: number; name: string }[] };
  cmSingleNamesCache = new Map(cat.products.map((p) => [p.idProduct, p.name]));
  return cmSingleNamesCache;
}

/** De sex fält CM publicerar per produkt i sin öppna prisguide. */
export interface CmGuideFields {
  low?: number | null; trend?: number | null; avg?: number | null;
  avg1?: number | null; avg7?: number | null; avg30?: number | null;
}

/**
 * Headline-pris för en singel = RapidAPI:s `lowest_near_mint` (CM:s lägsta NM-annons
 * på engelska) RAKT AV. Guiden används BARA när fältet saknas helt.
 *
 * `from: false` ⇒ värdet är en UPPSKATTNING (ingen känd köpbar annons) och offern
 * märks OUT_OF_STOCK, samma semantik som sealed/JP.
 */
export function singlesHeadlineEur(
  cm: { from?: number | null; avg30?: number | null },
  guide?: CmGuideFields | null,
): { eur: number; from: boolean; via?: "from" | "estimate" } | null {
  const g = guide;
  const from = pos(cm.from);
  // ÄGARENS REGEL: har feeden ett NM-engelskt lägstapris ÄR det priset. Ingen guide-rad,
  // ingen referens och ingen median får byta ut det — se blocket vid `pos` ovan för de
  // två vakter som försökte och vad de publicerade (215,61 kr på ett 37 000 €-kort).
  if (from != null) return { eur: from, from: true, via: "from" };

  // From SAKNAS helt → uppskattning (ingen känd köpbar NM-engelsk annons) →
  // OUT_OF_STOCK. Här duger INTE guidens `low`: den är lägsta över alla skick och
  // språk, så den skulle sätta ett trasigt exemplars pris under rubriken "NM
  // engelska" (Gyarados · Base 6/102: low 2 € = 22 kr mot en marknad kring 19 €).
  //
  // MEDIAN, inte prioritetsordning: varje enskild referens kan vara korrupt, och
  // vilken som är det varierar. Guidens `trend` är nollställd (0,02 €) på "N ·
  // Noble Victories" och "Dark Dragonite · Team Rocket"; RapidAPI:s 30d-snitt är
  // 10,46 € på en Base-Charizard som guiden prissätter till 2 506 €. Medianen av
  // de fyra låter inte ETT trasigt fält bestämma — mätt på Gyarados ger den 18,7 €
  // (mot RapidAPI-utstickarens 156 €) och på N 15,4 € (mot trendens 0,02 €).
  const refs = [pos(g?.trend), pos(g?.avg), pos(g?.avg30), pos(cm.avg30)].filter(
    (v): v is number => v != null
  );
  if (refs.length === 0) return null;
  refs.sort((a, b) => a - b);
  const mid = refs.length >> 1;
  const est = refs.length % 2 ? refs[mid] : (refs[mid - 1] + refs[mid]) / 2;
  return { eur: est, from: false, via: "estimate" };
}

/**
 * GUIDE-RESERVENS DOM (2026-08-05) — får det här kortet prissättas ur Cardmarkets
 * EGEN prisguide när vår prisleverantör slutat leverera det?
 *
 * Ren funktion med flit: den avgör om ett pris publiceras på en produkt vars enda
 * kvarvarande identitetsbevis är vår egen länk, och den sortens dom har felat i den
 * här filen förr (sealed-golv som korts pris, `cardmarket_id` mot fel kort). Testas
 * utan DB, utan nät.
 *
 * Två frågor, båda om IDENTITET — aldrig om pris:
 *   1. Är `idProduct` över huvud taget en SINGEL hos Cardmarket? (annars kan en
 *      boosterlådas golv publiceras som kortets pris — det hände 2026-07-26)
 *   2. Är det VÅRT kort? CM:s egen katalognamn måste hålla med om namnet.
 *
 * Priset självt kommer sedan från `singlesHeadlineEur` — samma väg som allt annat.
 * Feeden har per definition ingen From här, så resultatet är alltid en UPPSKATTNING
 * (medianen av guidens trend/avg/avg30) och märks OUT_OF_STOCK av anroparen.
 */
export function guideReserveEur(
  card: { cardName: string; idProduct: number },
  guideRow: CmGuideFields | undefined,
  cmNames: Map<number, string>,
): { eur: number } | { reject: "no-guide-row" | "not-single" | "name" | "no-price" } {
  if (!guideRow) return { reject: "no-guide-row" };
  if (!guideRowIsSingle(card.idProduct, cmNames)) return { reject: "not-single" };
  if (!cmCardNameAgrees(card.cardName, cmNames.get(card.idProduct))) return { reject: "name" };
  const priced = singlesHeadlineEur({}, guideRow);
  if (!priced) return { reject: "no-price" };
  return { eur: priced.eur };
}

// ── EN PRODUKT, EN RAD (2026-07-27) ──────────────────────────────────────────
/**
 * Hur bevisad kopplingen mellan en feed-rad och vår produkt är. Samma ordning som
 * identitetskedjan i CLAUDE.md: `tcgid` är pokemontcg.io-identiteten vi själva
 * lagrar på kortet, `cardmarket_id` är CM:s produkt-id, och set+nummer är
 * RESERVEN — den vet bara att numret stämmer, inte VILKEN tryckning raden är.
 */
export const MATCH_RANK = { tcgid: 3, cmid: 2, number: 1 } as const;

// ── TRYCKNINGEN ÄR IDENTITET, INTE EN PRISNIVÅ (2026-07-28) ──────────────────
/**
 * Hur nära raden ligger den tryckning vår katalog faktiskt håller.
 *
 * Gäller kort som INTE är uppdelade i en produkt per tryckning (allt utom Base):
 * pokemontcg.io har EN post per kort — den ordinarie (Unlimited) tryckningen —
 * medan RapidAPI publicerar en rad per tryckning i de tio WOTC-episoderna och
 * hänger `tcgid` på **1st Edition**-raden. Vår starkaste nyckel valde därför
 * systematiskt den dyraste tryckningen: Ponyta · Base 60/102 publicerades som
 * 26,50 € (1st Edition Shadowless) i stället för 4,29 € (Shadowless).
 *
 * Mätt 2026-07-28 över alla tio episoderna (1 983 feed-rader, 940 av våra kort):
 * 1st Edition-rader har `lowest_near_mint` i 95 % av fallen mot Unlimiteds 18 %,
 * så den dyra raden vann nästan alltid.
 *
 * Det här är samma sorts fråga som `guideNameMatches` ("är raden VÅRT kort?") —
 * inte en prisvakt. Ingen siffra jämförs; bara etiketten. Definitionen bor i
 * src/lib/print-variant.ts och delas med Tradera-matchningen; re-exporteras här
 * eftersom vakten hör ihop med feedRowWins.
 */
export { printRank };

/**
 * Vinner den nya feed-raden över den vi redan har för produkten?
 *
 * VARFÖR: en episod kan innehålla flera rader för samma kort (tryckningar i
 * vintage-set, dubbla CM-produkter bland promos). Utan det här valet skrev båda,
 * och priset som publicerades avgjordes av vilket svar som råkade komma sist.
 *
 * Ordningen:
 *  1. TRYCKNINGEN (printRank) — en 1st Edition-rad är inte kortet vi säljer.
 *  2. Starkast nyckel (tcgid > cardmarket_id > set+nummer).
 *  3. Lägsta cardmarket_id — godtyckligt men DETERMINISTISKT, vilket är hela
 *     poängen. Ett pris som byter värde mellan två körningar utan att marknaden
 *     rört sig syns som prisrörelse i grafen och i movers-listan.
 *
 * ⛔ RÄTT TRYCKNING FÅR INTE AKTIVERA UPPSKATTNINGEN. En rad tar bara över på
 * tryckning om den har ett ÄKTA `lowest_near_mint`. Utan det villkoret vinner en
 * Unlimited-rad utan From, och `singlesHeadlineEur` faller till guide-medianen på
 * radens `cardmarket_id` — som ofta är fel produkt. Mätt i torrkörning:
 * Sabrina's Gaze · Gym Heroes 125 gick 0,55 € → 434,04 € och Electrode · Base 21
 * 110 € → 1,56 €. Saknar den ordinarie tryckningen From behåller vi hellre dagens
 * pris och redovisar det som en öppen post (60 kort ligger kvar ≥3x över
 * pokemontcg.io:s trend för den ordinarie produkten) än gissar.
 */
export function feedRowWins(
  current: { rank: number; cmid: number | null; print?: number; from?: boolean } | undefined,
  next: { rank: number; cmid: number | null; print?: number; from?: boolean },
): boolean {
  if (!current) return true;
  const cp = current.print ?? 2, np = next.print ?? 2;
  if (np !== cp) {
    const nextIsRightPrint = np > cp;
    // BARA en rad med bevisat äkta From får vinna på tryckning. `undefined` är inte
    // bevis för att From saknas — läste vi det som "saknas" kunde en 30d-uppskattning
    // knuffa ut ett riktigt pris (Sabrina's Gaze · Gym Heroes 125: 0,55 € → 434,04 €).
    if ((nextIsRightPrint ? next.from : current.from) === true) return nextIsRightPrint;
    // Annars faller vi igenom till den vanliga nyckelkedjan: hellre dagens pris från
    // fel tryckning än en gissning. De korten redovisas som en öppen post.
  }
  if (next.rank !== current.rank) return next.rank > current.rank;
  return (next.cmid ?? Number.MAX_SAFE_INTEGER) < (current.cmid ?? Number.MAX_SAFE_INTEGER);
}

// ── FEED-HAVERIBRYTARE (ersätter singel-dagklämman, 2026-07-24) ───────────────
// Med golvet-rakt-av kan en per-kort-dagvakt inte finnas kvar för singlar: dess enda
// facit var trenden, och ett äkta ask-hopp (6 271 € → 37 000 € när billigaste raw-
// annonsen säljs och en PSA 7-ask blir golvet) går per definition BORT från trenden
// → vakten hade blivit en spärrhake mot själva policyn (exakt frysen 9470d2c läkte).
// Skyddet mot 2026-07-05-klassen — RapidAPI korrumperar HELA feeden på en gång
// (2 104 priser på en dag) — flyttar till KÖRNINGSNIVÅ: enstaka vilda rörelser är
// asks-marknad, men när en stor ANDEL av katalogen hoppar extremt samtidigt är det
// feeden som är trasig → avbryt RÖTT innan något skrivs. Trösklar justerbara via env.
export const FEED_BREAKER_MULT = Number(process.env.CM_FEED_BREAKER_MULT) || 10;
export const FEED_BREAKER_SHARE = Number(process.env.CM_FEED_BREAKER_SHARE) || 0.05;
export function feedMoveShares(
  pairs: { newOre: number; priorOre: number | null | undefined }[],
): { n: number; big: number; extreme: number; bigShare: number; extremeShare: number } {
  let n = 0, big = 0, extreme = 0;
  for (const p of pairs) {
    if (p.priorOre == null || p.priorOre <= 0 || p.newOre <= 0) continue;
    n++;
    const r = Math.max(p.newOre / p.priorOre, p.priorOre / p.newOre);
    if (r >= DAY_MOVE_MAX) big++;
    if (r >= FEED_BREAKER_MULT) extreme++;
  }
  return { n, big, extreme, bigShare: n ? big / n : 0, extremeShare: n ? extreme / n : 0 };
}

/**
 * Prissätter en sealed-produkt DIREKT från CM:s officiella prisguide — samma From→trend→
 * 30d-regel som RapidAPI-vägen, men utan RapidAPI. Används för EN-produkter vars idProduct
 * INTE finns i RapidAPI-katalogen (Trick or Trade, vintage) och som annars aldrig prissätts
 * dagligen (fryser). Exakt samma väg som JP-refreshen redan använder.
 *
 * `accepted` = TRUE när priset är CM:s faktiska From (köpbar annons) → IN_STOCK; FALSE när
 * From förkastades/saknades och vi föll tillbaka på trend/30d → OUT_OF_STOCK (uppskattning).
 * Returnerar null när guiden saknar användbar data (< MIN_SEALED_EUR överallt).
 */
export function priceFromGuide(g: CmGuideEntry | undefined): { eur: number; accepted: boolean } | null {
  const low = usable(g?.low);
  const eur = sanePriceEur(low, cmGuideRefEur(g));
  if (eur == null || eur <= 0) return null;
  return { eur, accepted: low != null && eur === low };
}

// ── VÅR STABILA HISTORIK SOM FACIT (ägarens regel-tillägg, 2026-07-15) ────────
// Ägarens prisregel: FROM > TREND > 30-dagssnitt, aldrig 1-dagsspiken. Men CM-GUIDEN
// SJÄLV glitchar ibland: Skyridge visade trend/avg ~97k€ (1-dagsspiken) i stället för
// det stabila ~42k€. Då är guidens 30-dagssnitt-FÄLT också korrupt och sanningen finns
// bara i VÅR egen historik. Signaturen: en PLATT historik (låg spridning) + ett dagsvärde
// som avviker → glitchen ligger i dagsvärdet, inte i marknaden. Returnerar historik-
// medianen (öre) BARA när historiken är stabil nog att lita på (≥5 pkt, spridning <1.5x).
// Volatil historik = äkta marknad → returnera null (rör inte priset).
export function stableHistoryOre(snapshotOre: number[]): number | null {
  const v = snapshotOre.filter((x) => x > 0).sort((a, b) => a - b);
  if (v.length < 5) return null;
  if (v[v.length - 1] / v[0] > 1.5) return null;
  return v[Math.floor(v.length / 2)];
}

// ── HISTORIK-VAKTEN VAR EN RATCHET (rotorsak, mätt 2026-07-24) ────────────────
// stableHistoryOre litar på VÅR historik som facit. Men historiken kan vara FÖRGIFTAD:
// en produkt som butiksprissattes (snapshotStorePricedProducts) INNAN den fick en CM-
// match får en stabil BUTIKS-historik, och när CM-guiden sedan ger den äkta (mycket
// lägre) From sköt vakten tillbaka priset till butiksnivån — och skrev en ny butiksnivå-
// snapshot som höll historiken "stabil" → en självförevigande ratchet. Mätt: Mega Lucario
// ex League Battle Deck låst på 529 kr (butikspris) sedan 2026-07-15 trots CM-From 19,9 €.
//
// FIX: hoppa över historik-vakten när CM:s EGNA tre siffror (From, trend, 30d-snitt) ALLA
// finns och stämmer inom AGREE. Då är CM:s marknad likvid och självkonsistent → den
// accepterade From:en är facit och en (ev. förgiftad) historik-median får inte överrösta
// den. Tunn vintage (D&P-box, Team Rocket Returns-pack) faller ut: där spretar avg mot
// trenden (guidens siffror är opålitliga/undervärderade) → historik-skyddet BEHÅLLS.
// Skyridge-glitchen (trend/avg spikar) täcks fortfarande: där är low aldrig accepterad.
export const HISTORY_TRUST_AGREE = Number(process.env.CM_HISTORY_TRUST_AGREE) || 1.5;
export function cmSelfConsistent(
  from: number | null | undefined,
  trend: number | null | undefined,
  avg: number | null | undefined,
): boolean {
  const three = [from, trend, avg].filter((v): v is number => typeof v === "number" && v > 0);
  if (three.length < 3) return false; // saknas någon siffra → för lite bevis, behåll vakten
  return Math.max(...three) / Math.min(...three) <= HISTORY_TRUST_AGREE;
}

/** CM:s officiella prisguide (idProduct → low/trend/avg). Publik export, ingen scraping. */
let cmGuideCache: Map<number, CmGuideEntry> | null = null;
export async function fetchCmGuide(): Promise<Map<number, CmGuideEntry>> {
  if (cmGuideCache) return cmGuideCache;
  const r = await fetch(CM_PRICE_GUIDE_URL);
  if (!r.ok) {
    console.error(`[cm-refresh] prisguide HTTP ${r.status} — sanitetsreferens saknas denna körning`);
    return new Map();
  }
  const guide = (await r.json()) as { priceGuides: CmGuideEntry[] };
  cmGuideCache = new Map(guide.priceGuides.map((e) => [e.idProduct, e]));
  return cmGuideCache;
}

/**
 * idProducts som finns i CM:s SEALED-katalog (products_nonsingles_6.json). Används av
 * EN-guide-fallbacken för att GARANTERA att vi bara guide-prissätter mot en riktig sealed-
 * produkt — ALDRIG mot en singel (annars återuppstår Venusaur→Surfing Pikachu-buggen: en
 * sealed-offer som pekar på ett singel-idProduct skulle spåra kortets pris). Tom mängd vid
 * hämtningsfel → fallbacken avstår helt (ingen regression). Samma export som JP-refreshen läser.
 */
let cmSealedIdsCache: Set<number> | null = null;
let cmSealedExpansionsCache: Map<number, number> | null = null;
export async function fetchCmSealedIds(): Promise<Set<number>> {
  if (cmSealedIdsCache) return cmSealedIdsCache;
  const r = await fetch(CM_NONSINGLES_URL);
  if (!r.ok) {
    console.error(`[cm-refresh] nonsingles-katalog HTTP ${r.status} — EN-guide-fallback avstår denna körning`);
    return new Set();
  }
  const cat = (await r.json()) as { products: { idProduct: number; idExpansion?: number | null }[] };
  cmSealedIdsCache = new Set(cat.products.map((p) => p.idProduct));
  cmSealedExpansionsCache = new Map(
    cat.products.flatMap((p) => (p.idExpansion != null ? [[p.idProduct, p.idExpansion] as const] : []))
  );
  return cmSealedIdsCache;
}

/**
 * idProduct → idExpansion ur SAMMA nedladdning. Används av set-etiketteringen i
 * guide-fallback-grenen: produkter som inte finns i RapidAPI (nya tins i ett
 * kommande set) har ändå en exakt expansionstillhörighet i CM:s egen katalog.
 */
export async function fetchCmSealedExpansions(): Promise<Map<number, number>> {
  if (!cmSealedExpansionsCache) await fetchCmSealedIds();
  return cmSealedExpansionsCache ?? new Map();
}

// Dag-över-dag-vakt: en äkta CM-From/lowest rör sig aldrig ≥3x på ett dygn. Ett sådant
// hopp = glitchad RapidAPI-data (2026-07-05 korrumperade 2104 priser, både uppåt på
// commons och krascher på boxar). Behåll då gårdagens snapshot-värde tills nästa körning.
// sanePriceEur fångar bara micro-krascher (<20% av snittet), inte inflation → denna vakt
// täcker BÅDA riktningarna. `priorOre` = produktens senaste snapshot-avgPrice före idag.
export const DAY_MOVE_MAX = Number(process.env.CM_DAY_MOVE_MAX) || 3;

// Under så här få aktuella CM-annonser är marknaden för tunn för att ett reservvärde
// (trend/30d-snitt) ska betyda något — se tunndata-vakten i sealed-fasen.
export const THIN_ITEMS = Number(process.env.CM_THIN_ITEMS) || 5;

// ── LIKVID-MARKNAD-GOLV (mätt 2026-07-23) ────────────────────────────────────
// Motsatsen till tunndata-vakten. På en LIKVID sealed-marknad (många CM-annonser) DÄR
// CM:s trend och 30-dagssnitt är ENSE är trenden pålitlig. En "From" (lägsta annons) långt
// DÄRUNDER är då en enstaka skräp-annons (foreign/felkategoriserad/"EMPTY PACKS"), inte ett
// äkta fynd → använd trenden i stället. Destined Rivals Booster: 7960 annonser, trend 6,92 €
// ≈ 30d, men lägsta 3,50 € → visade 38 kr mot butikernas 79-149.
//
// SNÄV MED FLIT — tre villkor, alla nödvändiga (mätt mot HELA sealed-katalogen):
//   1. LIKVID (≥ LIQUID_ITEMS annonser): på tunn vintage kan en låg From vara ett äkta fynd,
//      och den enda köpbara annonsen — rör den ALDRIG (ägarens regel "Lägsta = HEADLINE").
//   2. STABIL (trend ≈ 30d inom STABLE_AGREE): när trenden springer ifrån 30d-snittet är
//      TRENDEN själv opålitlig (inflaterad vintage ELLER en mismap mot fel produkt) — då får
//      den inte döma From:en. Detta är signalen som skiljer skräp-From från fel-länkad trend.
//   3. From < STABLE_FLOOR × trend: bara det som ligger PÅTAGLIGT under golvet är skräp.
// Faller något villkor = oförändrat (From vinner som förr). Justerbart via env.
export const SEALED_LIQUID_ITEMS = Number(process.env.CM_SEALED_LIQUID_ITEMS) || 100;
// 1.2 (inte 1.3): trend får ligga max 20% från 30d-referensen. Mätt mot hela katalogen —
// 1.3 släppte in två gränsfall (Shining Fates Pikachu V, GO Melmetal) där trenden översköt
// 30d-snittet påtagligt; 1.2 håller ersättningsvärdet (trenden) nära den faktiska marknaden.
export const SEALED_STABLE_AGREE = Number(process.env.CM_SEALED_STABLE_AGREE) || 1.2;
export const SEALED_STABLE_FLOOR = Number(process.env.CM_SEALED_STABLE_FLOOR) || 0.6;

/**
 * Är `low` (CM:s lägsta From) en skräp-annons på en likvid, stabil marknad? Då ska trenden
 * användas i stället. Kräver ALLA tre: likviditet (`items`), att trenden bekräftas av 30d-
 * snittet (annars är trenden själv opålitlig), OCH att From ligger under golvet. Utan 30d
 * kan vi inte bekräfta trenden → false (konservativt: behåll From). Se blocket ovan.
 */
export function isJunkLowOnLiquidMarket(
  low: number | null | undefined,
  avg30: number | null | undefined,
  trend: number | null | undefined,
  items: number | null | undefined,
): boolean {
  if (low == null || low <= 0 || trend == null || trend <= 0) return false;
  if (avg30 == null || avg30 <= 0) return false; // utan 30d går trenden inte att bekräfta
  if ((items ?? 0) < SEALED_LIQUID_ITEMS) return false; // tunn marknad → From kan vara äkta
  if (Math.max(trend, avg30) / Math.min(trend, avg30) > SEALED_STABLE_AGREE) return false; // trend opålitlig
  return low < SEALED_STABLE_FLOOR * trend;
}

// ── DAGVAKTEN VAR EN SPÄRRHAKE (rotorsak, mätt 2026-07-14) ───────────────────
// Utan `refOre` avvisar den ALLA ≥3x-rörelser — även den som RÄTTAR ett redan
// korrupt pris. Ett skräpvärde som en gång tagit sig in kunde därför aldrig
// lämna katalogen: rättelsen såg själv ut som en glitch och klämdes tillbaka.
// Frusna i veckor (allt detta mätt mot LIVE RapidAPI + CM:s prisguide):
//   Paldean Fates: Skeledirge ex Prem.Coll  DB 79 kr    ← RapidAPI låg 149,90 €
//     (= EXAKT vad Cardmarkets sida visar: "From 149,90 €"). Rätt värde 1 733 kr.
//   Great Encounters Booster Box            DB 325 385 kr, CM-trend 1 497 €
//   Mega Charizard X ex Tin                 DB 100 kr,     CM-trend 30,95 €
// RapidAPI var alltså KORREKT hela tiden — vi vägrade skriva svaret.
//
// Fix: ett stort hopp är en glitch bara om det går BORT från ett oberoende
// facit. Går det MOT CM:s egen trend är det en rättelse → släpp igenom.
// Log-avstånd så att jämförelsen är kvot-symmetrisk (2x upp == 2x ner).
export function saneDayMove(
  newOre: number,
  priorOre: number | null | undefined,
  refOre?: number | null,
): number {
  if (priorOre == null || priorOre <= 0) return newOre;
  const r = newOre / priorOre;
  if (r < DAY_MOVE_MAX && r > 1 / DAY_MOVE_MAX) return newOre; // normal dagsrörelse
  // Stort hopp: glitch eller självläkning? Facit avgör.
  // MARGINAL, inte strikt <: vid ett jämnt lopp skiljer flyttalsbruset (2e-16) och
  // vakten skulle "läka" på en slantsingling. Kräv att det nya värdet ligger KLART
  // närmare facit — annars behåll gårdagens (konservativt: en glitch släpps hellre
  // inte in än att en rättelse dröjer ett dygn).
  if (refOre != null && refOre > 0 && newOre > 0) {
    const distNew = Math.abs(Math.log(newOre / refOre));
    const distPrior = Math.abs(Math.log(priorOre / refOre));
    if (distNew < distPrior * 0.9) return newOre; // klart närmare CM:s trend → rättelse
  }
  return priorOre;
}

/**
 * Skriver dagens snapshot-punkter med LAST-WRITE-WINS (insert nya + bulk-uppdatera
 * befintliga — två satser totalt, ingen per-rad-upsert mot Neon).
 *
 * createMany(skipDuplicates) ENSAMT lät första skrivningen på dagen vinna för alltid:
 * 2026-07-23 skrev den avbrutna 15:38-körningen det spärrhake-frusna 281 265 kr som
 * dagens snapshot för Rayquaza ★ Deoxys, och när 18:05-omkörningen HEALADE priset till
 * 69 613 kr kastades snapshot-punkten tyst — grafen fortsatte visa skräpvärdet. En
 * omkörd/rättad körning MÅSTE få ersätta samma dags rad, annars är healingen osynlig
 * i historiken.
 */
export async function upsertTodaySnapshots(
  points: { productId: string; priceOre: number }[],
  today: Date
): Promise<void> {
  if (points.length === 0) return;
  await prisma.priceSnapshot.createMany({
    data: points.map((p) => ({
      productId: p.productId, date: today,
      minPrice: p.priceOre, maxPrice: p.priceOre, avgPrice: p.priceOre, volume: 1,
    })),
    skipDuplicates: true,
  });
  await prisma.$executeRawUnsafe(
    `UPDATE "PriceSnapshot" ps
     SET "minPrice" = v.price, "maxPrice" = v.price, "avgPrice" = v.price, volume = 1
     FROM (SELECT unnest($1::text[]) AS pid, unnest($2::int[]) AS price) v
     WHERE ps."productId" = v.pid AND ps.date = $3::timestamptz::date AND ps."avgPrice" <> v.price`,
    points.map((p) => p.productId),
    points.map((p) => p.priceOre),
    today
  );
}

/** Senaste snapshot-avgPrice FÖRE idag per produkt (last-known-good för dag-vakten). */
async function priorSnapshotMap(productIds: string[]): Promise<Map<string, number>> {
  if (productIds.length === 0) return new Map();
  const rows = await prisma.$queryRawUnsafe<{ productId: string; prev: number }[]>(
    `SELECT DISTINCT ON ("productId") "productId", "avgPrice" AS prev
     FROM "PriceSnapshot" WHERE "productId" = ANY($1) AND date < CURRENT_DATE AND "avgPrice" > 0
     ORDER BY "productId", date DESC`,
    productIds
  );
  return new Map(rows.map((r) => [r.productId, r.prev]));
}

/**
 * Klämmer orimliga dagshopp mot gårdagens snapshot. `refOre` (CM:s egen trend) är
 * spärrhakens nödutgång — utan den kan ett korrupt pris aldrig rättas (se saneDayMove).
 * Returnerar {clamped, healed}.
 */
export async function clampDayMoves(
  ops: { productId: string; priceOre: number | null; refOre?: number | null }[],
): Promise<{ clamped: number; healed: number }> {
  const prior = await priorSnapshotMap(ops.map((o) => o.productId));
  let clamped = 0, healed = 0;
  for (const op of ops) {
    if (op.priceOre == null) continue; // tunndata-op: inget pris att klämma
    const prev = prior.get(op.productId);
    const safe = saneDayMove(op.priceOre, prev, op.refOre);
    if (safe !== op.priceOre) {
      op.priceOre = safe;
      clamped++;
    } else if (prev && (op.priceOre / prev >= DAY_MOVE_MAX || op.priceOre / prev <= 1 / DAY_MOVE_MAX)) {
      healed++; // stort hopp som SLÄPPTES igenom = rättelse mot CM-trend
    }
  }
  return { clamped, healed };
}
const EXPECTED_FORM: Record<string, string> = {
  BOOSTER_BOX: "display", BOOSTER_PACK: "booster", ETB: "etb",
  BUNDLE: "bundle", COLLECTION_BOX: "collection", BLISTER: "blister", TIN: "tin",
};

// Global namnmatch (set-lösa stubs) kräver högre tröskel än set-scopat: hela
// katalogen är i spel, så namnet måste ensamt bära set-infon.
const SET_SCOPED_MIN_SCORE = 0.55;
const GLOBAL_MIN_SCORE = 0.72;

/**
 * Bästa CM-katalogmatch för en sealed-produkt (form-gate + namnlikhet). Med set
 * = set-scopat som förr. UTAN set (auto-importerade butiks-stubs saknar episode)
 * = matcha mot HELA katalogen med högre tröskel så de ändå får CM-pris/trend.
 * ponytail: global namnmatch kan fel-länka udda titlar; store-cross-check i
 * anroparen (priceOre > storeMin×2.5 → skip) är säkerhetsnätet — höj
 * GLOBAL_MIN_SCORE om fel-länkningar dyker upp.
 */
export function bestSealedMatch(
  product: { title: string; category: string; setName: string | null },
  apiProducts: ApiProduct[],
  byEpisode: Map<string, ApiProduct[]>
): { match: ApiProduct; score: number } | null {
  const setLess = !product.setName;
  const cands = setLess ? apiProducts : byEpisode.get(norm(product.setName!));
  if (!cands?.length) return null;
  const minScore = setLess ? GLOBAL_MIN_SCORE : SET_SCOPED_MIN_SCORE;
  const expForm = EXPECTED_FORM[product.category] ?? null;
  const ourClean = norm(product.title);
  let best: ApiProduct | null = null;
  let bestScore = 0;
  for (const c of cands) {
    if (expForm && classifyForm(c.name) !== expForm) continue;
    if (product.category === "BOOSTER_BOX" && !/booster/i.test(c.name)) continue;
    const s = scoreSimilarity(ourClean, norm(c.name));
    if (s > bestScore) { bestScore = s; best = c; }
  }
  return best && bestScore >= minScore ? { match: best, score: bestScore } : null;
}

export interface CmRefreshResult {
  ran: boolean;
  singlesUpdated: number;
  singlesCreated: number;
  sealedUpdated: number;
  historyPoints: number;
  apiCalls: number;
  remaining: number;
}

/**
 * Prissätter SINGLE_CARD-produkter med variantLabel != null (specialvarianter
 * som Cardmarket listar separat men RapidAPI saknar) via pokemontcg.io:s
 * Cardmarket-trend för samma tcgExternalId. Uppdaterar CM-offer + skriver en
 * daglig historikpunkt så variantgrafen lever framåt. Returnerar antal kort.
 */
export async function runVariantRefresh(): Promise<number> {
  await getRatesOre(); // värm kursen (cardMarketPriceOre läser den synkront)
  const cm = await prisma.retailer.findFirst({ where: { name: "Cardmarket" }, select: { id: true } });
  const cmSource = await prisma.scrapeSource.findFirst({ where: { name: "Cardmarket" }, select: { id: true } });
  const variants = await prisma.product.findMany({
    // TRYCKNINGAR UNDANTAS: pokemontcg.io har EN cardmarket-serie per tcgExternalId,
    // så alla tre tryckningarna hade fått samma trendpris — och det hade skrivit över
    // de tryckningsspecifika From-priser runCardmarketRefresh just satt.
    //
    // ⛔ REVERSE HOLO UNDANTAS AV SAMMA SKÄL, FAST VÄRRE: `cardMarketPriceOre`
    // läser `trendPrice`, dvs BASKORTETS trend — pokemontcg.io har ingen separat
    // serie för reverse-varianten. Utan undantaget hade det här jobbet skrivit
    // över CardTraders reverse-golv med det ORDINARIE kortets pris varje dygn,
    // och de ~8 000 reverse-produkterna hade dessutom lagt ~4,5 h sekventiella
    // pokemontcg.io-anrop (~2 s styck) i ett jobb som redan har 2 h budget.
    // Reverse-priset ägs av src/jobs/cardtrader-reverse.ts.
    where: {
      category: "SINGLE_CARD",
      variantLabel: { not: null, notIn: [...PRINT_VARIANT_LABELS, ...REVERSE_VARIANT_LABELS] },
      card: { tcgExternalId: { not: null } },
    },
    select: { id: true, card: { select: { tcgExternalId: true } }, offers: { where: { retailerId: cm?.id }, select: { id: true }, take: 1 } },
  });
  const today = utcToday();
  let n = 0;
  // Kretsbrytare: keyless pokemontcg.io 429:ar/blockar ibland CI-runnern helt. Utan
  // detta probade loopen ALLA varianter × ~2 s = bortkastad tid i slutet av ett redan
  // pressat 2h-jobb. Faller de första VARIANT_MAX_FAILS i rad → API:t är nere, hoppa
  // resten (variantpriserna uppdateras i morgon i stället). retries:1 → billig miss.
  const VARIANT_MAX_FAILS = 8;
  let consecutiveFails = 0;
  for (const p of variants) {
    const ext = p.card?.tcgExternalId;
    if (!ext) continue;
    const card = await fetchTcgCardById(ext, { retries: 1 });
    if (!card) {
      if (++consecutiveFails >= VARIANT_MAX_FAILS) {
        console.warn(`[cm-refresh] Varianter: pokemontcg.io svarar inte (${consecutiveFails} misslyckanden i rad) — hoppar resten, försöker igen i morgon.`);
        break;
      }
      continue;
    }
    consecutiveFails = 0;
    const priceOre = cardMarketPriceOre(card); // CM-trend (EUR) → öre
    // <= 0 lika illa som null: ett kort på 0 kr är ett påstående som aldrig varit
    // sant, och avrundningen kan producera det ur ett äkta mikrobelopp.
    if (priceOre == null || priceOre <= 0) continue;
    const offerId = p.offers[0]?.id;
    if (offerId) {
      await prisma.offer.update({ where: { id: offerId }, data: { price: priceOre, stockStatus: "IN_STOCK", condition: "NEAR_MINT", lastSeenAt: new Date() } });
    }
    if (cmSource) {
      await prisma.priceObservation.create({ data: { productId: p.id, sourceId: cmSource.id, price: priceOre, currency: "SEK" } });
      await prisma.priceSnapshot.upsert({
        where: { productId_date: { productId: p.id, date: today } },
        update: { minPrice: priceOre, maxPrice: priceOre, avgPrice: priceOre },
        create: { productId: p.id, date: today, minPrice: priceOre, maxPrice: priceOre, avgPrice: priceOre, volume: 1 },
      });
    }
    n++;
  }
  if (n > 0) console.log(`[cm-refresh] Varianter: ${n} prissatta via pokemontcg.io-trend.`);
  return n;
}

// ── Japanska sealed: officiella Cardmarket-prisguiden ────────────────────────
// Japanska set har EGNA produktsidor på Cardmarket (JP-bannrade expansioner) och
// finns INTE i RapidAPI-katalogen. Priskälla = CM:s officiella publika dataexporter
// (samma som import-cardmarket-priceguide.ts — ingen scraping):
//   prisguiden ger `low` (lägsta aktuella annons) + `trend`/`avg` per idProduct.
// Pris vi visar = `low` (lägsta, samma semantik som EN-sealed); ur lager utan
// aktuell annons → trend/avg + OUT_OF_STOCK. Länk = idProduct + language=7
// (japanska annonser). Mappningen productId→idProduct bor i CM-offerens URL
// (DB-driven — funkar i molnjobb utan lokala cachefiler).
const CM_PRICE_GUIDE_URL =
  "https://downloads.s3.cardmarket.com/productCatalog/priceGuide/price_guide_6.json";
const CM_NONSINGLES_URL =
  "https://downloads.s3.cardmarket.com/productCatalog/productList/products_nonsingles_6.json";
const CM_SINGLES_URL =
  "https://downloads.s3.cardmarket.com/productCatalog/productList/products_singles_6.json";

interface CmGuideEntry {
  idProduct: number;
  avg: number | null;
  low: number | null;
  trend: number | null;
  avg30: number | null;
}
interface CmNonSingle {
  idProduct: number;
  name: string;
  categoryName: string;
  idExpansion: number;
  /** När CM la in produkten. Prövar en föreslagen setkod mot släppdatumet (jp-set-label). */
  dateAdded?: string;
}

/** CM-katalogkategorier som får matchas per vår produktkategori (JP-mappning). */
const JP_CM_CATEGORIES: Record<string, string[]> = {
  BOOSTER_PACK: ["Pokémon Booster"],
  BOOSTER_BOX: ["Pokémon Display"],
  ETB: ["Pokémon Elite Trainer Boxes"],
  TIN: ["Pokémon Tins"],
  COLLECTION_BOX: ["Pokémon Box Set"],
  BUNDLE: ["Pokémon Box Set", "Pokémon Display"],
  BLISTER: ["Pokémon Blisters", "Pokémon Booster"],
};

/** Städar en JP-produkttitel till CM-jämförbar form (era-/språk-/kodbrus bort). */
export function jpComparableTitle(title: string): string {
  return norm(
    title
      // språkmarkörer + parentes-/bindestrecksvarianter
      .replace(/\(?\b(japansk\w*|japanese|jpn?)\b\)?/gi, " ")
      // set-koder: sv2D, s12a, sm10b, m1L, sv4A … (även inom parentes/efter streck)
      .replace(/[([-]?\s*\b(?:sv|swsh|sm|xy|bw|s|m)\d{1,2}[a-z]{0,2}\b\s*[)\]]?/gi, " ")
      // era-prefix — CM:s JP-namn bär dem inte ("Clay Burst Booster Box")
      .replace(/\b(scarlet\s*(&|and|&amp;)?\s*violet|sword\s*(&|and|&amp;)?\s*shield|sun\s*(&|and|&amp;)?\s*moon)\b/gi, " ")
      // innehålls-/formbrus som CM inte använder i namnet
      .replace(/\(\d+\s*(cards?|kort|pack|boosters?)\)/gi, " ")
      .replace(/\bdisplay\s*\/\s*booster box\b/gi, "booster box")
      .replace(/\bhigh class pack\b/gi, " ")
      .replace(/&amp;/gi, "and")
  );
}

export interface JpRefreshResult {
  products: number;
  updated: number;
  mapped: number;
  unmatched: string[];
}

export async function runJapaneseSealedRefresh(): Promise<JpRefreshResult> {
  const res: JpRefreshResult = { products: 0, updated: 0, mapped: 0, unmatched: [] };
  const cm = await prisma.retailer.findFirst({ where: { name: "Cardmarket" } });
  if (!cm) return res;
  const jpProducts = await prisma.product.findMany({
    where: { language: "JP", category: { notIn: ["SINGLE_CARD", "GRADED_CARD", "ACCESSORY"] } },
    include: { offers: { select: { id: true, retailerId: true, url: true, price: true, stockStatus: true } } },
  });
  res.products = jpProducts.length;
  if (jpProducts.length === 0) return res;

  const [guideRes, nonSinglesRes] = await Promise.all([
    fetch(CM_PRICE_GUIDE_URL),
    fetch(CM_NONSINGLES_URL),
  ]);
  if (!guideRes.ok || !nonSinglesRes.ok) {
    console.error(`[cm-jp] prisguide/katalog HTTP ${guideRes.status}/${nonSinglesRes.status}`);
    return res;
  }
  const guide = (await guideRes.json()) as { priceGuides: CmGuideEntry[] };
  const catalog = (await nonSinglesRes.json()) as { products: CmNonSingle[] };
  const guideById = new Map(guide.priceGuides.map((e) => [e.idProduct, e]));

  // idProducts som redan ägs av en produkt (via CM-offer-URL) — en kandidat som
  // ägs av NÅGON ANNAN produkt är per definition fel match (vår EN-katalog är
  // komplett → alla internationella produkter är redan ägda → kvarvarande
  // oägda kandidater är i praktiken japanska/udda).
  const cmOffers = await prisma.offer.findMany({
    where: { retailerId: cm.id, url: { contains: "idProduct=" } },
    select: { productId: true, url: true },
  });
  const ownedBy = new Map<number, string>();
  for (const o of cmOffers) {
    const m = o.url?.match(/idProduct=(\d+)/);
    if (m) ownedBy.set(parseInt(m[1], 10), o.productId);
  }

  const rates = await getRatesOre();
  const cmSource = await prisma.scrapeSource.findFirst({ where: { name: "Cardmarket" }, select: { id: true } });
  const today = utcToday();

  type JpOp = { productId: string; offerId?: string; idProduct: number; priceOre: number; refOre?: number | null; stock: "IN_STOCK" | "OUT_OF_STOCK" };
  const ops: JpOp[] = [];
  // Nymappade produkter vars guide-rad är tom (presale utan CM-annonser) — de får
  // en LÄNK-OFFER utan pris så identiteten inte tappas. Se kommentaren i loopen.
  const linkOnly: { productId: string; idProduct: number }[] = [];

  for (const p of jpProducts) {
    const cmOffer = p.offers.find((o) => o.retailerId === cm.id);
    let idProduct: number | null = null;
    const idm = cmOffer?.url?.match(/idProduct=(\d+)/);
    if (idm) idProduct = parseInt(idm[1], 10);

    // Auto-mappning för JP-produkter utan CM-offer: namn-match mot CM-katalogen
    // (rätt CM-kategori, oägt idProduct) + LLM-dom som SISTA vakt. Utan
    // ANTHROPIC_API_KEY krävs nära-exakt namn (≥0.9) för att mappa.
    if (idProduct == null) {
      const ourClean = jpComparableTitle(p.title);
      const allowedCats = JP_CM_CATEGORIES[p.category] ?? null;
      const cands = catalog.products
        .filter(
          (c) =>
            (!allowedCats || allowedCats.includes(c.categoryName)) &&
            !/coin|lot|single/i.test(c.categoryName) &&
            (ownedBy.get(c.idProduct) === undefined || ownedBy.get(c.idProduct) === p.id)
        )
        .map((c) => ({ c, sim: scoreSimilarity(ourClean, norm(c.name)) }))
        .filter((x) => x.sim >= 0.5)
        .sort((a, b) => b.sim - a.sim)
        .slice(0, 3);
      for (const { c, sim } of cands) {
        // ⛔ LEDTRÅDEN MÅSTE SÄGA ATT B ALDRIG BÄR SPRÅKMARKÖR (mätt 2026-08-07).
        // Systemprompten i same-product.ts säger — helt riktigt i allmänhet — att
        // "japansk ≠ engelsk utgåva är ALLTID olika produkter". Men Cardmarket
        // skriver ALDRIG ut språket i namnet på en japansk expansion, medan VÅRA
        // butikstitlar alltid gör det ("(Japansk)"). Domaren läste därför den
        // saknade markören i B som en konkret motsägelse och svarade same=false på
        // VARJE korrekt par: "Storm Emeralda Booster Box" (sim 0.91),
        // "VMAX Climax Booster" (sim 1.00) och "Jet Black Spirit Booster Box" —
        // alla avvisade. Följden var att INGEN ny japansk SKU någonsin kunde
        // auto-mappas: fyra produkter satt utan pris och utan set, och Storm
        // Emeralda-setet fanns därför inte alls i katalogen.
        const verdict = await judgeSameProduct(
          p.title,
          c.name,
          [
            "B är Cardmarkets produktnamn för en JAPANSK expansion.",
            "⚠️ Cardmarket skriver ALDRIG ut språket i namnet på japanska set. Att B saknar 'Japanese'/'Japansk'",
            "är därför INGEN motsägelse och får ALDRIG ensamt ge same=false — A:s '(Japansk)' är butikens egen märkning.",
            "Identiteten ligger i SETNAMNET och produkttypen: setten det gäller (VMAX Climax, Storm Emeralda,",
            "Jet Black Spirit, Mega Brave …) gavs bara ut på japanska.",
            "⚠️ MEN en konkret motsägelse väger ALLTID tyngre än den här ledtråden. Svara same=false när",
            "produkttypen skiljer (pack ≠ box ≠ case ≠ collection box) ELLER när B är det INTERNATIONELLA",
            "setet med samma namn: '151' ensamt är den internationella utgåvan medan 'Pokémon Card 151' är den",
            "japanska, och heter B bara '151' ska svaret vara same=false även om A är japansk.",
            // ⚠️ Just 151-fallet klarar domaren INTE pålitligt (mätt: 8 av 9 kontrollfall rätt, det här
            // var missen). Skyddet i drift är strukturellt och sitter ovanför: `ownedBy` filtrerar bort
            // varje idProduct som redan ägs av en produkt, och vår engelska katalog är komplett — CM:s
            // internationella "151 Booster"/"151 Elite Trainer Box" ÄR alltså redan ägda av EN-produkter
            // och når aldrig fram som kandidater. Domaren är andra linjen, inte första.
          ].join(" ")
        );
        const accept = verdict ? verdict.same : sim >= 0.9;
        if (accept) {
          idProduct = c.idProduct;
          ownedBy.set(c.idProduct, p.id);
          res.mapped++;
          console.log(`[cm-jp] mappade "${p.title}" → ${c.idProduct} "${c.name}" (sim ${sim.toFixed(2)})`);
          // Identiteten är just avgjord → butiksfrasen byts mot CM:s katalognamn
          // (ägarbeslut 2026-08-09, se adopt-cm-name.ts).
          await adoptCmName(p.id, c.name);
          break;
        }
      }
      if (idProduct == null) {
        res.unmatched.push(p.title);
        continue;
      }
    }

    const g = guideById.get(idProduct);
    // Lägsta pris ("low") = det vi visar/spårar; utan aktuell annons → trend/avg
    // som ur-lager-referens (samma semantik som EN-sealed). sanePriceEur skyddar
    // mot glitchade micro-/jättepriser.
    const eur = g ? sanePriceEur(g.low, g.trend ?? g.avg) : null;
    if (g == null || eur == null) {
      // IDENTITETEN FÅR INTE TAPPAS FÖR ATT PRISET SAKNAS (2026-08-09): en
      // nymappad presale-produkt (30th Celebration JP Booster, 890359) hade en
      // guide-rad med enbart null → `continue` före offer-skrivningen → domen
      // glömdes och samma fråga ställdes om varje dygn, medan produkten stod
      // utan CM-länk, set-etikett och CM-namn. En länk-offer UTAN pris (price
      // null är per schema "länk-offer utan känt pris") bevarar identiteten:
      // jp-set-label når idExpansion via offer-URL:en, ownedBy ser ägarskapet
      // nästa körning, och priset kommer av sig självt när CM får annonser.
      // Inget pris fabriceras — produktsidan visar "–".
      if (!cmOffer) linkOnly.push({ productId: p.id, idProduct });
      continue;
    }
    const stock = g.low != null && eur === g.low ? "IN_STOCK" : "OUT_OF_STOCK";
    const refEur = cmGuideRefEur(g);
    const priceOre = priceOreFromEur(eur, rates);
    if (priceOre == null) continue; // 0 kr är inget pris — se priceOreFromEur
    ops.push({
      productId: p.id, offerId: cmOffer?.id, idProduct,
      priceOre,
      refOre: priceOreFromEur(refEur, rates),
      stock,
    });
  }

  const jp = await clampDayMoves(ops);
  if (jp.clamped) console.log(`[cm-jp] klämde ${jp.clamped} orimliga dagshopp till gårdagens värde.`);
  if (jp.healed) console.log(`[cm-jp] LÄKTE ${jp.healed} tidigare korrupta priser (stort hopp mot CM-trend).`);

  for (const op of ops) {
    const url = cardmarketJapaneseProductUrl(op.idProduct);
    if (op.offerId) {
      await prisma.offer.update({
        where: { id: op.offerId },
        data: { price: op.priceOre, url, stockStatus: op.stock, condition: "SEALED", language: "JP", lastSeenAt: new Date() },
      });
    } else {
      await prisma.offer.upsert({
        where: { productId_retailerId_condition_language: { productId: op.productId, retailerId: cm.id, condition: "SEALED", language: "JP" } },
        update: { price: op.priceOre, url, stockStatus: op.stock, lastSeenAt: new Date() },
        create: { productId: op.productId, retailerId: cm.id, condition: "SEALED", language: "JP", price: op.priceOre, currency: "SEK", stockStatus: op.stock, url },
      });
    }
    if (cmSource) {
      await prisma.priceObservation.create({
        data: { productId: op.productId, sourceId: cmSource.id, price: op.priceOre, currency: "SEK" },
      });
      await prisma.priceSnapshot.upsert({
        where: { productId_date: { productId: op.productId, date: today } },
        update: { minPrice: op.priceOre, maxPrice: op.priceOre, avgPrice: op.priceOre },
        create: { productId: op.productId, date: today, minPrice: op.priceOre, maxPrice: op.priceOre, avgPrice: op.priceOre, volume: 1 },
      });
    }
    res.updated++;
  }

  for (const op of linkOnly) {
    const url = cardmarketJapaneseProductUrl(op.idProduct);
    await prisma.offer.upsert({
      where: { productId_retailerId_condition_language: { productId: op.productId, retailerId: cm.id, condition: "SEALED", language: "JP" } },
      update: { url, lastSeenAt: new Date() },
      create: { productId: op.productId, retailerId: cm.id, condition: "SEALED", language: "JP", price: null, currency: "SEK", stockStatus: "UNKNOWN", url },
    });
  }
  if (linkOnly.length) console.log(`[cm-jp] ${linkOnly.length} länk-offers utan pris (tom guide-rad — presale).`);

  if (res.unmatched.length) {
    console.log(`[cm-jp] ${res.unmatched.length} JP-produkter utan CM-mappning: ${res.unmatched.slice(0, 10).join(" | ")}${res.unmatched.length > 10 ? " …" : ""}`);
  }
  console.log(`[cm-jp] ${res.updated}/${res.products} JP-produkter prisuppdaterade (${res.mapped} nymappade).`);

  // SET-ETIKETTEN SÄTTS HÄR, av samma skäl som för engelsk sealed: katalogen som
  // avgör identiteten (CM:s expansioner) ligger redan i minnet, så etiketten
  // kostar inte en enda extra hämtning — och en ny japansk förhandsbox syns i
  // set-filtret inom ett dygn i stället för aldrig.
  // ⛔ Ett fel här får inte sänka prisrefreshen: priserna är redan skrivna.
  try {
    await runJapaneseSetLabels(catalog.products);
  } catch (e) {
    console.error("[cm-jp] set-etikettering misslyckades:", e);
  }
  return res;
}

export async function runCardmarketRefresh(
  opts: { singles?: boolean; sealed?: boolean; throttleMs?: number } = {}
): Promise<CmRefreshResult> {
  const HOST = process.env.CARDMARKET_RAPIDAPI_HOST ?? "cardmarket-api-tcg.p.rapidapi.com";
  const KEY = process.env.CARDMARKET_RAPIDAPI_KEY ?? "";
  const throttle = opts.throttleMs ?? 220;
  const res: CmRefreshResult = { ran: false, singlesUpdated: 0, singlesCreated: 0, sealedUpdated: 0, historyPoints: 0, apiCalls: 0, remaining: Infinity };
  if (!KEY) {
    console.warn("[cm-refresh] CARDMARKET_RAPIDAPI_KEY saknas — hoppar över.");
    return res;
  }
  res.ran = true;

  const api = async <T>(url: string): Promise<T | null> => {
    for (let attempt = 0; attempt < 4; attempt++) {
      const r = await fetch(url, { headers: { "x-rapidapi-host": HOST, "x-rapidapi-key": KEY } });
      const rem = r.headers.get("x-ratelimit-requests-remaining");
      if (rem != null) res.remaining = parseInt(rem, 10);
      if (r.status === 429 || r.status >= 500) { await sleep(1000 * (attempt + 1)); continue; }
      if (!r.ok) { console.error(`[cm-refresh] ${r.status} ${url}`); return null; }
      res.apiCalls++;
      return (await r.json()) as T;
    }
    return null;
  };

  const rates = await getRatesOre();
  const cm = await prisma.retailer.findFirst({ where: { name: "Cardmarket" } });
  if (!cm) { console.warn("[cm-refresh] Cardmarket-retailer saknas."); return res; }

  if (opts.singles !== false) {
    const products = await prisma.product.findMany({
      // variantLabel:null = bas-common. Specialvarianter (GameStop-promo, reverse
      // m.m.) prissätts INTE av RapidAPI (saknar dem) utan av runVariantRefresh.
      // TRYCKNINGAR är undantaget: de kommer just UR RapidAPI:s `version`-fält och
      // prissätts här, en produkt per tryckning (se src/lib/print-variant.ts).
      where: {
        category: "SINGLE_CARD",
        OR: [{ variantLabel: null }, { variantLabel: { in: [...PRINT_VARIANT_LABELS] } }],
        card: { tcgExternalId: { not: null } },
      },
      select: {
        id: true,
        setId: true,
        variantLabel: true,
        card: { select: { tcgExternalId: true, number: true, name: true } },
        offers: { where: { retailerId: cm.id }, select: { id: true, url: true }, take: 1 },
      },
    });
    const map = new Map<string, { productId: string; offerId?: string; url?: string }>();
    // TRYCKNINGSKARTA: `tcgid|etikett` → produkten för PRECIS den tryckningen.
    // För uppdelade kort (Base) finns ingen omärkt basprodukt kvar, så `map` och
    // set+nummer-reserven är tomma för dem — varje feed-rad går i stället exakt
    // dit dess `version` säger. Ingen arbitrering behövs: raderna konkurrerar
    // inte längre om samma produkt.
    const printMap = new Map<string, { productId: string; offerId?: string; url?: string }>();
    // TRYCKNINGSRESERV: `setId|nummer|etikett`. KRÄVS — i Base bär bara
    // 1st Edition-raderna `tcgid`; Shadowless och Unlimited har `tcgid: null`
    // (och oftast `cardmarket_id: null`), så utan den här nyckeln nådde två av tre
    // tryckningar aldrig sin produkt. `null` = tvetydigt nummer, precis som byNumber.
    const byNumberPrint = new Map<
      string,
      { entry: { productId: string; offerId?: string; url?: string }; cardName: string } | null
    >();
    /** `idProduct|etikett` → produkt. Exakt: både id:t och tryckningen måste stämma. */
    const printByCmId = new Map<string, { productId: string; offerId?: string; url?: string }>();
    // SET+NUMMER-RESERVEN: (setId|nummernyckel) → produkt + vårt kortnamn. `null` =
    // TVETYDIG nyckel (samma nummer på flera kort i setet — Celebrations Classic
    // Collection har fyra kort med nummer 15) → reserven avstår hellre än gissar.
    const byNumber = new Map<string, { entry: { productId: string; offerId?: string; url?: string }; cardName: string } | null>();
    // GUIDE-RESERVENS KANDIDATER (se blocket "GUIDE-RESERV FÖR SINGLAR" nedan):
    // ordinarie singlar där VÅR EGEN länk bär ett idProduct, dvs där vi vet vilken
    // CM-produkt kortet är även om feeden slutat säga det.
    const guideFallbackCandidates = new Map<
      string,
      { entry: { productId: string; offerId?: string; url?: string }; idProduct: number; cardName: string }
    >();
    for (const p of products) {
      const entry = { productId: p.id, offerId: p.offers[0]?.id, url: p.offers[0]?.url };
      const ext = p.card?.tcgExternalId;
      if (isPrintVariantLabel(p.variantLabel)) {
        // ⛔ EN TRYCKNINGSPRODUKT UTAN EGEN CM-PRODUKT FÅR INTE PRISSÄTTAS AV CM.
        // Cardmarket har bara TVÅ produkter per kort i Base; i de nio andra
        // WOTC-seten har de EN, delad mellan tryckningarna (mätt: av 123 kort med
        // From på båda tryckningarna är 88 EXAKT identiska). Feeden publicerar
        // ändå en `version`-rad per tryckning där, så utan den här grinden hade
        // 1st Edition-produkterna vi skapar ur CardTrader fått ett CM-pris som i
        // praktiken är det ORDINARIE kortets golv — och det golvet är oftast
        // LÄGRE, så det hade vunnit rubriken. Samma sorts falska påstående som
        // reverse holo-buggen 2026-08-03, en tabell längre bort.
        //
        // Länken bevisar att vi vet VILKEN CM-produkt tryckningen är. Base sattes
        // vid uppdelningen och har den på alla 303 produkter (verifierat), så
        // grinden kostar ingenting där.
        const linkedIdProduct = entry.url?.match(/idProduct=(\d+)/)?.[1];
        if (!linkedIdProduct) continue;
        if (ext) printMap.set(`${ext}|${p.variantLabel}`, entry);
        // STARKASTE TRYCKNINGSNYCKELN: (CM-produkt, tryckning). idProduct kommer
        // ur offerns URL, som vi satte ur CM:s EGEN katalog vid uppdelningen — och
        // feed-raden bär samma id. Behövs för Base-holorna: deras Unlimited-rader
        // heter `card_number: "BS 4"` (inte "4") och saknar tcgid, så både
        // tcgid-kartan och nummerreserven missade dem. Charizards riktiga
        // Unlimited-From (340 €) nådde därför aldrig produkten, som blev kvar på
        // ett gammalt 1st Edition-pris (3 205 €).
        printByCmId.set(`${Number(linkedIdProduct)}|${p.variantLabel}`, entry);
        const pNumKey = cmNumberKey(p.card?.number);
        if (p.setId && pNumKey && p.card?.name) {
          const k = `${p.setId}|${pNumKey}|${p.variantLabel}`;
          byNumberPrint.set(k, byNumberPrint.has(k) ? null : { entry, cardName: p.card.name });
        }
        continue;
      }
      if (ext) map.set(ext, entry);
      const numKey = cmNumberKey(p.card?.number);
      if (p.setId && numKey && p.card?.name) {
        const key = `${p.setId}|${numKey}`;
        byNumber.set(key, byNumber.has(key) ? null : { entry, cardName: p.card.name });
      }
      // Kandidat för guide-reserven: bara ORDINARIE kort (tryckningarna hoppade
      // av ovan) och bara när vår länk pekar ut CM-produkten.
      const linkedId = Number(entry.url?.match(/idProduct=(\d+)/)?.[1] ?? NaN);
      if (Number.isFinite(linkedId) && p.card?.name)
        guideFallbackCandidates.set(p.id, { entry, idProduct: linkedId, cardName: p.card.name });
    }
    // Episodnamn → vårt setId. Bara ENTYDIGA namn åt båda håll får användas.
    // ⛔ Bara ENGELSKA set: episoderna kommer från RapidAPI:s västerländska
    // katalog, och japanska set delar latinska namn med sina engelska motsvarigheter
    // ("Black Bolt", "151"). Utan grinden hade ett japanskt set kunnat vinna
    // uppslaget och prissatt engelska kort.
    const setsByName = new Map<string, string | null>();
    for (const s of await prisma.cardSet.findMany({ where: { language: "EN" }, select: { id: true, name: true } })) {
      const key = cmSetNameKey(s.name);
      if (key) setsByName.set(key, setsByName.has(key) ? null : s.id);
    }

    // Promo-/specialset utan pokemontcg.io-tcgid (t.ex. MEP Black Star Promos) →
    // matchas på cardmarket_id istället.
    // ⛔ VÄRDET BÄR KORTNAMNET — nyckeln ensam duger inte, se namnvakten i processCards.
    const cmidMap = new Map<
      number,
      { productId: string; offerId?: string; url?: string; cardName: string }
    >();
    // NUMMERRESERV FÖR JUST DE HÄR KORTEN (2026-08-05). Egen karta, aldrig `byNumber`:
    // nyckeln skalar av setkoden ("MEP 023" → "23") och den toleransen får INTE nå
    // huvudkatalogen, där ett prefix ofta ÄR numret ("TG10", "GG08"). Se
    // cmNumberKeyNoSetCode. `null` = tvetydigt nummer i setet ⇒ reserven avstår.
    const byNumberNoTcg = new Map<
      string,
      { entry: { productId: string; offerId?: string; url?: string }; cardName: string } | null
    >();
    const cmidProducts = await prisma.product.findMany({
      where: { category: "SINGLE_CARD", card: { cardmarketId: { not: null }, tcgExternalId: null } },
      select: { id: true, setId: true, variantLabel: true, card: { select: { cardmarketId: true, name: true, number: true } }, offers: { where: { retailerId: cm.id }, select: { id: true, url: true }, take: 1 } },
    });
    for (const p of cmidProducts) {
      const id = p.card?.cardmarketId;
      if (id == null) continue;
      const entry = { productId: p.id, offerId: p.offers[0]?.id, url: p.offers[0]?.url };
      if (p.card?.name) cmidMap.set(id, { ...entry, cardName: p.card.name });
      // ⛔ DE HÄR KORTEN MÅSTE OCKSÅ VARA KANDIDATER FÖR GUIDE-RESERVEN. De ligger i
      // en EGEN fråga (de saknar tcgid), så den stora produktloopen ovan ser dem
      // aldrig — och just de är extra utsatta: hela deras identitet HÄNGER på
      // `cardmarket_id`, så när feeden tappar fältet finns ingen annan nyckel alls.
      // Ägarens eget exempel 2026-08-05 var ett sådant kort (Mega Charizard X ex ·
      // MEP 023): CM-länk och allt på plats, ändå fruset sedan 12 juli.
      // idProduct tas ur VÅR länk först — det är den vi själva satt — och först
      // därefter ur kortets lagrade cardmarketId. Namnvakten dömer ändå identiteten.
      const linkedId = Number(entry.url?.match(/idProduct=(\d+)/)?.[1] ?? NaN);
      const guideId = Number.isFinite(linkedId) ? linkedId : id;
      if (!isPrintVariantLabel(p.variantLabel) && p.card?.name)
        guideFallbackCandidates.set(p.id, { entry, idProduct: guideId, cardName: p.card.name });
      // ⛔ OCH DE MÅSTE HA EN VÄG SOM INTE GÅR VIA `cardmarket_id`. Fältet är MÄTT
      //    trasigt i just den här episoden: 13 av 139 MEP-rader bär null, ett id som
      //    inte finns i CM:s singelkatalog, eller ett id som pekar på ett HELT annat
      //    kort — MEP 023 "Mega Charizard X ex" bär 873704, som hos CM heter
      //    "N's Zekrom". Fyra av våra 84 MEP-kort nåddes därför aldrig av feeden, och
      //    eftersom de saknar tcgid fanns ingen reserv alls: de föll ur körningen,
      //    behöll gårdagens tal och plockades till slut upp av guide-reserven, som
      //    märker dem OUT_OF_STOCK ("Sold out" i pristabellen) med en UPPSKATTNING —
      //    59,09 € där feedens egna, korrekta From sa 38,00 €.
      //    Radens PRIS var alltså rätt hela tiden; bara dess `cardmarket_id` var fel.
      const numKeyNoCode = cmNumberKeyNoSetCode(p.card?.number);
      if (!isPrintVariantLabel(p.variantLabel) && p.setId && numKeyNoCode && p.card?.name) {
        const k = `${p.setId}|${numKeyNoCode}`;
        byNumberNoTcg.set(k, byNumberNoTcg.has(k) ? null : { entry, cardName: p.card.name });
      }
    }

    const eps: { id: number; name?: string | null; cards_total: number }[] = [];
    let page = 1, total = 1;
    do {
      const d = await api<{ data: typeof eps; paging: { total: number } }>(`https://${HOST}/pokemon/episodes?page=${page}`);
      if (!d) break;
      total = d.paging.total;
      eps.push(...d.data);
      await sleep(throttle);
    } while (page++ < total);

    // CM_LIMIT_EPISODES > 0 → bara N första set (för lokal testning, sparar kvot).
    const limitEps = parseInt(process.env.CM_LIMIT_EPISODES ?? "0", 10);
    // CM_ONLY_EPISODES=415,399 → bara dessa episod-id (kvotsnål riktad omkörning
    // efter en fix; CI sätter den aldrig).
    const onlyEps = new Set(
      (process.env.CM_ONLY_EPISODES ?? "").split(",").map((s) => parseInt(s.trim(), 10)).filter((n) => n > 0)
    );
    const chosen = onlyEps.size > 0 ? eps.filter((e) => onlyEps.has(e.id)) : eps;
    const wanted = limitEps > 0 ? chosen.slice(0, limitEps) : chosen;
    // CM:s officiella prisguide = trend/30d-fallback när From saknas (RapidAPI-
    // singlar saknar trend-fält; guiden har alltid trend/avg).
    const [guide, cmNames] = await Promise.all([fetchCmGuide(), fetchCmSingleNames()]);
    let misIdentified = 0, notASingle = 0;
    // GOLVET RAKT AV (ägarbeslut 2026-07-24, se singlesHeadlineEur): From publiceras
    // EXAKT som CM listar den — ingen trend-substitution, ingen per-kort-dagklämma.
    // `from=false` ⇒ värdet är en trend/30d-UPPSKATTNING (ingen köpbar annons) ⇒
    // offern märks OUT_OF_STOCK, samma semantik som sealed/JP.
    // ── EN PRODUKT FÅR PRISSÄTTAS AV EXAKT EN FEED-RAD (2026-07-27) ───────────
    // Vintage-episoder innehåller FLERA TRYCKNINGAR av samma kortnummer, och
    // promo-episoder flera CM-produkter av samma kort. Mätt i Base (episod 171):
    // Ponyta 60 har tre rader — "1st Edition Shadowless" (tcgid=base1-60,
    // From 26,50 €), "Shadowless" (tcgid=null, SAMMA cardmarket_id, From 4,29 €)
    // och "Unlimited" (utan pris). Den första matchade på tcgid, den andra på
    // SET+NUMMER-reserven → BÅDA skrev pris och historikpunkt på samma produkt
    // samma dygn. Vilken som vann avgjordes av vilken DB-skrivning som råkade
    // landa sist (mapPool), och grafens "sista punkt per dygn" av vilken rad som
    // råkade komma sist i svaret: 305 singlar hade i praktiken TÄRNINGSKASTAT
    // pris 2026-07-27 (Ponyta 292,56 kr ELLER 47,36 kr).
    // Det här är inte ett nytt fel i reserven utan ett fel som blev SYNLIGT när
    // sidantalet började läsas ur `paging.total` (a292708) — dessförinnan låg de
    // extra tryckningarna utanför de hämtade sidorna.
    // Regeln: samla kandidater per produkt och prissätt med den STARKASTE nyckeln
    // (tcgid > cardmarket_id > set+nummer). Ordningen är densamma som identitets-
    // kedjan i CLAUDE.md, och den ger tillbaka exakt det pris katalogen hade före
    // paginerings-fixen. VILKEN tryckning katalogen BÖR visa är en egen, känd
    // fråga (pinna tryckvariant) — den här vakten avgör den inte, den ser bara
    // till att svaret inte är slumpmässigt.
    type SingleCandidate = {
      rank: number;
      cmid: number | null;
      print: number;
      // MÅSTE ligga på kandidaten, inte bara i `op`. Låg den bara i `op` läste
      // feedRowWins `current.from` som undefined ⇒ "saknar äkta From" ⇒ en
      // Unlimited-rad med bara ett 30d-snitt vann över 1st Edition-radens riktiga
      // From. Sabrina's Gaze · Gym Heroes 125 skrevs 0,55 € → 434,04 € på exakt
      // det sättet innan fältet fanns här.
      from: boolean;
      op: { productId: string; offerId?: string; priceOre: number; from: boolean; url: string };
      via?: string;
    };
    const claimed = new Map<string, SingleCandidate>();
    let rowsRejectedAsDuplicate = 0, printVariantSwaps = 0, printVariantRouted = 0;
    // Kort CM har men inte prissätter → länk utan pris (se nedan). Hålls UTANFÖR
    // singleOps: de ska inte räknas av haveribrytaren och inte skriva historikpunkter.
    const linkOnlyByProduct = new Map<string, string>();
    let byNumberHits = 0, byNumberNameRejects = 0;
    // Rader vars `cardmarket_id` pekade på en produkt med ett ANNAT kortnamn. Loggas
    // för att en tyst uppgång ska synas: växer talet har leverantören tappat fler
    // id:n, och då är det nummerreserven som bär korten.
    let cmidNameRejects = 0;
    const processCards = (cards: CmCard[]) => {
      for (const card of cards) {
        // TRYCKNINGEN FÖRST: säger raden vilken tryckning den gäller, och har vi
        // en produkt för exakt den tryckningen, är det den produkten — punkt.
        // Ingen annan nyckel får peka om den (`tcgid` är ju gemensam för alla tre).
        const printLabel = printLabelFromVersion(card.version);
        let printEntry =
          printLabel && card.tcgid ? printMap.get(`${card.tcgid}|${printLabel}`) : undefined;
        // (CM-produkt, tryckning) — starkast av tryckningsnycklarna: båda sidor
        // pekar på samma idProduct ur CM:s katalog.
        if (!printEntry && printLabel && card.cardmarket_id != null)
          printEntry = printByCmId.get(`${card.cardmarket_id}|${printLabel}`);
        // I Base bär BARA 1st Edition-raden `tcgid` — Shadowless och Unlimited har
        // null. Deras väg till rätt produkt går via set+nummer+etikett.
        if (!printEntry && printLabel) {
          const setId = setsByName.get(cmSetNameKey(card.episode?.name));
          const numKey = cmNumberKey(card.card_number);
          const cand = setId && numKey ? byNumberPrint.get(`${setId}|${numKey}|${printLabel}`) : undefined;
          if (cand && cmCardNameAgrees(cand.cardName, card.name)) printEntry = cand.entry;
        }
        // ── `cardmarket_id` FÅR INTE VÄLJA PRODUKT UTAN ATT NAMNEN HÅLLER MED ────
        // Guide-raden har haft namnvakt sedan 2026-07-26 (guideNameMatches), men
        // SJÄLVA MATCHNINGEN har aldrig haft en — och det är samma opålitliga fält.
        // MÄTT 2026-08-05 i MEP: raden "Mega Charizard X ex" (MEP 023) bär
        // `cardmarket_id` 873704, som hos Cardmarket är en N's Zekrom — och som VI
        // också har, korrekt länkad. Charizard-raden matchade alltså vår Zekrom och
        // skrev Charizards From (38,00 € = 416,48 kr) på den, medan Zekroms EGEN rad
        // (60,07 €) förlorade arbitreringen. Charizard blev samtidigt hemlös, föll
        // till guide-reserven och visades som "Sold out" med en uppskattning.
        // EN FELMATCHNING SKADAR ALLTID TVÅ KORT: ett får fel pris, ett får inget.
        // Vakten är den vanliga: vid oenighet prissätts INGET, och raden får söka
        // sig fram via nummerreserven nedan i stället.
        // Blast-radien är exakt de tcgid-lösa korten — cmidMap byggs bara av dem.
        let cmidEntry = card.cardmarket_id != null ? cmidMap.get(card.cardmarket_id) : undefined;
        if (cmidEntry && !cmCardNameAgrees(cmidEntry.cardName, card.name)) {
          cmidNameRejects++;
          cmidEntry = undefined;
        }
        let entry =
          printEntry ??
          (card.tcgid ? map.get(card.tcgid) : undefined) ??
          cmidEntry;
        let rank = printEntry
          ? MATCH_RANK.tcgid
          : entry ? (card.tcgid && map.get(card.tcgid) ? MATCH_RANK.tcgid : MATCH_RANK.cmid) : 0;
        if (printEntry) printVariantRouted++;
        // SET+NUMMER-RESERVEN — bara för rader ingen nyckel hittade. Kräver
        // entydigt setnamn, entydigt nummer i setet OCH att kortnamnen är samma;
        // vid minsta tvekan tas ingen match (ett felmatchat nummer prissätter
        // annars ett annat kort i samma set).
        // Reserven körs även för tryckningsrader: de ICKE-uppdelade WOTC-seten
        // (Jungle/Fossil/Gym/Neo) har en enda produkt per kort, och deras
        // Unlimited-rader hittar den BARA via set+nummer. Uppdelade kort har
        // ingen omärkt produkt alls, så de kan inte fångas här av misstag.
        if (!entry) {
          const setId = setsByName.get(cmSetNameKey(card.episode?.name));
          const numKey = cmNumberKey(card.card_number);
          const cand = setId && numKey ? byNumber.get(`${setId}|${numKey}`) : undefined;
          if (cand) {
            if (cmCardNameAgrees(cand.cardName, card.name)) {
              entry = cand.entry;
              rank = MATCH_RANK.number;
              // Nyckeln konsumeras INTE längre (den gjorde det 2026-07-27→07-28).
              // Den regeln skulle hindra två rader från att prissätta samma produkt,
              // men det jobbet gör `feedRowWins` numera — och konsumtionen hade en
              // baksida: i Base svarar tryckningarna i block (1st Edition →
              // Shadowless → Unlimited), så Shadowless-raden åt upp nyckeln och
              // UNLIMITED-raden — den tryckning katalogen faktiskt håller — föll bort
              // innan den fick tävla. Flera rader mot samma produkt är ofarligt när
              // exakt en av dem kan vinna.
              byNumberHits++;
            } else {
              byNumberNameRejects++;
            }
          }
        }
        // SISTA UTVÄGEN: korten UTAN pokemontcg.io-id (promo-seten). Egen karta med
        // setkods-tolerant nummernyckel — se byNumberNoTcg. Ligger EFTER `byNumber`
        // så huvudkatalogen alltid får svara först, och bär samma namnvakt: numret
        // ensamt är inte identitet.
        let viaNoTcgNumber = false;
        if (!entry) {
          const setId = setsByName.get(cmSetNameKey(card.episode?.name));
          const numKey = cmNumberKeyNoSetCode(card.card_number);
          const cand = setId && numKey ? byNumberNoTcg.get(`${setId}|${numKey}`) : undefined;
          if (cand) {
            if (cmCardNameAgrees(cand.cardName, card.name)) {
              entry = cand.entry;
              rank = MATCH_RANK.number;
              viaNoTcgNumber = true;
              byNumberHits++;
            } else {
              byNumberNameRejects++;
            }
          }
        }
        if (!entry) continue;
        const cmp = card.prices?.cardmarket ?? {};
        // Identitetsvakt, TVÅ frågor: är raden ens en singel (guideRowIsSingle — ett
        // cardmarket_id som pekar på en SEALED-produkt smög förbi namnvakten och
        // publicerade boosterlådans golv som kortets pris), och är det i så fall VÅRT
        // kort (guideNameMatches)?
        // ── VILKEN CM-PRODUKT SKA GUIDE-RADEN KOMMA IFRÅN? ────────────────────
        // För en TRYCKNINGSPRODUKT är feed-radens `cardmarket_id` fel källa: det är
        // SAMMA id för Shadowless och 1st Edition, och saknas helt på de flesta
        // Unlimited-rader. Offerns URL bär däremot det id vi själva satte ur CM:s
        // egen katalog vid uppdelningen (split-base-printings.ts) — det är det
        // enda stället som vet vilken CM-produkt just den här tryckningen är.
        //
        // SAMMA SAK GÄLLER NUMMERRESERVEN FÖR TCGID-LÖSA KORT: den vägen togs just
        // FÖR ATT radens `cardmarket_id` inte ledde någonstans, så att sedan slå upp
        // guide-raden på det id:t är att fråga fältet vi nyss underkände. Mätt på
        // MEP 023: id:t pekar på "N's Zekrom", vars guide-rad namnvakten (rätteligen)
        // kastar — men då tappas också den FALLBACK som ska bära kortet när From
        // saknas. Vår egen länk vet vilken CM-produkt kortet är; identitetsvakterna
        // nedan dömer den ändå.
        const linkedCmId = printEntry || viaNoTcgNumber
          ? Number(entry.url?.match(/idProduct=(\d+)/)?.[1] ?? NaN)
          : NaN;
        const guideId = Number.isFinite(linkedCmId) ? linkedCmId : card.cardmarket_id;
        // Identitetsvakt, TVÅ frågor: är raden ens en singel (guideRowIsSingle — ett
        // cardmarket_id som pekar på en SEALED-produkt smög förbi namnvakten och
        // publicerade boosterlådans golv som kortets pris), och är det i så fall VÅRT
        // kort (guideNameMatches)?
        let g = guideId != null ? guide.get(guideId) : undefined;
        if (g && !guideRowIsSingle(guideId, cmNames)) {
          g = undefined;
          notASingle++;
        } else if (g && guideId != null && !guideNameMatches(cmNames.get(guideId), card.name)) {
          g = undefined;
          misIdentified++;
        }
        const priced = singlesHeadlineEur({ from: cmp.lowest_near_mint, avg30: cmp["30d_average"] }, g);
        // ── BARA UNLIMITED FÅR UPPSKATTAS ─────────────────────────────────────
        // Shadowless och 1st Edition DELAR CM-produkt (1st Edition är en flagga på
        // annonsen där, inte en egen produkt), så deras guide-rad är densamma. En
        // uppskattning hade alltså gett båda SAMMA värde — fel för åtminstone den
        // ena, och skillnaden är stor (Ponyta 4,29 € mot 26,50 €). Saknar de ett
        // äkta From får de inget pris: produkten göms ur katalogen tills CM har en
        // annons. Unlimited har en EGEN CM-produkt och får därför uppskattas som
        // vanligt — annars hade ~2/3 av Base försvunnit ur katalogen vid
        // uppdelningen (lowestPriceOre = null göms av buildProductWhere).
        if (printEntry && printLabel !== PRINT_UNLIMITED && priced && !priced.from) continue;
        // TRYCKNINGSPRODUKTER LÄNKAS ALDRIG AV FEEDEN: `card.cardmarket_id` är MÄTT
        // opålitligt som länk (38 av 147 Base-rader pekar på fel CM-produkt — 1st
        // Edition-raderna bär oftast den ORDINARIE produktens id, och Blastoise
        // bär en Rayquaza). Länken vi satte ur CM:s egen katalog vid uppdelningen
        // är enda källan; saknas den får produkten hellre ingen uppdatering.
        const baseUrl = printEntry
          ? (entry.url && isEnglishCardmarketUrl(entry.url) ? withNearMint(entry.url) : entry.url ?? null)
          : entry.url && isEnglishCardmarketUrl(entry.url) ? withNearMint(entry.url)
            : card.cardmarket_id != null ? cardmarketProductUrl(card.cardmarket_id, { nearMint: true, firstEd: "exclude" })
              : entry.url ?? null;
        // TRYCKNINGSFILTRET STYRS AV PRODUKTEN, ALDRIG AV FEED-RADEN. Villkoret
        // stod först på `printLabel` ensam — alltså på radens `version` — och då
        // räckte det att en 1st Edition-rad prissatte en produkt som INTE är en
        // 1st Edition-produkt för att länken skulle få filtret. Det hände direkt:
        // Pikachu 58 (odelad, ingen etikett) fick isFirstEd=Y, och samma sak hade
        // väntat de ~730 vintage-kort som fortfarande prissätts av 1st Edition-
        // raden. `printEntry` är satt bara när raden matchade produkten för PRECIS
        // sin tryckning, så den frågan är den rätta.
        //
        // Alla andra singlar får isFirstEd=N — uttryckligen, aldrig utelämnat:
        // CM minns filtret i sessionen och stämplar tillbaka det på nästa kort man
        // öppnar (se withFirstEd). Utan det visade Alakazam Unlimited 1st Edition-
        // annonser för den som nyss klickat på en 1st Edition-länk.
        const wantFirstEd: FirstEdFilter =
          printEntry && printLabel === PRINT_FIRST_EDITION ? "only" : "exclude";
        const url = baseUrl ? withFirstEd(baseUrl, wantFirstEd) : baseUrl;
        if (!url) continue;
        if (priced == null) {
          // CM HAR kortet men INGET pris (varken From, guide-rad eller 30d-snitt) —
          // EX Trainer Kits, McDonald's-promos, S&V Energies: 105 singlar där matchningen
          // är perfekt och marknaden bara är tom. De fick tidigare ingen offer alls och
          // därmed ingen LÄNK till Cardmarket, vilket läste som "vi hittade inte kortet".
          // Länk-offer utan pris är en befintlig, stödd form (isDirectOfferUrl godkänner
          // den, produktsidan visar "–", recomputeProductPriceCache räknar bara price > 0).
          //
          // BARA när ingen CM-offer finns. Att nolla ett BEFINTLIGT pris för att dagens
          // feed är tom vore precis den sortens tysta skada som ett hicka i feeden inte
          // ska kunna göra permanent — och den kunde träffa hela katalogen på en gång.
          if (!entry.offerId) linkOnlyByProduct.set(entry.productId, url);
          continue;
        }
        const priceOre = priceOreFromEur(priced.eur, rates);
        if (priceOre == null) continue; // 0 kr är inget pris — se priceOreFromEur
        const cmid = card.cardmarket_id ?? null;
        const print = printRank(card.version);
        const current = claimed.get(entry.productId);
        if (!feedRowWins(current, { rank, cmid, print, from: priced.from })) {
          rowsRejectedAsDuplicate++;
          continue;
        }
        if (current) {
          rowsRejectedAsDuplicate++;
          if (print > current.print) printVariantSwaps++;
        }
        claimed.set(entry.productId, {
          rank,
          cmid,
          print,
          from: priced.from,
          via: priced.via,
          op: { productId: entry.productId, offerId: entry.offerId, priceOre, from: priced.from, url },
        });
      }
    };

    // ── SIDANTALET KOMMER UR SVARET, ALDRIG UR METADATAN ──────────────────────
    // `cards_total` i episodlistan ljuger i BÅDA riktningar, och båda gör kort
    // osynliga utan ett ljud:
    //   Pitch Black (415) / MEP (412):  säger 0    → hela setet hämtades aldrig
    //   Crown Zenith:  säger 160 (8 sidor), har 12 → Galarian Gallery (70 kort) utanför
    //   Shining Fates: säger  73 (4 sidor), har 10 → Shiny Vault (~120 kort) utanför
    //   Lost Origin:   säger 217 (11 sidor), har 13 → Trainer Gallery utanför
    // Mätt 2026-07-26: 662 singlar tappade dagens prisuppdatering på exakt det sättet,
    // och de sitter i de mest efterfrågade underserierna. Den gamla lappen ("hämta 412
    // sida 1–6") kunde bara täcka noll-fallet, och missade dessutom sidan 7.
    //
    // `paging.total` på sida 1 är auktoritativ. Sida 1 måste hämtas ändå, så det här
    // kostar ingen extra kvot — det byter bara källa för sidantalet. Fas 1a hämtar
    // sida 1 av varje episod (och bearbetar den), 1b hämtar resten.
    const restPages: { epId: number; pg: number }[] = [];
    let metaMismatch = 0;
    await mapPool(wanted, API_CONCURRENCY, async (ep) => {
      const d = await api<{ data: CmCard[]; paging?: { total?: number } }>(
        `https://${HOST}/pokemon/episodes/${ep.id}/cards?page=1`
      );
      await sleep(throttle * API_CONCURRENCY);
      if (!d?.data?.length) return;
      processCards(d.data);
      const pages = Math.max(1, d.paging?.total ?? 1);
      const claimed = Math.max(1, Math.ceil((ep.cards_total ?? 0) / 20));
      if (pages !== claimed) {
        metaMismatch++;
        console.log(
          `[cm-refresh] episode ${ep.id} "${ep.name ?? "?"}": cards_total=${ep.cards_total} ` +
          `⇒ ${claimed} sidor, men paging.total=${pages}. Följer svaret.`
        );
      }
      for (let pg = 2; pg <= pages; pg++) restPages.push({ epId: ep.id, pg });
    });
    await mapPool(restPages, API_CONCURRENCY, async ({ epId, pg }) => {
      const d = await api<{ data: CmCard[] }>(`https://${HOST}/pokemon/episodes/${epId}/cards?page=${pg}`);
      await sleep(throttle * API_CONCURRENCY);
      if (d?.data?.length) processCards(d.data);
    });
    if (metaMismatch)
      console.log(`[cm-refresh] ${metaMismatch} episoder där cards_total inte stämde med paging.total.`);

    // Kandidaterna är valda — nu först finns listan över vad som ska skrivas. En
    // produkt förekommer exakt en gång (se `claimed`), så haveribrytaren mäter
    // dagsrörelser mot ETT nytt pris per kort och historiken får en punkt per kort.
    const singleOps = [...claimed.values()].map((c) => c.op);
    // Varifrån headline-priset kom (from / estimate). Ska loggas varje körning: växer
    // `estimate` plötsligt är det feeden som tappat `lowest_near_mint`, inte marknaden.
    // Räknas på de VALDA raderna — annars räknades även rader som aldrig skrevs.
    const viaCounts: Record<string, number> = {};
    for (const c of claimed.values()) if (c.via) viaCounts[c.via] = (viaCounts[c.via] ?? 0) + 1;
    // Länk-offer bara för kort som inte fick något pris alls av någon rad.
    const linkOnlyOps = [...linkOnlyByProduct.entries()]
      .filter(([productId]) => !claimed.has(productId))
      .map(([productId, url]) => ({ productId, url }));
    if (rowsRejectedAsDuplicate > 0)
      console.log(
        `[cm-refresh] Tryckningsvakt: ${rowsRejectedAsDuplicate} feed-rader pekade på en produkt ` +
        `som en starkare nyckel redan prissatt (flera tryckningar/CM-produkter av samma kort) ` +
        `→ ignorerade. Utan den avgjorde svarsordningen priset.`
      );
    if (printVariantRouted > 0)
      console.log(
        `[cm-refresh] Tryckningar: ${printVariantRouted} feed-rader gick till en produkt för PRECIS ` +
        `sin tryckning (Unlimited/Shadowless/1st Edition som egna katalogposter).`
      );
    if (printVariantSwaps > 0)
      console.log(
        `[cm-refresh] Tryckningsval: ${printVariantSwaps} kort prissattes av den ORDINARIE ` +
        `tryckningen i stället för 1st Edition-raden (som bär tcgid i WOTC-episoderna).`
      );

    // Haveribrytare FÖRE skrivning: en stor andel EXTREMA dagsrörelser samtidigt =
    // trasig feed (2026-07-05: 2 104 korrupta priser), inte en marknad. Enstaka
    // vilda hopp är asks-verklighet och släpps igenom — det är ANDELEN som dömer.
    const prior = await priorSnapshotMap(singleOps.map((o) => o.productId));
    const moves = feedMoveShares(singleOps.map((o) => ({ newOre: o.priceOre, priorOre: prior.get(o.productId) })));
    console.log(
      `[cm-refresh] Singlar: dagsrörelser ≥${DAY_MOVE_MAX}x: ${(moves.bigShare * 100).toFixed(1)}% (${moves.big}), ` +
      `≥${FEED_BREAKER_MULT}x: ${(moves.extremeShare * 100).toFixed(1)}% (${moves.extreme}) av ${moves.n} med gårdagsvärde.`
    );
    if (moves.extremeShare > FEED_BREAKER_SHARE) {
      throw new Error(
        `[cm-refresh] FEED-HAVERIBRYTARE: ${(moves.extremeShare * 100).toFixed(1)}% av singlarna ` +
        `(${moves.extreme}/${moves.n}) hoppade ≥${FEED_BREAKER_MULT}x på ett dygn (tröskel ` +
        `${FEED_BREAKER_SHARE * 100}%). Det är signaturen för korrupt RapidAPI-feed (2026-07-05: ` +
        `2 104 priser) — INGET skrivs. Är rörelserna äkta: höj CM_FEED_BREAKER_SHARE och kör om.`
      );
    }
    // ── GUIDE-RESERV FÖR SINGLAR (2026-08-05) ────────────────────────────────
    // Vår prisleverantör slutar ibland leverera Cardmarket-koppling för enskilda
    // kort: `cardmarket_id: null` och `prices.cardmarket: {}` i episod-feeden.
    // Verifierat 2026-08-05 på xy9-10 (Growlithe · BREAKpoint), sm8-88, smp-SM191,
    // sm11-10 — vanliga kort, inget som saknas hos CM. Koden gjorde då rätt PER RAD
    // (den vägrar hitta på ett pris) men fel i TILLSTÅNDET: kortet föll ur körningen
    // helt, offern rördes inte, ingen historikpunkt skrevs — och gårdagens pris stod
    // kvar under rubriken "Lägsta pris · NM engelska (Cardmarket)" som om det vore
    // dagens. 108 singlar hade frusit så, de äldsta sedan 2026-06-13.
    //
    // Grafen ser ut att sluta 2026-07-25 för de flesta. Det datumet är ett
    // ENGÅNGS-BACKFILL som skrev en CM-punkt för 20 153 singlar med deras BEFINTLIGA
    // offer-pris — alltså ett falskt livstecken, inte den sista riktiga mätningen.
    //
    // Reserven är en spegling av EN-guide-fallbacken för sealed, med samma hårda
    // vakt: prissätt BARA mot ett idProduct som VÅR EGEN länk pekar ut, och bara när
    // CM:s egen singelkatalog bekräftar att raden är det kort vi tror. Det är alltså
    // ingen ny prispolicy — värdet går genom samma `singlesHeadlineEur` som resten,
    // och utan From blir det en UPPSKATTNING (`from: false` ⇒ OUT_OF_STOCK ⇒
    // rubriken byter till "Uppskattat värde · ingen aktiv annons").
    //
    // ⛔ TRYCKNINGAR ÄR UNDANTAGNA — de hoppade av redan i produktloopen. Shadowless
    //    och 1st Edition delar CM-produkt, så en guide-rad hade gett båda SAMMA
    //    värde. Samma regel som gäller överallt annars i den här filen.
    // ⛔ LIGGER EFTER HAVERIBRYTAREN med flit: de här priserna kommer inte från
    //    RapidAPI, så de får varken arma brytaren eller spä ut dess nämnare.
    // ⛔ TOM KATALOG = INGEN RESERV. Faller CM:s CDN kan identiteten inte styrkas,
    //    och då är ett fruset dygn rätt svar (samma hållning som guideRowIsSingle).
    // ⛔ ALDRIG PÅ EN DELKÖRNING. Reserven definieras av "feeden prissatte INTE
    //    kortet i den här körningen" — och i en riktad omkörning (CM_ONLY_EPISODES)
    //    är det sant om nästan hela katalogen. Utan den här raden hade en kvotsnål
    //    omkörning av ETT set bytt ut ~20 000 äkta From-priser mot guide-
    //    uppskattningar. Samma skäl som täckningsvakten hoppas över, fast farligare:
    //    vakten hade bara larmat, det här SKRIVER.
    const partialSinglesRun =
      (process.env.CM_ONLY_EPISODES ?? "").trim() !== "" ||
      parseInt(process.env.CM_LIMIT_EPISODES ?? "0", 10) > 0;
    const guideOnlyOps: typeof singleOps = [];
    let guideOnlyNameRejects = 0, guideOnlyNotSingle = 0;
    if (partialSinglesRun) {
      console.log(
        `[cm-refresh] Guide-reserven hoppas över: delkörning (CM_ONLY_EPISODES/CM_LIMIT_EPISODES). ` +
        `"Feeden prissatte inte kortet" betyder inget när bara några set hämtats.`
      );
    } else if (cmNames.size > 0) {
      for (const [productId, cand] of guideFallbackCandidates) {
        if (claimed.has(productId)) continue; // feeden prissatte kortet — rör det inte
        const verdict = guideReserveEur(cand, guide.get(cand.idProduct), cmNames);
        if ("reject" in verdict) {
          if (verdict.reject === "not-single") guideOnlyNotSingle++;
          if (verdict.reject === "name") guideOnlyNameRejects++;
          continue;
        }
        const url = cand.entry.url;
        if (!url) continue;
        const reserveOre = priceOreFromEur(verdict.eur, rates);
        if (reserveOre == null) continue; // 0 kr är inget pris — se priceOreFromEur
        guideOnlyOps.push({
          productId,
          offerId: cand.entry.offerId,
          priceOre: reserveOre,
          from: false,
          url: isEnglishCardmarketUrl(url) ? withFirstEd(withNearMint(url), "exclude") : url,
        });
      }
    }
    // ── RESERVEN ÄR EN LAPP, INTE EN ANDRA PRISKÄLLA ─────────────────────────
    // Ett par hundra kort som leverantören tappat är precis vad reserven är till för.
    // TUSENTALS är något annat: då är det feeden som ligger nere, och att tyst byta ut
    // hela katalogens äkta From-priser mot guide-uppskattningar vore en nedgradering av
    // allt vi visar — utfört av en reservmekanism, i det tysta. Släpp då hellre igenom
    // feedens egna resultat oförändrade och låt täckningsvakten gå röd som förut.
    // Taket ligger med marginal över det uppmätta läget (61 kort 2026-08-05).
    const guideReserveMax = Number(process.env.CM_GUIDE_RESERVE_MAX) || 500;
    if (guideOnlyOps.length > guideReserveMax) {
      console.error(
        `[cm-refresh] GUIDE-RESERVEN AVSTÅR: ${guideOnlyOps.length} kort saknade feed-pris ` +
        `(tak ${guideReserveMax}). Så många på en gång är en trasig feed, inte kort ` +
        `leverantören tappat — reserven är en lapp för enstaka kort, inte en andra ` +
        `priskälla för hela katalogen. Inget guide-pris skrivs; täckningsvakten dömer.`
      );
      guideOnlyOps.length = 0;
    }
    if (guideOnlyOps.length > 0) {
      singleOps.push(...guideOnlyOps);
      viaCounts["guide-reserv"] = guideOnlyOps.length;
      console.log(
        `[cm-refresh] Guide-reserv: ${guideOnlyOps.length} singlar som feeden tappat ` +
        `(cardmarket_id: null) prissattes ur CM:s EGEN prisguide via vår länkade ` +
        `idProduct → uppskattning (OUT_OF_STOCK), annars hade de frusit.`
      );
    }
    if (guideOnlyNameRejects || guideOnlyNotSingle)
      console.log(
        `[cm-refresh] Guide-reserven avstod: ${guideOnlyNameRejects} där CM:s katalognamn ` +
        `inte höll med om kortet, ${guideOnlyNotSingle} där idProduct inte är en singel.`
      );

    await mapPool(singleOps, DB_CONCURRENCY, async (op) => {
      const stock = op.from ? "IN_STOCK" : "OUT_OF_STOCK";
      if (op.offerId) {
        await prisma.offer.update({ where: { id: op.offerId }, data: { price: op.priceOre, url: op.url, stockStatus: stock, condition: "NEAR_MINT", lastSeenAt: new Date() } });
        res.singlesUpdated++;
      } else {
        await prisma.offer.upsert({
          where: { productId_retailerId_condition_language: { productId: op.productId, retailerId: cm.id, condition: "NEAR_MINT", language: "EN" } },
          update: { price: op.priceOre, url: op.url, stockStatus: stock, lastSeenAt: new Date() },
          create: { productId: op.productId, retailerId: cm.id, condition: "NEAR_MINT", language: "EN", price: op.priceOre, currency: "SEK", stockStatus: stock, url: op.url },
        });
        res.singlesCreated++;
      }
    });

    // Länk-offers (pris null) för kort CM har men inte prissätter. Skapas bara där
    // ingen CM-offer finns; skriver ingen historik (det finns inget pris att skriva).
    if (linkOnlyOps.length > 0) {
      await mapPool(linkOnlyOps, DB_CONCURRENCY, async (op) => {
        await prisma.offer.upsert({
          where: { productId_retailerId_condition_language: { productId: op.productId, retailerId: cm.id, condition: "NEAR_MINT", language: "EN" } },
          // update: BARA länken/tidsstämpeln — aldrig priset (kan finnas en annan rad
          // med pris om unique-nyckeln matchar en befintlig offer).
          update: { url: op.url, lastSeenAt: new Date() },
          create: { productId: op.productId, retailerId: cm.id, condition: "NEAR_MINT", language: "EN", price: null, currency: "SEK", stockStatus: "OUT_OF_STOCK", url: op.url },
        });
      });
      console.log(`[cm-refresh] ${linkOnlyOps.length} kort som CM har men inte prissätter fick en LÄNK-offer (pris "–").`);
    }

    // Daglig CM-historikpunkt per uppdaterat kort → matar produktgrafen
    // (getPriceHistoryBySource grupperar PriceObservation per dag/källa) + de
    // dagliga snapshotsen (landning/dashboard). Detta är ENDA källan till ÄKTA
    // daglig historik — den byggs FRAMÅT (ingen API ger en historisk serie).
    // Värdet = samma From-pris vi visar (lowest_near_mint).
    const cmSource = await prisma.scrapeSource.findFirst({ where: { name: "Cardmarket" }, select: { id: true } });
    if (cmSource && singleOps.length > 0) {
      const today = utcToday();
      await prisma.priceObservation.createMany({
        data: singleOps.map((op) => ({ productId: op.productId, sourceId: cmSource.id, price: op.priceOre, currency: "SEK" })),
      });
      // Last-write-wins: en omkörd/healad körning ersätter dagens befintliga punkt.
      await upsertTodaySnapshots(singleOps, today);
      res.historyPoints = singleOps.length;
    }
    console.log(
      `[cm-refresh] Prisets källa: ${Object.entries(viaCounts).map(([k, v]) => `${k}=${v}`).join(" ") || "–"}` +
      ` (from = CM:s NM-engelska lägsta rakt av; estimate = fältet saknades → OUT_OF_STOCK)`
    );
    if (byNumberHits || byNumberNameRejects)
      console.log(
        // RADER, inte kort: sedan nyckeln slutade konsumeras kan flera tryckningar av
        // samma kort matcha reserven (exakt en av dem vinner, se feedRowWins).
        `[cm-refresh] Set+nummer-reserven: ${byNumberHits} feed-rader matchade utan användbar tcgid ` +
        `(${byNumberNameRejects} avvisade på kortnamn).`
      );
    if (cmidNameRejects)
      console.log(
        `[cm-refresh] Namnvakt på cardmarket_id: ${cmidNameRejects} feed-rader pekade ut en produkt ` +
        `med ett ANNAT kortnamn → matchningen avvisad (raden får söka via nummerreserven).`
      );
    if (misIdentified)
      console.log(`[cm-refresh] Identitetsvakt: ${misIdentified} kort där RapidAPI:s cardmarket_id pekar på ett ANNAT kort i CM:s katalog → guide-raden ignorerad.`);
    if (notASingle)
      console.log(`[cm-refresh] Identitetsvakt: ${notASingle} kort där cardmarket_id inte är en SINGEL alls (sealed/okänd idProduct) → guide-raden ignorerad, From publiceras rått.`);
    console.log(`[cm-refresh] Singlar: ${res.singlesUpdated} uppdaterade, ${res.singlesCreated} nya, ${res.historyPoints} historikpunkter.`);
  }

  if (opts.sealed !== false) {
    const apiProducts: ApiProduct[] = [];
    let page = 1, total = 1;
    let failedPage: number | null = null;
    do {
      const d = await api<{ data: ApiProduct[]; paging: { total: number } }>(`https://${HOST}/pokemon/products?page=${page}`);
      // FAILA HÖGT. Förut stod här ett bart `break` → föll sida 1 bort (429/5xx efter
      // alla retries, eller slut på RapidAPI-kvot) blev sealed-katalogen TOM, hela
      // sealed-fasen gjorde tyst ingenting och jobbet blev ÄNDÅ GRÖNT. Det hände
      // 2026-07-09: "Sealed: 0 uppdaterade, 0 historikpunkter" — en hel dags sealed-
      // priser och historikpunkter förlorade, utan ett enda larm. En halv katalog är
      // lika illa: då hoppas produkterna på de uteblivna sidorna tyst över.
      if (!d) { failedPage = page; break; }
      total = d.paging.total;
      apiProducts.push(...d.data);
      await sleep(throttle);
    } while (page++ < total);

    if (failedPage !== null) {
      throw new Error(
        `[cm-refresh] Sealed-katalogen kunde inte hämtas: sida ${failedPage}/${total} gav null efter retries ` +
          `(${apiProducts.length} produkter hann hämtas). Avbryter med FEL så körningen blir röd — ` +
          `en grön körning här betyder tyst förlorade sealed-priser för hela dygnet. ` +
          `Vanligaste orsaken: RapidAPI-kvoten slut (1597/3000 används normalt) eller 429/5xx.`
      );
    }

    const byEpisode = new Map<string, ApiProduct[]>();
    const apiByCmId = new Map<number, ApiProduct>();
    for (const p of apiProducts) {
      const ep = norm(p.episode?.name ?? "");
      if (ep) (byEpisode.get(ep) ?? byEpisode.set(ep, []).get(ep)!).push(p);
      if (p.cardmarket_id != null) apiByCmId.set(p.cardmarket_id, p);
    }
    const ours = await prisma.product.findMany({
      where: { category: { notIn: ["SINGLE_CARD", "GRADED_CARD", "ACCESSORY"] } },
      include: {
        set: { select: { name: true } },
        offers: { select: { id: true, retailerId: true, price: true, stockStatus: true, url: true } },
        // Senaste snapshots → stabil historik-median som facit när CM-guiden glitchar.
        priceSnapshots: { select: { avgPrice: true }, orderBy: { date: "desc" }, take: 10 },
      },
    });
    // priceOre: null = tunn marknad, vi VET inte priset → offern nollas ("–"), ingen
    // historikpunkt. stock UNKNOWN (inte OUT_OF_STOCK: vi vet inte det heller).
    type SealedOp = {
      productId: string; offerId?: string; imageUrl?: string;
      priceOre: number | null; refOre?: number | null;
      url: string; stock: "IN_STOCK" | "OUT_OF_STOCK" | "UNKNOWN";
    };
    const sealedOps: SealedOp[] = [];
    // Vilka CM-produkter ÄGS redan? Seedas från befintliga CM-offers, så en fuzzy-match
    // aldrig kan kapa en idProduct som en annan katalogprodukt redan har. Se vakten nedan.
    const ownedCmIds = new Set<number>();
    for (const p of ours) {
      const existing = p.offers.find((o) => o.retailerId === cm.id);
      const m = existing?.url?.match(/idProduct=(\d+)/);
      if (m) ownedCmIds.add(parseInt(m[1], 10));
    }
    let skippedOwned = 0;
    // Sanitetsreferens + facit från CM:s egen prisguide (publik export, ingen scraping).
    const cmGuide = await fetchCmGuide();
    // Sealed-katalogens idProducts → EN-guide-fallbacken (nedan) prissätter BARA mot dessa.
    const sealedCmIds = await fetchCmSealedIds();
    // idExpansion → vårt setId, härlett ur våra REDAN etiketterade produkter.
    // Ger guide-fallback-produkter en set-etikett: de finns inte i RapidAPI, så
    // setLabeler (episodnamn) nås aldrig av dem — 30th Celebration-tinsen
    // prissattes dagligen men stod set-lösa i evighet (upptäckt 2026-08-09).
    // ⛔ Vakterna (enhällighet + dubbelriktning) bor i expansionSetJoin — se
    // container-expansionsfällan dokumenterad där innan något ändras.
    const sealedExpansionById = await fetchCmSealedExpansions();
    const setIdByExpansion = expansionSetJoin(
      ours.map((p) => {
        const m = p.offers.find((o) => o.retailerId === cm.id)?.url?.match(/idProduct=(\d+)/);
        return { setId: p.setId, idProduct: m ? parseInt(m[1], 10) : null };
      }),
      sealedExpansionById
    );
    // Set-etiketteraren. Etiketten sätts alltid (den är additiv och nyckeln är
    // exakt), men SKAPANDET av saknade CardSet (B2) sker bara i en full körning:
    // en riktad omkörning ser inte hela katalogen och ska inte lägga till
    // katalogstruktur som ingen produkt i den körningen behöver. Samma
    // försiktighetsregel som guide-reserven, fast den här skriver STRUKTUR.
    const partialSealedRun =
      (process.env.CM_ONLY_EPISODES ?? "").trim() !== "" ||
      parseInt(process.env.CM_LIMIT_EPISODES ?? "0", 10) > 0;
    const setLabeler = await createSetLabeler(!partialSealedRun);
    let guarded = 0, thinSkipped = 0, usedHist = 0, guideFallback = 0, liquidFloored = 0;
    const liquidFlooredTitles: string[] = []; // exakt vilka produkter likvid-golvet rörde (revision)
    for (const p of ours) {
      // RapidAPI-katalogen är HELT engelsk (0 japanska set/produkter, verifierat
      // 2026-07-07) — icke-EN-produkter får ALDRIG matchas här (fyra olika japanska
      // boxar fuzzy-matchade alla mot EN "Scarlet & Violet Booster Box" och visade
      // dess pris). Japanska prissätts av runJapaneseSealedRefresh (officiella
      // prisguiden) istället.
      if (p.language !== "EN") continue;
      const cmOffer = p.offers.find((o) => o.retailerId === cm.id);
      // 1) Exakt via cardmarket_id (idProduct i offer-URL:en) — täcker även
      //    set-lösa produkter (tins m.m. som inte kan fuzzy-matchas på set).
      let best: ApiProduct | null = null;
      let exact = false;
      const idm = cmOffer?.url?.match(/idProduct=(\d+)/);
      if (idm) { best = apiByCmId.get(parseInt(idm[1], 10)) ?? null; exact = best != null; }
      // 1b) EN-GUIDE-FALLBACK: känt idProduct som INTE finns i RapidAPI men i CM-guiden.
      //     RapidAPI-katalogen missar Trick or Trade, vintage m.m. → utan detta prissätts de
      //     ALDRIG dagligen och fryser (ägaren hittade T&T 2023/2024 stilla sedan 15 juli).
      //     Prissätt då direkt från guiden (From→trend→30d, samma väg som JP-refreshen).
      //     HÅRD VAKT: bara mot idProducts i SEALED-katalogen — aldrig en singel (annars
      //     återuppstår Venusaur→Surfing Pikachu). Exakt idProduct från offern = betrodd länk;
      //     vi fuzzy-matchar ALDRIG mot guiden. Känt sealed-id → hoppa över fuzzy oavsett.
      if (!best && idm && cmOffer) {
        const gid = parseInt(idm[1], 10);
        if (sealedCmIds.has(gid)) {
          // SET-ETIKETT ÄVEN HÄR (2026-08-09): den här grenen `continue`:ar före
          // setLabeler nedan, och en produkt som saknas i RapidAPI nådde därför
          // ALDRIG någon etikettering — priset uppdaterades varje dag medan
          // setet stod tomt. Etiketten sätts FÖRE prisfrågan (samma regel som
          // fuzzy-grenen): en produkt vars pris hoppas över har ändå en känd
          // set-tillhörighet. Skriver bara null → värde.
          if (p.setId == null) {
            const exp = sealedExpansionById.get(gid);
            const target = exp != null ? setIdByExpansion.get(exp) : undefined;
            if (target) {
              await prisma.product.update({ where: { id: p.id }, data: { setId: target } });
              console.log(`[cm-refresh] Set-etikett via expansion ${exp}: "${p.title}"`);
            }
          }
          const gEntryGuide = cmGuide.get(gid);
          const priced = priceFromGuide(gEntryGuide);
          if (priced) {
            let eur = priced.eur;
            // Historik-vakt hoppas över när CM är självkonsistent (se cmSelfConsistent):
            // en accepterad From som stämmer med trend OCH 30d = facit, ingen förgiftad
            // historik-median får överrösta den (ratchet-fixen 2026-07-24, Mega Lucario).
            const trustFrom = priced.accepted && cmSelfConsistent(priced.eur, gEntryGuide?.trend, gEntryGuide?.avg);
            const histOre = trustFrom
              ? null
              : stableHistoryOre(p.priceSnapshots.map((s) => s.avgPrice));
            if (histOre != null) {
              const eurOre = eur * rates.eurToOre;
              if (Math.max(eurOre / histOre, histOre / eurOre) > 1.5) eur = histOre / rates.eurToOre;
            }
            const refEur = cmGuideRefEur(cmGuide.get(gid));
            const sealedOre = priceOreFromEur(eur, rates);
            if (sealedOre == null) continue; // 0 kr är inget pris — se priceOreFromEur
            sealedOps.push({
              productId: p.id, offerId: cmOffer.id,
              priceOre: sealedOre,
              refOre: priceOreFromEur(refEur, rates),
              url: cardmarketProductUrl(gid), stock: priced.accepted ? "IN_STOCK" : "OUT_OF_STOCK",
            });
            ownedCmIds.add(gid);
            guideFallback++;
          }
          continue; // känt sealed-id: prissatt via guide (eller ingen guide-data) → ingen fuzzy
        }
      }
      // 2) Annars fuzzy (produkter utan CM-offer): set-scopat, ELLER globalt för
      //    set-lösa auto-importerade stubs så även de får CM-pris/trend.
      //    Kombo-/lot-produkter ("Booster + Mini Pärm", "ETB + Acrylic case") får
      //    ALDRIG fuzzy-länkas till basproduktens CM-sida — fel prisreferens.
      if (!best && ["combo", "multipack", "case", "event"].includes(classifyForm(p.title) ?? "")) continue;
      if (!best) {
        const m = bestSealedMatch(
          { title: p.title, category: p.category, setName: p.set?.name ?? null },
          apiProducts, byEpisode
        );
        if (!m) continue;
        best = m.match;
        // ── EN CM-PRODUKT = EN KATALOGPRODUKT ────────────────────────────────────
        // Den globala namn-matchningen (GLOBAL_MIN_SCORE 0.72) hade INGEN unikhetsvakt:
        // flera av våra titlar kunde vinna SAMMA CM-produkt, och alla utom en visade då
        // en FRÄMMANDE prisgraf. Mätt 2026-07-14: 16 kolliderande idProduct, 19 produkt-
        // sidor med fel kurva — bl.a. en enskild "Kanto Power Mini Tin" som visade
        // 5-pack-boxens 1 222 kr. Bryter mot regeln "inga fabricerade priser".
        //
        // Samma princip som cross-produkt-URL-vakten i runner.ts: ägs identiteten redan,
        // rör den inte. En produkt UTAN graf är alltid bättre än en med FEL graf.
        // (Exakt idProduct-träff ovan (`exact`) är undantagen — den ÄR ägarskapet.)
        if (best.cardmarket_id != null && ownedCmIds.has(best.cardmarket_id)) {
          skippedOwned++;
          continue;
        }
        // Identiteten är just avgjord (fuzzy = produkten hade ingen betrodd
        // CM-länk) → butiksfrasen byts mot CM:s katalognamn (ägarbeslut
        // 2026-08-09, se adopt-cm-name.ts). Exakta idProduct-träffar rörs inte
        // här — de namntvättas EN gång av scripts/adopt-cm-names.ts.
        if (best.cardmarket_id != null) await adoptCmName(p.id, best.name);
      }
      if (best.cardmarket_id == null) continue;
      if (best.cardmarket_id != null) ownedCmIds.add(best.cardmarket_id);

      // ── SET-ETIKETT (2026-08-06) ──────────────────────────────────────────────
      // Identiteten är just avgjord: `best` ÄR produktens CM-produkt och bär sin
      // episod. Etiketten sätts därför HÄR, inte av veckojobbet — en set-lös
      // förhandsbox var annars osynlig för set-bevakningen i dagar till veckor.
      // Ligger FÖRE prislogiken med flit: en produkt vars PRIS vi hoppar över
      // (tunn marknad, butiks-cross-check) har ändå en känd set-tillhörighet.
      // Skriver bara null → värde; se sealed-set-label.ts för vakterna.
      if (p.setId == null) {
        await setLabeler.label(p.id, p.setId, best.episode?.name ?? null);
      }

      const cmp = best.prices?.cardmarket ?? {};
      const gEntry = cmGuide.get(best.cardmarket_id);
      const avg = cmp["30d_average"] ?? null;
      const ref = cmGuideRefEur(gEntry) ?? avg; // TREND > 30d — sanitetsreferens OCH fallback
      // FROM (ägarens regel: from > trend > 30-dagssnitt). RapidAPI:s `lowest` FÖRST; saknas
      // den (vanligt på vintage/ETB) tar vi guidens `low` — men BARA när en trend/30d-referens
      // finns att grinda den mot. Utan referens passerar en glitchad guide-From ogranskad
      // (mätt: pin-blister → 2000€, XY Kanto Starters → 22 080 kr). RapidAPI:s egen lowest
      // behåller sitt gamla beteende. Skräp-From fångas annars av sanePriceEur nedan.
      const low = cmp.lowest ?? (ref != null ? usable(gEntry?.low) : null) ?? null;
      // Tunndata-vakt (vintage): ingen engelsk annons alls OCH billigaste annons på
      // NÅGOT språk ligger >3x över 30d-snittet → snittet är internt inkonsistent
      // med marknadens faktiska utbud och går inte att lita på (B&W Booster Box:
      // 1 st DE-annons €7 500 mot "snitt" €890 → headline 9 804 kr på en 130 000 kr-
      // box). Hoppa hellre över än vilseled — priset lämnas orört/null.
      const langLows = [cmp.lowest_DE, cmp.lowest_FR, cmp.lowest_ES, cmp.lowest_IT].filter(
        (v): v is number => typeof v === "number" && v > 0
      );
      if (low == null && avg != null && langLows.length > 0 && Math.min(...langLows) > avg * 3) {
        continue;
      }
      // Referens till sanitetsvakten — OCH det värde vi faller tillbaka på när `lowest`
      // förkastas. CM:s EGEN trend går FÖRE RapidAPI:s 30d_average, av två skäl:
      //   1. 30d_average är null där RapidAPI saknar historik; trenden finns ändå.
      //   2. På tunt handlad vintage är 30d_average kraftigt UNDERSKATTAD. Mätt mot
      //      eBay/PriceCharting-sålt (2026-07-14): Arceus Booster Box → snittet gav
      //      13 498 kr, CM-trenden 32 856 kr, faktisk marknad 33-55k. Flashfire Booster
      //      Box → snittet 24 326 kr, trenden 54 829 kr, marknad 55-105k. Trenden träffar,
      //      snittet missar med 3-4x. Att byta ut ett för HÖGT skräpvärde mot ett för
      //      LÅGT vore ingen rättning — bara ett annat fel.
      // DOMEN över `low` vägs mot BÅDA CM-referenserna, inte bara mot `ref`.
      // Varför: 0.2x-golvet är kalibrerat mot 30-DAGSSNITTET ("en äkta From ligger
      // aldrig under 20% av snittet") men `ref` är TRENDEN. På en snabbt stigande
      // marknad springer trenden ifrån snittet, golvet följer med uppåt och kastar
      // en fullt äkta From — varpå vi publicerar trenden som butikspris. Mätt
      // 2026-07-21 (Prismatic Evolutions Poster Collection): From 35 €, 30d-snitt
      // 72 €, trend 212 € → 35 < 0.2×212 = 42 → förkastad → 2 436 kr i katalogen
      // medan butikerna låg på 299-599 kr. Att döma mot snittet ENSAMT vore lika
      // fel åt andra hållet: på tunn vintage är snittet kraftigt underskattat och
      // en äkta hög From skulle falla på 1.8x-taket. Förkasta därför bara det som
      // är orimligt mot BÅDA — då är det en glitch, inte en marknad i rörelse.
      // LIKVID-MARKNAD-GOLV: en skräp-From långt under en trend som 30d-snittet bekräftar,
      // på en likvid marknad, förkastas → trenden vinner (se isJunkLowOnLiquidMarket ovan).
      // Bekräftelse-snittet: RapidAPI:s 30d → guidens 30d → guidens all-time avg. Fallbacken
      // behövs eftersom RapidAPI saknar 30d på vissa (Destined Rivals) medan guidens avg
      // (7,16 €) ändå bekräftar trenden (6,92 €). Utan referens = ingen dom (behåll From).
      const items = cmp.available_items ?? 0;
      const confirmAvg = avg ?? gEntry?.avg30 ?? gEntry?.avg ?? null;
      const junkLowOnLiquid = isJunkLowOnLiquidMarket(low, confirmAvg, cmGuideRefEur(gEntry), items);
      if (junkLowOnLiquid) {
        liquidFloored++;
        if (liquidFlooredTitles.length < 30)
          liquidFlooredTitles.push(`${p.title} (From ${low?.toFixed(2)}€ → trend ${cmGuideRefEur(gEntry)?.toFixed(2)}€, ${items} annonser)`);
      }
      const credibleLow = lowIsCredible(low, avg, cmGuideRefEur(gEntry)) && !junkLowOnLiquid;
      let eur = credibleLow ? low : ref;
      if (!credibleLow && low != null) guarded++;

      // HISTORIK-GUARD (ägarens regel-tillägg): när CM-guiden SJÄLV glitchar (Skyridge
      // trend/avg = 1-dagsspiken) är även reservvärdet fel. En PLATT egen historik +
      // ett dagsvärde som avviker >1.5x = glitchen ligger i dagsvärdet → använd historik-
      // medianen. Volatil historik lämnas orörd (äkta marknad). Skyddar OCKSÅ mot en
      // EMPTY-PACKS-From som slank förbi (den ligger långt UNDER den stabila historiken).
      // Hoppa över historik-vakten när CM är självkonsistent (From≈trend≈30d, se
      // cmSelfConsistent): en trovärdig `low` är då CM:s faktiska lägsta annons = facit och
      // får inte överröstas av en (ev. butiks-förgiftad) historik-median — ratchet-fixen
      // 2026-07-24. Tunn/volatil vintage (avg spretar) BEHÅLLER historik-skyddet, liksom
      // Skyridge-glitchen (där är low ej trovärdig → credibleLow=false).
      const trustFrom = credibleLow && cmSelfConsistent(low, gEntry?.trend, gEntry?.avg);
      const histOre = trustFrom ? null : stableHistoryOre(p.priceSnapshots.map((s) => s.avgPrice));
      if (eur != null && histOre != null) {
        const eurOre = eur * rates.eurToOre;
        if (Math.max(eurOre / histOre, histOre / eurOre) > 1.5) { eur = histOre / rates.eurToOre; usedHist++; }
      }

      // ── TUNN MARKNAD → INGET PRIS ALLS ────────────────────────────────────
      // Vi accepterade INTE `lowest` (den var skräp/saknades) och måste falla
      // tillbaka på trend/snitt. Det duger bara om marknaden faktiskt handlas.
      // På vintage med en handfull annonser är BÅDA siffrorna fiktion — mätt mot
      // eBay/PriceCharting-sålt 2026-07-14:
      //   Gym Challenge Booster Box  2 annonser, lowest 29 500 € (en placeholder-
      //     annons), 30d-snitt 4 302 € → CM-trenden ger 49 734 kr, verklig marknad
      //     130-250k. Plasma Storm ETB: 1 annons. Supreme Victors: 2. Neo Destiny:
      //     CM-"trend" 99,99 € på en box som gått för 150-450k kr.
      // Ett för lågt påhittat pris är inte bättre än ett för högt — båda bryter mot
      // "inga fabricerade priser". Hellre "–" än en siffra vi vet är fel.
      //
      // Grinden är SMAL med flit, tre villkor:
      //   1. En ACCEPTERAD `lowest` är en riktig, köpbar annons → publiceras alltid,
      //      hur tunn marknaden än är. Bara RESERVVÄRDET misstros.
      //   2. Det måste FINNAS en lowest som vi förkastat (low != null). Det är
      //      placeholder-signaturen: "45 000 € begärt, trend 3 820 €, 4 annonser".
      //      En produkt HELT utan annonser är bara slutsåld på CM — den behåller
      //      sitt gamla beteende (OUT_OF_STOCK + trend som uppskattning).
      //   3. Marknaden är tunn (≤THIN_ITEMS annonser).
      const accepted = low != null && eur === low;
      if (low != null && !accepted && items <= THIN_ITEMS) {
        thinSkipped++;
        sealedOps.push({
          productId: p.id, offerId: cmOffer?.id, priceOre: null, refOre: null,
          url: cardmarketProductUrl(best.cardmarket_id), stock: "UNKNOWN",
        });
        continue;
      }

      const priceOre = priceOreFromEur(eur, rates);
      if (priceOre == null) continue; // ingen prisdata alls (eller 0 — se priceOreFromEur)
      // Glitchad micro-lowest → sanePriceEur gav 30d-snittet; behandla som ur lager
      // (ingen tillförlitlig aktuell annons) istället för att låtsas IN_STOCK.
      const stock = low != null && eur === low ? "IN_STOCK" : "OUT_OF_STOCK";
      // butik-cross-check bara för fuzzy-träffar (exakt cmid = rätt produkt)
      if (!exact && priceOre != null) {
        const storePrices = p.offers.filter((o) => o.retailerId !== cm.id && o.price != null && o.stockStatus === "IN_STOCK").map((o) => o.price as number);
        const storeMin = storePrices.length ? Math.min(...storePrices) : null;
        if (storeMin != null && priceOre > storeMin * 2.5) continue;
      }
      // Self-heal: håll sealed-bilden i synk med CM. Endast på EXAKT cmid-match
      // (fuzzy kan välja fel produkt). Sedan 2026-07-19 sätts CM-PROXYN
      // (/api/cm-image/{cmid}, referer-gated + immutable-cachad) istället för
      // tcggo-hotlinken: då konvergerar ALLA exakt-länkade sealed till CM:s egen
      // bild och gamla tcgplayer-/butiks-/FEL-tcggo-bilder läker automatiskt
      // (Sprigatito/Kanto Friends/Palkia/Riolu-fallen 2026-07-19 var exakt-
      // länkade men behöll fel bild eftersom self-heal bara jämförde tcggo-URL:er).
      // MEN: att katalogen har en bild-URL (best.image) BEVISAR INTE att Cardmarket
      // har en egen render — 325 sealed-SKU:er (blistrar, checklanes, pin-collections)
      // saknar render helt. Det kravet ensamt pekade dem på proxyn, som 404:ade →
      // trasig <img> i hela katalogen (rapporterat 2026-07-21). Proba därför CM:s CDN
      // innan vi byter: finns ingen render vinner katalogens egen bild (tcggo, inte
      // referer-gatead). En redan satt proxy-URL rörs aldrig (yttre villkoret).
      //
      // KONVERGENS (fix 2026-07-24): render-LÖSA produkter (325 sealed saknar render)
      // sattes till best.image och probades sedan OM VARJE DYGN — `p.imageUrl !== proxyUrl`
      // förblev sant, så de 28 CDN-proberna kördes igen dagligen (sealed-fasen tog 85 min
      // och sköt jobbet över 2h-taket). `!== best.image` gör att en produkt som redan
      // pekar på katalogbilden aldrig probas igen: render-full → proxy (konvergerar via
      // yttre villkoret), render-lös → best.image (konvergerar här). Ändras best.image
      // (CM uppdaterar bilden) skiljer de sig igen → en ny prob, sedan stabilt.
      const proxyUrl = cmImageProxyUrl(best.cardmarket_id);
      let imageUrl: string | undefined;
      if (exact && best.image && p.imageUrl !== proxyUrl && p.imageUrl !== best.image) {
        imageUrl = (await cmRenderExists(best.cardmarket_id)) ? proxyUrl : best.image;
      }
      // refOre = CM:s egen trend → dagvaktens nödutgång: ett stort hopp MOT trenden
      // är en rättelse av ett korrupt värde, inte en glitch. Utan den fastnar
      // skräpvärden för alltid (se saneDayMove).
      const refEur = cmGuideRefEur(cmGuide.get(best.cardmarket_id));
      const refOre = priceOreFromEur(refEur, rates);
      sealedOps.push({ productId: p.id, offerId: cmOffer?.id, imageUrl, priceOre, refOre, url: cardmarketProductUrl(best.cardmarket_id), stock });
    }
    const sealed = await clampDayMoves(sealedOps);
    if (sealed.clamped) console.log(`[cm-refresh] Sealed: klämde ${sealed.clamped} orimliga dagshopp (≥${DAY_MOVE_MAX}x) till gårdagens värde.`);
    if (sealed.healed) console.log(`[cm-refresh] Sealed: LÄKTE ${sealed.healed} tidigare korrupta priser (stort hopp mot CM-trend).`);
    await mapPool(sealedOps, DB_CONCURRENCY, async (op) => {
      if (op.imageUrl) await prisma.product.update({ where: { id: op.productId }, data: { imageUrl: op.imageUrl } });
      // Sätt ALLTID price (även null) så ett gammalt uppblåst pris nollas när lowest försvinner.
      if (op.offerId) {
        await prisma.offer.update({ where: { id: op.offerId }, data: { price: op.priceOre, url: op.url, stockStatus: op.stock, condition: "SEALED", lastSeenAt: new Date() } });
      } else {
        await prisma.offer.upsert({
          where: { productId_retailerId_condition_language: { productId: op.productId, retailerId: cm.id, condition: "SEALED", language: "EN" } },
          update: { price: op.priceOre, url: op.url, stockStatus: op.stock, lastSeenAt: new Date() },
          create: { productId: op.productId, retailerId: cm.id, condition: "SEALED", language: "EN", price: op.priceOre, currency: "SEK", stockStatus: op.stock, url: op.url },
        });
      }
      res.sealedUpdated++;
    });

    // Daglig CM-historikpunkt även för sealed (samma mönster som singlar ovan).
    // Utan detta uppdateras bara Offer.price → sealed-grafen fryser på prod och
    // hänger bara med via manuell synk. Värdet = priset vi visar (lowest/30d).
    const cmSourceSealed = await prisma.scrapeSource.findFirst({ where: { name: "Cardmarket" }, select: { id: true } });
    // Bara PRISSATTA ops blir historik. En tunndata-op bär priceOre=null (vi vet inte
    // priset) — den nollar offerens pris men får ALDRIG bli en snapshot-punkt:
    // minPrice/avgPrice är NOT NULL, och en påhittad punkt vore precis det vi undviker.
    const pricedOps = sealedOps.filter(
      (op): op is typeof op & { priceOre: number } => op.priceOre != null,
    );
    if (cmSourceSealed && pricedOps.length > 0) {
      const today = utcToday();
      await prisma.priceObservation.createMany({
        data: pricedOps.map((op) => ({ productId: op.productId, sourceId: cmSourceSealed.id, price: op.priceOre, currency: "SEK" })),
      });
      // Last-write-wins: en omkörd/healad körning ersätter dagens befintliga punkt.
      await upsertTodaySnapshots(pricedOps, today);
      res.historyPoints += pricedOps.length;
    }
    if (guarded) console.log(`[cm-refresh] Prisvakt: ${guarded} glitchade lowest ersatta av CM-referens (trend/30d).`);
    if (usedHist) console.log(`[cm-refresh] Historik-guard: ${usedHist} sealed där CM-guiden glitchade → vår stabila historik-median användes.`);
    if (thinSkipped) console.log(`[cm-refresh] Tunn marknad: ${thinSkipped} sealed utan tillförlitligt pris → "–" (≤${THIN_ITEMS} CM-annonser, reservvärdet går ej att lita på).`);
    if (guideFallback) console.log(`[cm-refresh] EN-guide-fallback: ${guideFallback} sealed vars idProduct saknas i RapidAPI prissatta direkt från CM-guiden (annars frusna).`);
    if (liquidFloored) console.log(`[cm-refresh] Likvid-golv: ${liquidFloored} skräp-From på likvid+stabil marknad → CM-trend istället:\n  ${liquidFlooredTitles.join("\n  ")}`);
    console.log(`[cm-refresh] Sealed: ${res.sealedUpdated} uppdaterade, ${pricedOps.length} historikpunkter.`);
    const sl = setLabeler.stats;
    if (sl.labeled || sl.setsCreated || sl.ambiguous || sl.noSeries || sl.unresolved)
      console.log(
        `[cm-refresh] Set-etikett: ${sl.labeled} produkter etiketterade, ${sl.setsCreated} nya set ur CM-episoder` +
        `${sl.createdNames.length ? ` (${sl.createdNames.join(", ")})` : ""}` +
        `${sl.ambiguous ? `, ${sl.ambiguous} tvetydiga episodnamn` : ""}` +
        `${sl.noSeries ? `, ${sl.noSeries} episoder utan serie` : ""}` +
        `${sl.unresolved ? `, ${sl.unresolved} olösta` : ""}.`
      );
    if (skippedOwned > 0) {
      console.log(
        `[cm-refresh] Sealed: hoppade över ${skippedOwned} fuzzy-matchningar mot en CM-produkt som redan ` +
          `ägs av en annan katalogprodukt (unikhetsvakt — en produkt utan graf är bättre än en med FEL graf).`
      );
    }
  }

  // Japanska sealed-produkter: officiella CM-prisguiden (gratis nedladdning,
  // ingen RapidAPI-kvot). Egna JP-produktsidor på CM + language=7-länkar.
  if (opts.sealed !== false) {
    try {
      const jp = await runJapaneseSealedRefresh();
      res.historyPoints += jp.updated;
    } catch (err) {
      console.error("[cm-refresh] JP-refresh misslyckades:", err instanceof Error ? err.message : err);
    }
  }

  // Specialvariant-priser (GameStop-promo, reverse m.m.) via pokemontcg.io-trend.
  res.historyPoints += await runVariantRefresh();

  // Uppdatera denormaliserat lägstapris (katalog-feed: sortering + gömning).
  await recomputeProductPriceCache();
  // Daglig historikpunkt för sealed UTAN CM-trend (butiksprissatta) — annars
  // fryser deras graf. Kör SIST: CM-mappade har redan snapshot, lowestPriceOre färskt.
  const storeSnaps = await snapshotStorePricedProducts();
  if (storeSnaps > 0) console.log(`[cm-refresh] Butikshistorik: ${storeSnaps} snapshots (sealed utan CM-trend).`);
  console.log(`[cm-refresh] Klart: ${res.apiCalls} API-anrop, kvot kvar ${res.remaining}.`);

  // TÄCKNINGSVAKTEN SIST — efter BÅDA faserna och alla skrivningar. Kastar den tidigare
  // hoppas sealed-fasen över, och ett täckningsproblem hade tystat dagens sealed-priser.
  // Hoppas över för DELKÖRNINGAR (CM_ONLY_EPISODES/CM_LIMIT_EPISODES eller --sealed):
  // de rör med flit bara en del av katalogen och säger inget om täckningen.
  const partialRun =
    opts.singles === false ||
    (process.env.CM_ONLY_EPISODES ?? "").trim() !== "" ||
    parseInt(process.env.CM_LIMIT_EPISODES ?? "0", 10) > 0;
  if (!partialRun) {
    const cov = await readSinglesCoverage(res.singlesUpdated + res.singlesCreated);
    const pct = cov.totalSingles > 0 ? (cov.coveredSingles / cov.totalSingles) * 100 : 100;
    console.log(
      `[cm-refresh] TÄCKNING: ${cov.coveredSingles} / ${cov.totalSingles} singlar har CM-offer ` +
      `(${pct.toFixed(1)} %). Prissatta denna körning: ${cov.pricedThisRun}. ` +
      `Ej uppdaterade på ${COVERAGE_STALE_DAYS} dygn: ${cov.staleOffers}.`
    );
    const verdict = coverageVerdict(cov);
    if (!verdict.ok) {
      throw new Error(
        `[cm-refresh] TÄCKNINGSVAKT: ${verdict.problems.join("; ")}. Skrivningarna är gjorda — ` +
        `körningen blir RÖD för att täckningen inte går att lita på. Så här såg 2026-07-26 ut: ` +
        `tre hela set (366 singlar) utan CM-data i veckor, varje körning grön. Är luckan ` +
        `VERIFIERAT tom hos Cardmarket: lägg setet i COVERAGE_ALLOWED_EMPTY_SETS.`
      );
    }
  }
  return res;
}

/** Täckningssiffrorna ur DB (billiga aggregat, inga API-anrop). */
export async function readSinglesCoverage(pricedThisRun = 0): Promise<CoverageInput> {
  const [totals] = await prisma.$queryRaw<{ total: bigint; covered: bigint }[]>`
    SELECT COUNT(*)::bigint AS total,
           COUNT(*) FILTER (WHERE EXISTS (
             SELECT 1 FROM "Offer" o JOIN "Retailer" r ON r.id = o."retailerId"
             WHERE o."productId" = p.id AND r.name = 'Cardmarket'))::bigint AS covered
    FROM "Product" p WHERE p.category = 'SINGLE_CARD'`;
  const emptySets = await prisma.$queryRaw<{ set: string; singles: bigint }[]>`
    SELECT COALESCE(cs."externalId", cs.name) AS set, COUNT(*)::bigint AS singles
    FROM "Product" p JOIN "CardSet" cs ON cs.id = p."setId"
    WHERE p.category = 'SINGLE_CARD'
    GROUP BY COALESCE(cs."externalId", cs.name)
    HAVING COUNT(*) FILTER (WHERE EXISTS (
             SELECT 1 FROM "Offer" o JOIN "Retailer" r ON r.id = o."retailerId"
             WHERE o."productId" = p.id AND r.name = 'Cardmarket')) = 0
    ORDER BY singles DESC`;
  const [stale] = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
    `SELECT COUNT(*)::bigint AS n
     FROM "Offer" o
     JOIN "Retailer" r ON r.id = o."retailerId" AND r.name = 'Cardmarket'
     JOIN "Product" p ON p.id = o."productId" AND p.category = 'SINGLE_CARD'
     WHERE o."lastSeenAt" < NOW() - ($1 || ' days')::interval`,
    String(COVERAGE_STALE_DAYS)
  );
  return {
    emptySets: emptySets.map((e) => ({ set: e.set, singles: Number(e.singles) })),
    totalSingles: Number(totals?.total ?? 0),
    coveredSingles: Number(totals?.covered ?? 0),
    staleOffers: Number(stale?.n ?? 0),
    pricedThisRun,
  };
}
