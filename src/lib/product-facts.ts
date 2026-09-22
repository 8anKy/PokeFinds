/**
 * PRODUKTFAKTA — det som fyller ytan under bilden på desktop (`ProductFactsPanel`).
 *
 * Ren modul: inga DB-anrop, inga översättningar. Returnerar NYCKLAR + tal, panelen
 * översätter. Två sorter:
 *
 *   · KORT (`card`): illustratör, sällsynthet, stadie, HP, nummer — det vi redan
 *     bär i `Card`. Fält vi saknar visas inte (ingen "–"-rad: en tom rad är en
 *     yta, inte information).
 *   · FÖRSEGLAT (`contents`): vad som ligger i lådan. Två källor, i ordning:
 *       1. KURERAD tabell per produkt (`data/sealed-contents-curated.ts`) — ur
 *          tillverkarens produktvisningar, med källa per rad. Vinner alltid.
 *       2. FAMILJEREGLER (`sealedContents` nedan) för format vars innehåll är
 *          detsamma över en hel era eller produktfamilj: ETB per era, booster
 *          box (EN 36; JP 30/20/10 efter setkod), bundle, blister, mini tin,
 *          Poké Ball-tin, ex-tin, ex-box, tech sticker collection m.fl. — varje
 *          regel är VERIFIERAD mot tillverkarens egen lista (2026-09-22), källor
 *          i kommentaren vid regeln.
 *     Premium-/Ultra-Premium-collections varierar per produkt och får BARA
 *     innehåll via den kurerade tabellen — hellre ingen lista än en påhittad. En
 *     rad med okänt antal skrivs aldrig ("inga fabricerade priser/data" gäller
 *     antal också). ⛔ Ingen LLM och ingen butikstext i den här kedjan (ägarbeslut
 *     2026-09-22): tabellen fylls för hand ur officiella källor.
 *
 * `Product.description` (fritext) är en separat sak och rör inte det här.
 */

import type { CardLanguage, ProductCategory } from "@prisma/client";
import { curatedContents } from "@/data/sealed-contents-curated";

/** En innehållsrad: antal + etikettnyckel (översätts i `Detail.contents.*`). */
export interface ContentsLine {
  qty: number;
  key: ContentsKey;
}

export type ContentsKey =
  | "boosters"
  | "classicPack"
  | "promoCard"
  | "promoPack"
  | "oversizeCard"
  | "sleeves"
  | "energyCards"
  | "foilEnergyCards"
  | "damageDice"
  | "damageCounters"
  | "coinDie"
  | "coin"
  | "conditionMarkers"
  | "playersGuide"
  | "codeCard"
  | "dividers"
  | "stickerSheet"
  | "techStickerSheet"
  | "artCard"
  | "poster"
  | "binder"
  | "figure"
  | "acrylicDisplay"
  | "playmat"
  | "deckBox"
  | "deck"
  | "pin";

export interface CardFacts {
  artist: string | null;
  rarity: string | null;
  /** "Basic" / "Stage 1" / "Trainer" — kortets subtype ur källan. */
  stage: string | null;
  hp: number | null;
  number: string;
  /** Tryckt total (talet på kortet), 0 = okänt. */
  printedTotal: number;
  /** Energityper på engelska som källan ger dem ("Grass") — UI:t översätter. */
  types: string[];
  weakness: { type: string; value: string | null } | null;
  retreatCost: number | null;
  regulationMark: string | null;
  dexId: number | null;
  flavorText: string | null;
}

/** Antal rader panelen kan visa för ett kort — under `MIN_CARD_FACTS` visas ingen panel. */
export function countCardFacts(c: CardFacts): number {
  return [
    c.artist,
    c.rarity,
    c.stage,
    c.hp,
    c.types.length > 0 ? c.types : null,
    c.weakness,
    c.retreatCost,
    c.regulationMark,
    c.dexId,
    c.flavorText,
  ].filter((v) => v != null).length;
}

/**
 * Färre fakta än så här ⇒ panelen är tre etiketter och luft (ägaren 2026-09-22:
 * "så lite information att det såg tomt ut"). Hellre ingen panel än en gles.
 */
export const MIN_CARD_FACTS = 4;

export interface ProductFacts {
  card: CardFacts | null;
  contents: ContentsLine[] | null;
  /** Setets serie ("Scarlet & Violet") — visas för både kort och förseglat. */
  series: string | null;
  /** ISO-datum (cache-serialiserat). Produkten först, setet som reserv. */
  releaseDate: string | null;
  /** Kort i setet: tryckt tal + fullt tal. 0 = okänt ⇒ raden döljs. */
  setCards: { printed: number; full: number } | null;
  language: CardLanguage;
}

export interface FactsInput {
  slug?: string;
  category: ProductCategory;
  language: CardLanguage;
  title: string;
  releaseDate: Date | string | null;
  set: {
    name?: string;
    series: string;
    releaseDate: Date | string | null;
    totalCards: number;
    totalCardsFull: number;
  } | null;
  card: {
    artist: string | null;
    rarity: string;
    subtype: string | null;
    hp: number | null;
    number: string;
    types?: string[];
    weaknessType?: string | null;
    weaknessValue?: string | null;
    retreatCost?: number | null;
    regulationMark?: string | null;
    dexId?: number | null;
    flavorText?: string | null;
  } | null;
}

/** Eror där ETB:n bär 9 paket (tidigare eror 8). Matchar `CardSet.series`. */
const NINE_PACK_ERAS = new Set(["Scarlet & Violet", "Mega Evolution"]);
const EIGHT_PACK_ERAS = new Set(["Sword & Shield", "Sun & Moon", "XY"]);
/** Eror där familjereglerna för tins/blisters/collections är verifierade. */
const MODERN_ERAS = NINE_PACK_ERAS;

const isPokemonCenter = (title: string) => /pok[eé]mon center/i.test(title);
const L = (qty: number, key: ContentsKey): ContentsLine => ({ qty, key });

/**
 * ETB-innehållet per era, ur tillverkarens produktsidor (2026-09-22):
 *  · Mega Evolution: 9 paket, 1 full-art-promo, 65 sleeves, 40 energi, 6 tärningar,
 *    myntkast-tärning, plastmynt, guide, 6 avdelare, kodkort (pokemon.com, ME-ETB).
 *  · Scarlet & Violet: 9 paket, 1 full-art-promo, 65 sleeves, 45 energi, 6 tärningar,
 *    myntkast-tärning, 2 tillståndsmarkörer, guide, 4 avdelare, kodkort
 *    (pokemon.com, Surging Sparks-ETB; Bulbapedia S&V-merchandise).
 *  · SWSH/SM: 8 paket, 65 sleeves, 45 energi, 6 tärningar, myntkast-tärning,
 *    2 markörer, guide, 4 avdelare, kodkort — promokortet varierade per set och
 *    listas därför inte. XY: samma utan avdelare.
 * Pokémon Center-utgåvan bär två paket extra och (S&V/ME) en promo till.
 * Specialutgåvor (30th Celebration: foliaenergier, skademarkörer) ligger i den
 * kurerade tabellen och vinner över det här.
 */
function etbContents(series: string, title: string): ContentsLine[] | null {
  const pc = isPokemonCenter(title);
  if (series === "Mega Evolution") {
    return [
      L(pc ? 11 : 9, "boosters"),
      L(pc ? 2 : 1, "promoCard"),
      L(65, "sleeves"),
      L(40, "energyCards"),
      L(6, "damageDice"),
      L(1, "coinDie"),
      L(1, "coin"),
      L(1, "playersGuide"),
      L(6, "dividers"),
      L(1, "codeCard"),
    ];
  }
  if (series === "Scarlet & Violet") {
    return [
      L(pc ? 11 : 9, "boosters"),
      L(pc ? 2 : 1, "promoCard"),
      L(65, "sleeves"),
      L(45, "energyCards"),
      L(6, "damageDice"),
      L(1, "coinDie"),
      L(2, "conditionMarkers"),
      L(1, "playersGuide"),
      L(4, "dividers"),
      L(1, "codeCard"),
    ];
  }
  if (EIGHT_PACK_ERAS.has(series)) {
    const lines = [
      L(pc ? 10 : 8, "boosters"),
      L(65, "sleeves"),
      L(45, "energyCards"),
      L(6, "damageDice"),
      L(1, "coinDie"),
      L(2, "conditionMarkers"),
      L(1, "playersGuide"),
    ];
    if (series !== "XY") lines.push(L(4, "dividers"));
    lines.push(L(1, "codeCard"));
    return lines;
  }
  return null;
}

/**
 * Japanska boxar efter setkoden i setnamnet ("Storm Emeralda (M6)"), verifierat
 * 2026-09-22 mot återförsäljarnas produktsidor (Ninja Spinner M4 = 30, Mega Brave
 * M1L = 30, Wild Force SV5K = 30, White Flare SV11W = 20, Black Bolt SV11B = 20,
 * 30th Celebration M6a = 20, Pokémon GO s10b = 20, Terastal Festival SV8a = 10,
 * Shiny Treasure SV4a = 10, Mega Dream M2a = 10):
 *  · huvudset (kod utan suffix, eller parsplit-suffix V/S/D/P/K/M/H/L) = 30 paket
 *  · "a"/"b"/"W"/"B"-suffix (enhanced/deluxe) = 20 paket
 *  · high class-set = 10 paket (namnlista — koden säger inte vilket)
 * Ingen kod i namnet ⇒ null.
 */
const JP_HIGH_CLASS = /shiny treasure|terastal fest|mega dream|vstar universe|vmax climax|tag all stars|ultra shiny|shiny star v|high class/i;
export function jpBoosterBoxPacks(setName: string): number | null {
  if (JP_HIGH_CLASS.test(setName)) return 10;
  const m = /\(([A-Za-z]+\d+)([A-Za-z]?)\)\s*$/.exec(setName);
  if (!m) return null;
  const suffix = m[2];
  if (suffix === "") return 30;
  if (/^[abwABW]$/.test(suffix)) return 20;
  if (/^[VSDPKMHL]$/.test(suffix)) return 30;
  return null;
}

/** Antal paket i en blister ur titeln; okänt ⇒ null (aldrig gissat). */
function blisterPacks(title: string): number | null {
  if (/\b3[\s-]?pack\b|\bthree[\s-]?(pack|booster)|\btriple\b/i.test(title)) return 3;
  if (/\b2[\s-]?pack\b|\btwo[\s-]?(pack|booster)/i.test(title)) return 2;
  if (/\b(1|single|checklane)[\s-]?(pack|booster)\b|\bsleeved booster\b/i.test(title)) return 1;
  return null;
}

/**
 * Innehåll per kategori/familj. Källor (2026-09-22): pokemon.com:s produkt-
 * visningar för Mega Evolution, Ascended Heroes och 30th Celebration; Bulbapedias
 * merchandise-sidor för S&V- och ME-serien; pokemon.com:s sidor för Poké Ball-tin
 * och Shrouded Fable mini tin.
 *  · Booster box EN = 36 paket (alla eror); "Enhanced" = 36 + 1 stämplad promo (ME).
 *  · Booster bundle = 6 paket (SWSH/S&V/ME).
 *  · 3-pack blister = 3 paket + 1 promo (+ kodkort); 2-pack blister/collection (ME)
 *    = 2 paket + 1 promo + 1 mynt; 1-pack blister (S&V/ME) = 1 paket + 1 promo +
 *    1 jumbomynt; sleeved booster = 1 paket. Premium checklane varierar ⇒ null.
 *  · Mini tin (S&V/ME) = 2 paket + 1 klistermärkesark + 1 konstkort.
 *  · Poké Ball-tin (alla bollar) = 3 paket + 2 klistermärkesark.
 *  · ex-tin (S&V/ME) = 1 promo + 4 paket + kodkort; ex-box = 1 promo + 1 jumbo + 4 paket.
 *  · Tech sticker collection = 1 promo + 1 tech sticker-ark + 3 paket.
 *  · First Partner Illustration Collection = 1 promopaket (3 promos) + 2 paket + 1 ark.
 *  · Build & Battle box = 1 lek (40 kort) + 1 promo + 4 paket + kodkort.
 */
export function sealedContents(input: Pick<FactsInput, "category" | "language" | "title" | "set">): ContentsLine[] | null {
  const series = input.set?.series ?? "";
  const title = input.title;
  const modern = MODERN_ERAS.has(series);
  switch (input.category) {
    case "ETB":
      return etbContents(series, title);
    case "BOOSTER_BOX": {
      if (/mini tin display|blister display|collection display|half booster display/i.test(title)) return null;
      if (input.language === "JP") {
        // "Enhanced expansion pack" i titeln = 20 paket även när setnamnet saknar kod (Pokémon GO s10b).
        const packs = /enhanced expansion/i.test(title) ? 20 : input.set?.name ? jpBoosterBoxPacks(input.set.name) : null;
        return packs ? [L(packs, "boosters")] : null;
      }
      if (input.language !== "EN") return null;
      return /enhanced/i.test(title) ? [L(36, "boosters"), L(1, "promoCard")] : [L(36, "boosters")];
    }
    case "BUNDLE":
      if (/build\s*&\s*battle box/i.test(title) && modern)
        return [L(1, "deck"), L(1, "promoCard"), L(4, "boosters"), L(1, "codeCard")];
      return /booster bundle/i.test(title) && (modern || series === "Sword & Shield") ? [L(6, "boosters")] : null;
    case "BLISTER": {
      if (/premium checklane/i.test(title)) return null;
      const packs = blisterPacks(title);
      if (packs == null) return null;
      if (/sleeved/i.test(title)) return [L(1, "boosters")];
      if (!modern) return null;
      if (packs === 3) return [L(3, "boosters"), L(1, "promoCard"), L(1, "codeCard")];
      if (packs === 2) return series === "Mega Evolution" ? [L(2, "boosters"), L(1, "promoCard"), L(1, "coin")] : null;
      return [L(1, "boosters"), L(1, "promoCard"), L(1, "coin")];
    }
    case "BOOSTER_PACK":
      return [L(1, "boosters")];
    case "TIN": {
      if (/display|bundle/i.test(title)) return null;
      if (/mini tin/i.test(title)) return modern ? [L(2, "boosters"), L(1, "stickerSheet"), L(1, "artCard")] : null;
      if (/\bball tin\b/i.test(title)) return [L(3, "boosters"), L(2, "stickerSheet")];
      if (/\bex tin\b|ex tins?:/i.test(title)) return modern ? [L(1, "promoCard"), L(4, "boosters"), L(1, "codeCard")] : null;
      return null;
    }
    case "COLLECTION_BOX": {
      if (/tech sticker collection/i.test(title)) return modern ? [L(1, "promoCard"), L(1, "techStickerSheet"), L(3, "boosters")] : null;
      if (/first partner illustration collection/i.test(title)) return [L(1, "promoPack"), L(2, "boosters"), L(1, "stickerSheet")];
      if (/\bex box\b/i.test(title)) return modern ? [L(1, "promoCard"), L(1, "oversizeCard"), L(4, "boosters")] : null;
      if (/knock out collection|2-pack blister/i.test(title)) return series === "Mega Evolution" ? [L(2, "boosters"), L(1, "promoCard"), L(1, "coin")] : null;
      return null;
    }
    default:
      return null;
  }
}

const toIso = (d: Date | string | null | undefined): string | null =>
  d == null ? null : typeof d === "string" ? d : d.toISOString();

/**
 * Bygger faktablocket. Returnerar null när det inte finns NÅGOT att visa
 * (varken kortfält, innehåll eller setfakta) — panelen renderas då inte alls.
 */
export function buildProductFacts(input: FactsInput): ProductFacts | null {
  const card: CardFacts | null =
    input.category === "SINGLE_CARD" && input.card
      ? {
          artist: input.card.artist || null,
          rarity: input.card.rarity || null,
          stage: input.card.subtype || null,
          hp: input.card.hp ?? null,
          number: input.card.number,
          printedTotal: input.set?.totalCards ?? 0,
          types: input.card.types ?? [],
          weakness: input.card.weaknessType
            ? { type: input.card.weaknessType, value: input.card.weaknessValue ?? null }
            : null,
          retreatCost: input.card.retreatCost ?? null,
          regulationMark: input.card.regulationMark || null,
          dexId: input.card.dexId ?? null,
          flavorText: input.card.flavorText || null,
        }
      : null;
  const contents = card ? null : ((input.slug ? curatedContents(input.slug) : null) ?? sealedContents(input));
  const setCards =
    input.set && input.set.totalCards > 0
      ? { printed: input.set.totalCards, full: input.set.totalCardsFull }
      : null;
  const facts: ProductFacts = {
    card,
    contents,
    series: input.set?.series || null,
    releaseDate: toIso(input.releaseDate) ?? toIso(input.set?.releaseDate),
    setCards,
    language: input.language,
  };
  // Hellre ingen panel än en gles — setraden ensam räddar den inte (ägaren
  // 2026-09-22: en "I lådan" med bara serie/datum såg trasig ut).
  if (card) return countCardFacts(card) >= MIN_CARD_FACTS ? facts : null;
  if (!contents || contents.length === 0) return null;
  return facts;
}
