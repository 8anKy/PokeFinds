/**
 * KURERAT INNEHÅLL PER FÖRSEGLAD PRODUKT — vad som ligger i lådan, nyckelat på
 * produktens slug. Vinner över familjereglerna i `lib/product-facts.ts`.
 *
 * ⛔ REGLER (ägarbeslut 2026-09-22):
 *   · Varje post bär en KÄLLA: tillverkarens egen produktvisning (pokemon.com
 *     "Product Showcase"/product-gallery) i första hand, Bulbapedias merchandise-
 *     sidor eller återförsäljarnas produktsidor med tillverkarens lista i andra.
 *     Skriv aldrig en rad du inte sett i källan — hellre en kortare lista.
 *   · Ingen LLM, ingen butiksbeskrivning: tabellen fylls FÖR HAND.
 *   · Bara RÄKNADE saker blir rader (`{qty, key}`); "card sleeves" utan tal
 *     lämnas ute. Nya sorter ⇒ ny `ContentsKey` + rad i `Detail.contents.*`
 *     i BÅDA språkfilerna.
 *   · Ett byte av slug (katalogens sammanslagningar) tappar raden tyst —
 *     `tests/unit/product-facts.test.ts` vaktar att nycklarna ser ut som slugs,
 *     inte att produkterna finns. Kör `scripts/audit-sealed-contents.ts` för
 *     att se vilka som saknar produkt.
 */

import type { ContentsKey, ContentsLine } from "@/lib/product-facts";

interface CuratedEntry {
  /** URL till källan (för granskning — visas inte). */
  source: string;
  lines: ContentsLine[];
}

const L = (qty: number, key: ContentsKey): ContentsLine => ({ qty, key });

const SHOWCASE_30TH = "https://www.pokemon.com/us/news/pokemon-tcg-30th-celebration-product-showcase";
const SHOWCASE_ASCENDED = "https://www.pokemon.com/us/pokemon-news/pokemon-tcg-mega-evolution-ascended-heroes-product-showcase";
const BULBAPEDIA_ME = "https://bulbapedia.bulbagarden.net/wiki/Mega_Evolution_TCG_Series_merchandise";

export const CURATED_SEALED_CONTENTS: Record<string, CuratedEntry> = {
  // ── 30th Celebration (pokemon.com product showcase, 2026-09) ──────────────
  "30th-celebration-elite-trainer-box": {
    source: SHOWCASE_30TH,
    lines: [
      L(9, "boosters"),
      L(1, "promoCard"),
      L(65, "sleeves"),
      L(16, "foilEnergyCards"),
      L(1, "damageCounters"),
      L(1, "coinDie"),
      L(1, "coin"),
      L(1, "playersGuide"),
    ],
  },
  "30th-celebration-pokemon-center-elite-trainer-box": {
    source: SHOWCASE_30TH,
    lines: [
      L(11, "boosters"),
      L(2, "promoCard"),
      L(65, "sleeves"),
      L(16, "foilEnergyCards"),
      L(1, "damageCounters"),
      L(1, "coinDie"),
      L(1, "coin"),
      L(1, "playersGuide"),
    ],
  },
  "30th-celebration-eevee-2-pack-blister": {
    // = "Knock Out Collection" i tillverkarens visning.
    source: SHOWCASE_30TH,
    lines: [L(1, "promoCard"), L(1, "coin"), L(2, "boosters")],
  },
  "30th-celebration-knock-out-collection": {
    source: SHOWCASE_30TH,
    lines: [L(1, "promoCard"), L(1, "coin"), L(2, "boosters")],
  },
  "30th-celebration-poster-collection": {
    source: SHOWCASE_30TH,
    lines: [L(1, "poster"), L(3, "promoCard"), L(3, "boosters")],
  },
  "30th-celebration-binder-collection": {
    source: SHOWCASE_30TH,
    lines: [L(1, "binder"), L(5, "boosters")],
  },
  "30th-celebration-ditto-premium-collection": {
    source: SHOWCASE_30TH,
    lines: [L(1, "promoCard"), L(1, "acrylicDisplay"), L(8, "boosters")],
  },
  "30th-celebration-espeon-ultra-premium-collection": {
    source: SHOWCASE_30TH,
    lines: [L(29, "boosters"), L(1, "classicPack"), L(1, "playmat"), L(1, "deckBox")],
  },
  "30th-celebration-umbreon-ultra-premium-collection": {
    source: SHOWCASE_30TH,
    lines: [L(29, "boosters"), L(1, "classicPack"), L(1, "playmat"), L(1, "deckBox")],
  },
  "pokemon-30th-celebration-ultra-premium-collection-eng": {
    source: SHOWCASE_30TH,
    lines: [L(29, "boosters"), L(1, "classicPack"), L(1, "playmat"), L(1, "deckBox")],
  },
  "30th-celebration-mew-figure-collection": {
    source: SHOWCASE_30TH,
    lines: [L(1, "promoCard"), L(1, "oversizeCard"), L(1, "figure"), L(5, "boosters")],
  },
  "30th-celebration-mewtwo-figure-collection": {
    source: SHOWCASE_30TH,
    lines: [L(1, "promoCard"), L(1, "oversizeCard"), L(1, "figure"), L(5, "boosters")],
  },

  // ── Mega Evolution — Ascended Heroes (pokemon.com product showcase) ──────
  "pokemon-tcg-ascended-heroes-first-partners-deluxe-pin-collection-iphwh": {
    source: SHOWCASE_ASCENDED,
    lines: [L(3, "promoCard"), L(1, "pin"), L(5, "boosters")],
  },
  "ascended-heroes-mega-gardevoir-premium-poster-collection": {
    source: SHOWCASE_ASCENDED,
    lines: [L(1, "promoCard"), L(10, "boosters"), L(1, "poster")],
  },
  "ascended-heroes-mega-lucario-premium-poster-collection": {
    source: SHOWCASE_ASCENDED,
    lines: [L(1, "promoCard"), L(10, "boosters"), L(1, "poster")],
  },

  // ── Mega Evolution-serien, övriga (Bulbapedia ME-merchandise / pokemon.com) ─
  "pokemon-tcg-mega-charizard-x-ex-ultra-premium-collection-iphxj": {
    source: BULBAPEDIA_ME,
    lines: [
      L(2, "promoCard"),
      L(1, "playmat"),
      L(1, "deckBox"),
      L(65, "sleeves"),
      L(1, "coin"),
      L(6, "damageDice"),
      L(18, "boosters"),
      L(1, "codeCard"),
    ],
  },
  "mega-lucario-ex-figure-collection": {
    source: BULBAPEDIA_ME,
    lines: [L(1, "promoCard"), L(1, "oversizeCard"), L(1, "figure"), L(5, "boosters"), L(1, "codeCard")],
  },
  "pokemon-tcg-mega-zygarde-ex-premium-collection-iphx6": {
    source: "https://www.pokemon.com/us/pokemon-tcg/product-gallery/mega-zygarde-ex-premium-collection",
    lines: [L(1, "promoCard"), L(1, "oversizeCard"), L(1, "techStickerSheet"), L(8, "boosters")],
  },
  "mega-greninja-ex-premium-collection": {
    source: "https://www.pokemon.com/us/pokemon-tcg/product-gallery/mega-greninja-ex-premium-collection",
    lines: [L(1, "promoCard"), L(1, "oversizeCard"), L(1, "techStickerSheet"), L(8, "boosters")],
  },

  // ── Scarlet & Violet-serien (pokemon.com product-gallery) ────────────────
  "prismatic-evolutions-super-premium-collection": {
    source: "https://www.pokemon.com/us/pokemon-tcg/product-gallery/scarlet-violet-prismatic-evolutions-super-premium-collection",
    lines: [L(1, "promoCard"), L(1, "deckBox"), L(1, "playmat"), L(65, "sleeves"), L(15, "boosters"), L(1, "codeCard")],
  },
  "prismatic-evolutions-premium-figure-collection": {
    source: "https://www.pokemon.com/us/pokemon-tcg/product-gallery/scarlet-violet-prismatic-evolutions-premium-figure-collection",
    lines: [L(2, "promoCard"), L(1, "figure"), L(1, "pin"), L(65, "sleeves"), L(11, "boosters"), L(1, "codeCard")],
  },
  "151-ultra-premium-collection": {
    source: "https://www.pokemon.com/us/pokemon-tcg/product-gallery/scarlet-violet-151-ultra-premium-collection",
    lines: [
      L(3, "promoCard"),
      L(1, "playmat"),
      L(1, "deckBox"),
      L(1, "coin"),
      L(6, "damageDice"),
      L(2, "conditionMarkers"),
      L(16, "boosters"),
      L(1, "codeCard"),
    ],
  },
};

export function curatedContents(slug: string): ContentsLine[] | null {
  return CURATED_SEALED_CONTENTS[slug]?.lines ?? null;
}
