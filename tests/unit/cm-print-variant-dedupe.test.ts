import { describe, it, expect } from "vitest";
import { MATCH_RANK, feedRowWins } from "../../src/jobs/cardmarket-refresh";
import { listingPriceIsPlausible, MARKETPLACE_MIN_PRICE_RATIO } from "../../src/lib/listing-plausibility";

// Regression 2026-07-27: en produkt prissattes av FLERA feed-rader samma körning.
// Vintage-episoder innehåller alla tryckningar av samma kortnummer, och promo-
// episoder flera CM-produkter av samma kort. Uppmätt i Base (episod 171), Ponyta 60:
//   "1st Edition Shadowless"  tcgid=base1-60  cmid=660167  From 26,50 €
//   "Shadowless"              tcgid=null      cmid=660167  From  4,29 €
//   "Unlimited"               tcgid=null      cmid=null    utan pris
// Den första matchade på tcgid, den andra på SET+NUMMER-reserven → båda skrev pris
// och historikpunkt på samma produkt. 305 singlar hade tärningskastat pris den dagen
// (Ponyta visade 292,56 kr ELLER 47,36 kr beroende på vilken skrivning som landade
// sist). Felet blev synligt först när sidantalet började läsas ur `paging.total` —
// dessförinnan låg de extra tryckningarna utanför de hämtade sidorna.

describe("feedRowWins — en produkt, en rad", () => {
  it("tcgid slår set+nummer-reserven (Ponyta · Base 60/102)", () => {
    const tcgidRow = { rank: MATCH_RANK.tcgid, cmid: 660167 };
    const numberRow = { rank: MATCH_RANK.number, cmid: 660167 };
    // Oavsett vilken ordning sidorna svarar i vinner samma rad.
    expect(feedRowWins(undefined, tcgidRow)).toBe(true);
    expect(feedRowWins(tcgidRow, numberRow)).toBe(false);
    expect(feedRowWins(numberRow, tcgidRow)).toBe(true);
  });

  it("cardmarket_id slår reserven men inte tcgid", () => {
    expect(feedRowWins({ rank: MATCH_RANK.cmid, cmid: 1 }, { rank: MATCH_RANK.number, cmid: 2 })).toBe(false);
    expect(feedRowWins({ rank: MATCH_RANK.cmid, cmid: 1 }, { rank: MATCH_RANK.tcgid, cmid: 2 })).toBe(true);
  });

  it("lika stark nyckel → lägsta cardmarket_id, aldrig svarsordningen", () => {
    const a = { rank: MATCH_RANK.tcgid, cmid: 427081 };
    const b = { rank: MATCH_RANK.tcgid, cmid: 547426 };
    expect(feedRowWins(a, b)).toBe(false);
    expect(feedRowWins(b, a)).toBe(true);
  });

  it("rad utan cardmarket_id förlorar mot en med, vid lika nyckel", () => {
    expect(feedRowWins({ rank: MATCH_RANK.number, cmid: 5 }, { rank: MATCH_RANK.number, cmid: null })).toBe(false);
    expect(feedRowWins({ rank: MATCH_RANK.number, cmid: null }, { rank: MATCH_RANK.number, cmid: 5 })).toBe(true);
  });

  it("första raden vinner alltid över ingenting", () => {
    expect(feedRowWins(undefined, { rank: MATCH_RANK.number, cmid: null })).toBe(true);
  });
});

// Regression 2026-07-26/27: "Mega Darkrai ex 116/084 Extended Artwork-ram för
// Pokémonkort" (179 kr) skrevs som skena-rad medan Pitch Black ännu saknade CM-data
// — utan referenspris finns ingen undre gräns, så vakten kunde inte döma. Dagen efter
// hade kortet ett CM-golv på 3 207 kr, offern städades bort manuellt, men karusellen
// visade ramen vidare eftersom skena-rader bara skrivs om när produkten namn-söks igen.
describe("listingPriceIsPlausible — läsvägens filter", () => {
  it("ramen (179 kr) faller mot CM-golvet 3 207 kr", () => {
    expect(listingPriceIsPlausible(17_900, 320_740)).toBe(false);
  });

  it("de äkta annonserna på samma kort behålls", () => {
    for (const ore of [405_000, 449_500, 500_000]) {
      expect(listingPriceIsPlausible(ore, 320_740)).toBe(true);
    }
  });

  it("utan facit döms ingenting (att gissa är just det som skrev ramen)", () => {
    expect(listingPriceIsPlausible(17_900, null)).toBe(true);
    expect(listingPriceIsPlausible(17_900, 0)).toBe(true);
  });

  it("gränsen ligger exakt på andelen, inte under", () => {
    const ref = 100_000;
    expect(listingPriceIsPlausible(ref * MARKETPLACE_MIN_PRICE_RATIO, ref)).toBe(true);
    expect(listingPriceIsPlausible(ref * MARKETPLACE_MIN_PRICE_RATIO - 1, ref)).toBe(false);
  });
});
