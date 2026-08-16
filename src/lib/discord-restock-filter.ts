/**
 * VAD FÅR POSTAS I DISCORD? — domen tas på BUTIKSANNONSEN, aldrig på katalogen.
 *
 * ⛔ DET HÄR ÄR HELA POÄNGEN MED OMBYGGET 2026-08-16. Fram till nu grindade
 * Discord-lanen på RUTTABELLEN: saknades butikens URL där postades ingenting, för
 * ruttabellen var den enda källan till "vad är det här för vara?". Följden var det
 * ägaren mätte i drift — mejl och push kom fram medan Discord teg om SAMMA
 * påfyllning, i de flesta butiker. Ruttabellen bär bara URL:er som har en Offer
 * eller en bunden huvudboksrad hos en restock-bevakad butik; allt annat som
 * butikerna säljer (nya SKU:er, varor katalogen aldrig importerat, gömda produkter,
 * URL-varianter som per konstruktion aldrig kan få en egen Offer) var osynligt.
 *
 * Nu ställer lanen samma frågor som auto-importen ställer om en NY annons — men
 * utan databas, och utan att kräva att varan finns hos oss:
 *
 *   1. Är det ENGELSKA eller JAPANSKA?      (`isBlockedListingLanguage`)
 *   2. Har ägaren nekat URL:en?             (`isDeniedListingUrl`)
 *   3. Är det ett TILLBEHÖR?                (`isAccessoryListing` + `classifyForm`)
 *   4. Är det MERCH?                        (`isMerchandiseListing`)
 *   5. Är det ett LÖSKORT?                  (`isSingleCardListing`)
 *   6. Är det en ANNAN TCG-franchise?       (`isOtherFranchiseListing`)
 *   7. Är det butikens EGEN hopsättning?    (`isStoreBundleListing`)
 *   8. Känner vi igen FORMEN?               (`guessListingCategory` ≠ OTHER)
 *   9. Kan den BEVISA att den är Pokémon?   (`hasPokemonTitleSignal`)
 *
 * ⛔ SAMMA FUNKTIONER SOM DB-VÄGEN, ALDRIG KOPIOR. Varje vakt här är den som
 * `ensureListingProduct` redan använder och som är mätt mot två facit
 * (`scripts/measure-guard-changes.ts`). Kopieras reglerna driver lanarna isär tyst —
 * exakt samma läxa som flapp-dämpningen bär (`src/lib/stock-flap.ts`).
 *
 * ⛔ ASYMMETRIN ÄR EN ANNAN HÄR ÄN I AUTO-IMPORTEN, och det är avsiktligt. Där kostar
 * ett falskt JA en dubblett i katalogen för all framtid; här kostar det ETT inlägg
 * som ingen klickar på. Ett falskt NEJ kostar däremot precis det ägaren klagar på: en
 * påfyllning som aldrig når kanalen. Därför står ingen vakt här som inte har ett
 * mätt facit bakom sig — och `isUnspecifiedCharacterListing` (som bara finns för att
 * hindra DUBBLETTER vid skapandet) står med flit INTE med: en "Premium Checklane
 * Blister" utan karaktär är en fullt riktig påfyllning att larma om.
 *
 * ⛔ KATEGORIGRINDEN STÅR KVAR (`OTHER` fälls). Den vidgades 2026-08-15 med tio
 * riktiga produktlinjer, men svansen som blir kvar i OTHER är mest merch som
 * ordlistorna inte känner igen (tote bags, Squishmallows, kakburkar, badbomber,
 * Monopol). Att öppna OTHER hade fyllt kanalerna med just det. Se
 * `src/scrapers/listing-category.ts`.
 */
import { detectListingLanguage, isBlockedListingLanguage } from "@/lib/listing-language";
import { guessListingCategory, type ListingCategory } from "@/scrapers/listing-category";
import { isDeniedListingUrl } from "@/scrapers/import-denylist";
import {
  classifyForm,
  cleanListingTitle,
  hasPokemonTitleSignal,
  isAccessoryListing,
  isMerchandiseListing,
  isOtherFranchiseListing,
  isSingleCardListing,
  isStoreBundleListing,
} from "@/scrapers/matching";
import { normalizeTitle } from "@/lib/utils";
import type { RouteTable } from "@/lib/restock-feed-events";

export type DiscordRejectReason =
  | "language"
  | "denylist"
  | "accessory"
  | "event"
  | "merch"
  | "single"
  | "other-franchise"
  | "store-bundle"
  | "unknown-form"
  | "no-pokemon-signal";

export interface DiscordFilterContext {
  /**
   * Normaliserade setnamn (≥3 tecken) — ENDA indatan den positiva Pokémon-vakten
   * behöver ur katalogen, och den bär inget om enskilda produkter. Kommer från
   * ruttabellsfilen, som redan hämtas ur ett fönster där Neon är vaken.
   *
   * ⛔ TOM MÄNGD FÅR ALDRIG BLI TYSTNAD. Vakten faller då tillbaka på ordlistan
   *    (Pokémon-ordet, Pokémon-namn, Pokémon-exklusiva produktlinjer), vilket är
   *    svagare men inte noll — se `hasPokemonTitleSignal`. Att bygga mängden ur
   *    ruttabellens EGNA `setName`-värden (se buildDiscordFilterContext) gör
   *    dessutom att en gammal cachad fil ändå ger en användbar lista.
   */
  setNames: ReadonlySet<string>;
}

export interface DiscordFilterResult {
  ok: boolean;
  reason?: DiscordRejectReason;
  /** Butikstiteln tvättad från "MAX 1 per kund", "(kopia)" och liknande skräp. */
  title: string;
  /** "EN" eller "JP" — enda två som passerar. Styr kanalvalet när setet är okänt. */
  language: "EN" | "JP";
  category: ListingCategory;
}

/**
 * Bygger vaktens indata ur ruttabellsfilen.
 *
 * Setnamnen tas från BÅDA hållen: den uttryckliga listan (`setNames`, skriven av
 * export-restock-routes) OCH varje `setName` som redan står på en rutt. Det andra
 * ledet finns för att en ÄLDRE cachad ruttabell inte har fältet — utan det hade en
 * deploy stått med en svagare Pokémon-vakt tills nästa nattliga export, dvs riktiga
 * påfyllningar hade fallit på "no-pokemon-signal" i upp till ett dygn.
 */
export function buildDiscordFilterContext(payload: {
  routes?: RouteTable;
  setNames?: string[] | null;
}): DiscordFilterContext {
  const names = new Set<string>();
  const add = (raw: string | null | undefined) => {
    if (!raw) return;
    // JP-set bär koden i namnet ("Wild Force (SV5K)") medan butikstiteln sällan gör
    // det — lägg in båda formerna, precis som knownSetNames() i runner.ts.
    for (const variant of [raw, raw.replace(/\(.*?\)/g, " ")]) {
      const n = normalizeTitle(variant);
      if (n.length >= 3) names.add(n);
    }
  };
  for (const n of payload.setNames ?? []) add(n);
  for (const r of Object.values(payload.routes ?? {})) add(r.setName);
  return { setNames: names };
}

/**
 * Får annonsen bli ett Discord-inlägg? Ren funktion — ingen DB, inga nätanrop.
 *
 * `category` är adapterns egen gissning (redan `guessListingCategory` på RÅTITELN).
 * Den vägs ihop med en gissning på den TVÄTTADE titeln: tvätten tar bort butiksbrus
 * som annars kan äta upp formordet, medan rårtiteln ibland bär ett formord tvätten
 * strippar. Känner NÅGON av dem igen formen räcker det.
 */
export function classifyDiscordListing(
  item: { title: string; url: string; category?: string | null },
  ctx: DiscordFilterContext
): DiscordFilterResult {
  const rawTitle = item.title ?? "";
  const cleanTitle = cleanListingTitle(rawTitle) || rawTitle;
  // Adapterns etikett räknas bara när den FAKTISKT är en form — "OTHER" betyder
  // "kände inte igen", inte "är inget".
  const adapterCategory =
    item.category && item.category !== "OTHER" ? (item.category as ListingCategory) : null;
  const category = adapterCategory ?? guessListingCategory(cleanTitle);
  const lang = detectListingLanguage(rawTitle, item.url);
  const base = {
    title: cleanTitle,
    language: (lang === "JP" ? "JP" : "EN") as "EN" | "JP",
    category,
  };
  const no = (reason: DiscordRejectReason): DiscordFilterResult => ({ ok: false, reason, ...base });

  // 1. SPRÅK. Katalogen är EN + JP, och kanalerna ska vara det också. Läses på
  //    titel OCH URL — DL:s "…-kinesisk-version"-slug avslöjar en latinsk titel.
  if (isBlockedListingLanguage(rawTitle, item.url)) return no("language");

  // 2. ÄGARENS DENYLIST. En URL admin nekat på produktsidan ("Ta bort") ska aldrig
  //    dyka upp i en publik kanal heller — annars är raderingen bara halv.
  if (isDeniedListingUrl(item.url)) return no("denylist");

  // 3. TILLBEHÖR. Uttrycklig ägarregel för kanalerna ("no accessories"), och samma
  //    vakt som håller dem ute ur katalogen. `classifyForm` fångar dessutom svenska
  //    former ordlistan inte har ("Greninja samlarpärm") och eventbiljetter.
  const form = classifyForm(normalizeTitle(cleanTitle));
  if (form === "accessory") return no("accessory");
  if (form === "event") return no("event");
  if (isAccessoryListing(cleanTitle)) return no("accessory");

  // 4. MERCH (gosedjur, figurer, kläder, godis, Re-Ment-dioramor).
  if (isMerchandiseListing(cleanTitle)) return no("merch");

  // 5. LÖSKORT. Singlar prissätts av Cardmarket och restockas hela dygnet hos
  //    butiker med tusentals av dem — en kanal som postar dem läses aldrig igen.
  if (isSingleCardListing(cleanTitle)) return no("single");

  // 6. ANNAN FRANCHISE. Butikernas Pokémon-hyllor läcker grannspel.
  if (isOtherFranchiseListing(cleanTitle)) return no("other-franchise");

  // 7. BUTIKENS EGEN HOPSÄTTNING (mystery box, "alla fem tins", slumpad blister).
  //    Ingen tillverkar-SKU ⇒ ingen kan veta vad larmet gäller.
  if (isStoreBundleListing(cleanTitle)) return no("store-bundle");

  // 8. FORMEN MÅSTE VARA KÄND. Se filhuvudet om varför OTHER stannar stängd.
  if (category === "OTHER") return no("unknown-form");

  // 9. POSITIV POKÉMON-EVIDENS. Läses på BÅDA titlarna: `cleanListingTitle` tar med
  //    flit bort "Pokémon TCG:"-prefixet, och för varje SKU vars enda Pokémon-ord
  //    satt där raderade tvätten precis det bevis vakten frågar efter.
  if (
    !hasPokemonTitleSignal(cleanTitle, ctx.setNames) &&
    !hasPokemonTitleSignal(rawTitle, ctx.setNames)
  ) {
    return no("no-pokemon-signal");
  }

  return { ok: true, ...base };
}

/**
 * Ett set ur vår katalog, förberett för matchning mot en butikstitel.
 *
 * ⛔ TAXONOMI, INTE KATALOG. Listan säger bara vilka SET som finns och vilken serie
 * de tillhör — inga produkter, inga priser, ingen bevakning. Den används för att ett
 * inlägg om en vara vi ALDRIG importerat ändå ska hamna i rätt seriekanal i stället
 * för i catch-all. Utan den blev följden av katalogfriheten att seriekanalerna tystnar
 * i takt med att lanen ser MER.
 */
export interface KnownSet {
  name: string;
  series: string | null;
  language: string | null;
  /** normalizeTitle(name) — förberäknad, matchningen körs per annons. */
  normalized: string;
}

export function buildKnownSets(payload: {
  sets?: { name: string; series: string | null; language: string | null }[] | null;
}): KnownSet[] {
  const out: KnownSet[] = [];
  for (const s of payload.sets ?? []) {
    // JP-set bär koden i namnet ("Wild Force (SV5K)"); butikstiteln gör det sällan.
    for (const variant of [s.name, s.name.replace(/\(.*?\)/g, " ")]) {
      const normalized = normalizeTitle(variant);
      // ⛔ ≥4 tecken. Tvåtecknare ("XY") substrängmatchar skräp, och tretecknare är
      //    farliga i den andra riktningen: "151" är BÅDE ett riktigt setnamn och ett
      //    vanligt tal. Det setet fångas ändå av rutten i praktiken (det säljs av
      //    varenda butik); en gissning på tre tecken är inte värd risken att posta
      //    "Mega Evolution"-varor i 151-kanalen.
      if (normalized.length >= 4 && !out.some((o) => o.normalized === normalized && o.language === s.language)) {
        out.push({ name: s.name, series: s.series, language: s.language, normalized });
      }
    }
  }
  // Längst först: "Scarlet & Violet 151" ska vinna över "Scarlet & Violet".
  return out.sort((a, b) => b.normalized.length - a.normalized.length);
}

/**
 * Vilket känt set nämner butikens titel? `null` = inget → catch-all.
 *
 * Språket vinner över namnet: EN- och JP-set delar LATINSKA namn ("Black Bolt",
 * "151"), och ett japanskt set med engelskt serienamn var precis det som postade fyra
 * japanska boxar i EN-seriekanalen 2026-08-12.
 */
export function matchKnownSet(
  title: string,
  sets: readonly KnownSet[],
  language: string | null | undefined
): KnownSet | null {
  const padded = ` ${normalizeTitle(title)} `;
  const lang = (language ?? "EN").toUpperCase();
  const matches = sets.filter((s) => padded.includes(` ${s.normalized} `));
  if (!matches.length) return null;

  // Språket först. Namnet fanns kanske bara på ett set med ANNAT språk — serien är
  // ändå rätt familj, och kanalvalet skyddar sig självt (`resolveChannelId` skickar
  // allt icke-engelskt till språkkanalen/catch-all oavsett vad serien heter).
  const sameLang = matches.filter((s) => (s.language ?? "EN").toUpperCase() === lang);
  const pool = sameLang.length ? sameLang : matches;

  // ⛔ ETT SET SOM HETER SAMMA SAK SOM SIN SERIE ÄR DEN MINST SPECIFIKA TOLKNINGEN.
  //    Seriens basutgåva bär seriens namn ("Mega Evolution" är BÅDE ett set och en
  //    serie), och butikerna skriver ut serien före setet: "Pokémon TCG: Mega
  //    Evolution - Chaos Rising Booster". Utan den här raden vinner det längre
  //    namnet ("mega evolution" > "chaos rising") och varan hamnar i basutgåvans
  //    kanal i stället för i sin egen.
  const specific = pool.filter(
    (s) => s.series && normalizeTitle(s.name) !== normalizeTitle(s.series)
  );
  // `sets` är sorterad längst-först, så [0] är den mest specifika kvarvarande.
  return (specific.length ? specific : pool)[0] ?? null;
}
