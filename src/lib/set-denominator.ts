/**
 * NÄMNARNA för set-komplettering. Ren modul: ingen Prisma, inga anrop, testbar.
 *
 * ⛔ TRE TAL OM ETT SET, OCH DE BLANDAS ALDRIG:
 *
 *  1. TRYCKT SET  (`printed`)   = `CardSet.totalCards` = pokemontcg.io `printedTotal`.
 *     Talet som står på kortet ("12/84"). Skannern jämför numret den läst mot exakt
 *     det här (`services/scanner/index.ts`) och `cardNumberLabel` skriver ut det på
 *     varje produktkort. ⛔ ANVÄNDS ALDRIG SOM NÄMNARE för komplettering: 107 av 176
 *     engelska set har secret rares, och att mäta mot det tryckta talet gav "120 av
 *     84" i produktion.
 *
 *  2. FULLT SET   (`full`)      = max(`totalCardsFull`, vårt kortantal).
 *     Varje KORT i setet, inklusive secret rares. Det här är kompletteringens nämnare.
 *     ⛔ `max()`, inte "uppströms om det finns": mätt 2026-08-20 har SEX set FLER kort
 *     hos oss än pokemontcg.io:s `/sets.total` (sve +8, svp +4, sm10 +4, sm11 +1,
 *     smp +1, xy7 +1) — deras `total` är helt enkelt inaktuell för växande promo- och
 *     energiset. Åt andra hållet: är VÅR lista kortare vet vi det bara tack vare
 *     `totalCardsFull`. Båda riktningarna måste rymmas i ett tal.
 *
 *  3. MASTER SET  (`printings`) = antalet TRYCKNINGAR vi listar (kort × versioner).
 *     ⛔ Nämnaren är VÅR katalog, aldrig TCGdex tal. Skälet är inte att deras data är
 *     dålig utan att en nämnare användaren inte kan NÅ är en lögn om deras samling:
 *     äger man varenda tryckning vi säljer ska raden säga så. TCGdex-talet
 *     (`printingsTotal`) används enbart för den ärliga noten "setet har 410
 *     tryckningar — vi listar 302 av dem", aldrig i en procent. Därför kan en lucka
 *     hos dem aldrig producera ett felaktigt procenttal hos oss.
 *
 * ⛔ 0 BETYDER OKÄNT OCH RETURNERAS SOM `null`. "0 av 0" och "0 %" är påståenden vi
 * inte kan backa. 95 japanska set har noll kort hos oss och hamnar här — de får
 * ingen stapel alls, hellre än en tom.
 */

export interface SetTotalsInput {
  /** `CardSet.totalCards` — printedTotal. 0 = okänt. */
  totalCards: number;
  /** `CardSet.totalCardsFull` — pokemontcg.io `total`. 0 = okänt. */
  totalCardsFull: number;
  /** Antal Card-rader vi själva har i setet. */
  cardCount: number;
  /** Antal distinkta tryckningar vi listar (kort + varianter). 0 = vi listar inga. */
  listedPrintings?: number;
  /** `CardSet.printingsTotal` — TCGdex facit för antal tryckningar. 0 = okänt. */
  printingsTotal?: number;
}

export interface SetTotals {
  /** Kompletteringens nämnare. null = vi vet inte ⇒ rita ingenting. */
  full: number | null;
  /** Talet på korten. null = okänt. ⛔ Aldrig en nämnare. */
  printed: number | null;
  /** Master set-nämnaren = tryckningar VI listar. null = vi listar inga. */
  printings: number | null;
  /** true när setet bevisligen har fler KORT än vi listar ⇒ lova aldrig "allt". */
  catalogShort: boolean;
  /**
   * Antal tryckningar setet har enligt TCGdex när det är FLER än vi listar.
   * null = okänt eller så listar vi alla. Visas som en not, aldrig som nämnare.
   */
  printingsElsewhere: number | null;
}

export function resolveSetTotals(s: SetTotalsInput): SetTotals {
  const full = Math.max(s.totalCardsFull, s.cardCount);
  const listed = s.listedPrintings ?? 0;
  const upstream = s.printingsTotal ?? 0;
  return {
    full: full > 0 ? full : null,
    printed: s.totalCards > 0 ? s.totalCards : null,
    printings: listed > 0 ? listed : null,
    catalogShort: s.totalCardsFull > s.cardCount,
    printingsElsewhere: upstream > listed && listed > 0 ? upstream : null,
  };
}

/**
 * Procent, klampad 0–100. ⛔ `null` in ⇒ `null` ut — aldrig 0. Klampen är ett
 * bälte, inte en förklaring: med `full` som nämnare kan `owned > full` inte längre
 * uppstå i normalfallet, men en katalogimport som halkar efter ska inte kunna visa
 * 104 %.
 */
export function completionPercent(owned: number, total: number | null): number | null {
  if (total == null || total <= 0) return null;
  return Math.min(100, Math.max(0, Math.round((owned / total) * 100)));
}

/**
 * SAMMA UTTRYCK I SQL. Veckobrevet och achievement-svepet aggregerar över alla
 * användare i råa frågor och MÅSTE räkna identiskt med funktionen ovan — annars
 * delar vi ut "Fullt set" för ett set som webben visar som 94 %.
 *
 * Kräver att frågan joinar `CardSet AS s` och exponerar setets kortantal som `cnt`.
 *
 * ⚠️ ETT DOKUMENTERAT UNDANTAG: achievement-svepet lägger till villkoret
 * `s."totalCardsFull" > 0` OVANPÅ uttrycket, och ska göra det. Ett set utan
 * uppströmsfacit får `full = vårt kortantal`, så den som äger de tre kort vi
 * råkar lista står på "3 av 3". På webben är det rätt — procenten självkorrigerar
 * när katalogen växer. En UTMÄRKELSE självkorrigerar aldrig: svepet gör bara
 * INSERT, och ett falskt "Fullt set" ligger kvar för alltid. Sänk aldrig den
 * vakten för att "matcha webben".
 */
export const SET_FULL_TOTAL_SQL = `GREATEST(s."totalCardsFull", COALESCE(cnt, 0))`;
