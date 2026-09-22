/**
 * PRODUKTFAKTA — det som fyller ytan under bilden på desktop (`ProductFactsPanel`).
 *
 * Ren modul: inga DB-anrop, inga översättningar. Returnerar NYCKLAR + tal, panelen
 * översätter. Två sorter:
 *
 *   · KORT (`card`): illustratör, sällsynthet, stadie, HP, nummer — det vi redan
 *     bär i `Card`. Fält vi saknar visas inte (ingen "–"-rad: en tom rad är en
 *     yta, inte information).
 *   · FÖRSEGLAT (`contents`): vad som ligger i lådan, ur en ERA-TABELL per
 *     produkttyp. ⛔ Tabellen listar BARA format vars innehåll är detsamma för
 *     hela eran (ETB, booster box, bundle, blister). Collection boxes och tins
 *     varierar per produkt och får INGET innehåll härifrån — hellre ingen lista
 *     än en påhittad. En rad med okänt antal skrivs aldrig ("inga fabricerade
 *     priser/data" gäller antal också).
 *
 * `Product.description` (fritext) är en separat sak och rör inte det här.
 */

import type { CardLanguage, ProductCategory } from "@prisma/client";

/** En innehållsrad: antal + etikettnyckel (översätts i `Detail.contents.*`). */
export interface ContentsLine {
  qty: number;
  key: ContentsKey;
}

export type ContentsKey =
  | "boosters"
  | "sleeves"
  | "energyCards"
  | "damageDice"
  | "coinDie"
  | "conditionMarkers"
  | "playersGuide"
  | "codeCard"
  | "dividers"
  | "promoCard";

export interface CardFacts {
  artist: string | null;
  rarity: string | null;
  /** "Basic" / "Stage 1" / "Trainer" — kortets subtype ur källan. */
  stage: string | null;
  hp: number | null;
  number: string;
  /** Tryckt total (talet på kortet), 0 = okänt. */
  printedTotal: number;
}

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
  category: ProductCategory;
  language: CardLanguage;
  title: string;
  releaseDate: Date | string | null;
  set: {
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
  } | null;
}

/** Eror där ETB:n bär 9 paket (tidigare eror 8). Matchar `CardSet.series`. */
const NINE_PACK_ERAS = new Set(["Scarlet & Violet", "Mega Evolution"]);
const EIGHT_PACK_ERAS = new Set(["Sword & Shield", "Sun & Moon", "XY"]);

const isPokemonCenter = (title: string) => /pok[eé]mon center/i.test(title);

/**
 * ETB-innehållet per era. Pokémon Center-utgåvan bär två paket extra (11 resp. 10)
 * och samma tillbehör. Övriga eror (Base–BW) hade inga ETB:er eller andra format —
 * null, ingen lista.
 */
function etbContents(series: string, title: string): ContentsLine[] | null {
  let boosters: number | null = null;
  if (NINE_PACK_ERAS.has(series)) boosters = isPokemonCenter(title) ? 11 : 9;
  else if (EIGHT_PACK_ERAS.has(series)) boosters = isPokemonCenter(title) ? 10 : 8;
  if (boosters == null) return null;
  return [
    { qty: boosters, key: "boosters" },
    { qty: 65, key: "sleeves" },
    { qty: 45, key: "energyCards" },
    { qty: 6, key: "damageDice" },
    { qty: 1, key: "coinDie" },
    { qty: 2, key: "conditionMarkers" },
    { qty: 1, key: "playersGuide" },
    { qty: 1, key: "codeCard" },
    { qty: 4, key: "dividers" },
  ];
}

/** Antal paket i en blister ur titeln; okänt ⇒ null (aldrig gissat). */
function blisterPacks(title: string): number | null {
  if (/\b3[\s-]?pack\b|\btriple\b/i.test(title)) return 3;
  if (/\b(1|single|checklane)[\s-]?(pack|booster)\b|\bsleeved booster\b/i.test(title)) return 1;
  return null;
}

/**
 * Innehåll per kategori. Engelska booster boxes bär 36 paket i alla eror sedan
 * Base; japanska boxar varierar (30/20/10) ⇒ bara EN. Bundles = 6 paket sedan
 * SWSH; äldre "bundle"-produkter är annat ⇒ null utanför de erorna.
 */
export function sealedContents(input: Pick<FactsInput, "category" | "language" | "title" | "set">): ContentsLine[] | null {
  const series = input.set?.series ?? "";
  switch (input.category) {
    case "ETB":
      return etbContents(series, input.title);
    case "BOOSTER_BOX":
      return input.language === "EN" ? [{ qty: 36, key: "boosters" }] : null;
    case "BUNDLE":
      return /booster bundle/i.test(input.title) && (NINE_PACK_ERAS.has(series) || series === "Sword & Shield")
        ? [{ qty: 6, key: "boosters" }]
        : null;
    case "BLISTER": {
      const packs = blisterPacks(input.title);
      if (packs == null) return null;
      // Blister = paket + promokort i alla moderna eror; 1-pack utan promo finns
      // (sleeved booster) ⇒ promoraden bara när titeln inte säger sleeved.
      const lines: ContentsLine[] = [{ qty: packs, key: "boosters" }];
      if (!/sleeved/i.test(input.title)) lines.push({ qty: 1, key: "promoCard" });
      return lines;
    }
    case "BOOSTER_PACK":
      return [{ qty: 1, key: "boosters" }];
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
        }
      : null;
  const contents = card ? null : sealedContents(input);
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
  const hasCard = !!card && (card.artist || card.rarity || card.hp != null || card.stage);
  if (!hasCard && !contents && !facts.series && !facts.releaseDate && !setCards) return null;
  return facts;
}
