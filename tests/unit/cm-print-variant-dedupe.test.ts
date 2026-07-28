import { describe, it, expect } from "vitest";
import { MATCH_RANK, feedRowWins, printRank } from "../../src/jobs/cardmarket-refresh";
import { matchListingToProduct } from "../../src/scrapers/matching";
import {
  listingPriceIsPlausible,
  visibleListings,
  MARKETPLACE_MIN_PRICE_RATIO,
} from "../../src/lib/listing-plausibility";

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

// Regression 2026-07-28: valet ovan gjorde svaret DETERMINISTISKT men avgjorde med
// flit inte VILKEN tryckning katalogen ska visa — och tcgid-raden är i alla tio
// WOTC-episoderna 1st Edition. Ponyta publicerades därför som 292,56 kr (1st Edition
// Shadowless, 26,50 €) fast vår katalogpost är det ordinarie kortet. Uppmätt över
// episoderna: 1st Edition-rader har lowest_near_mint i 95 % av fallen, Unlimited i
// 18 % → den dyra raden vann nästan alltid.
describe("printRank + feedRowWins — tryckningen är identitet", () => {
  it("1st Edition rankas under Shadowless, som rankas under Unlimited/omärkt", () => {
    expect(printRank("1st Edition")).toBe(0);
    expect(printRank("1st Edition Shadowless")).toBe(0); // får ALDRIG läsas som Shadowless
    expect(printRank("Shadowless")).toBe(1);
    expect(printRank("Unlimited")).toBe(2);
    expect(printRank(null)).toBe(2);
    expect(printRank("Reverse Holo")).toBe(2); // moderna etiketter påverkas inte
  });

  it("Ponyta · Base 60: Shadowless-raden tar över från 1st Edition Shadowless", () => {
    const firstEd = { rank: MATCH_RANK.tcgid, cmid: 660167, print: printRank("1st Edition Shadowless"), from: true };
    const shadowless = { rank: MATCH_RANK.number, cmid: 660167, print: printRank("Shadowless"), from: true };
    // Tryckningen slår nyckelstyrkan, och svaret är detsamma oavsett svarsordning.
    expect(feedRowWins(firstEd, shadowless)).toBe(true);
    expect(feedRowWins(shadowless, firstEd)).toBe(false);
  });

  it("Unlimited slår Shadowless när båda har ett äkta From", () => {
    const shadowless = { rank: MATCH_RANK.number, cmid: 660167, print: 1, from: true };
    const unlimited = { rank: MATCH_RANK.number, cmid: null, print: 2, from: true };
    expect(feedRowWins(shadowless, unlimited)).toBe(true);
    expect(feedRowWins(unlimited, shadowless)).toBe(false);
  });

  it("⛔ rätt tryckning UTAN äkta From får inte ta över — det aktiverar uppskattningen", () => {
    // Sabrina's Gaze · Gym Heroes 125 gick 0,55 € → 434,04 € i torrkörning när en
    // Unlimited-rad utan From vann och guide-medianen på fel cardmarket_id tog vid.
    const firstEdWithFrom = { rank: MATCH_RANK.tcgid, cmid: 1, print: 0, from: true };
    const unlimitedEstimate = { rank: MATCH_RANK.number, cmid: 2, print: 2, from: false };
    expect(feedRowWins(firstEdWithFrom, unlimitedEstimate)).toBe(false);
    expect(feedRowWins(unlimitedEstimate, firstEdWithFrom)).toBe(true);
  });

  it("okänt from-fält får inte läsas som 'saknar From' (regression: fältet låg i op)", () => {
    // Kandidaten i `claimed` bar `from` inne i `op`, så feedRowWins läste
    // `current.from` som undefined. Då blev `!wrongHasFrom` sant och Unlimited-radens
    // 30d-uppskattning vann över 1st Edition-radens riktiga From: Sabrina's Gaze ·
    // Gym Heroes 125 skrevs 0,55 € → 434,04 € i produktion 2026-07-27.
    const claimedWithoutFrom = { rank: MATCH_RANK.tcgid, cmid: 274261, print: 0 };
    const unlimitedEstimate = { rank: MATCH_RANK.number, cmid: null, print: 2, from: false };
    // Utan bevis för att den sittande raden saknar From får en uppskattning inte ta över.
    expect(feedRowWins(claimedWithoutFrom, unlimitedEstimate)).toBe(false);
  });

  it("saknar BÅDA äkta From → faller igenom till nyckelkedjan, tryckningen avgör inte", () => {
    // Två uppskattningar: ingen av dem är ett bevisat marknadspris, så vi låter
    // starkaste nyckeln bestämma precis som före tryckningsregeln.
    const firstEd = { rank: MATCH_RANK.tcgid, cmid: 1, print: 0, from: false };
    const unlimited = { rank: MATCH_RANK.number, cmid: 2, print: 2, from: false };
    expect(feedRowWins(firstEd, unlimited)).toBe(false);
    expect(feedRowWins(unlimited, firstEd)).toBe(true);
  });

  it("samma tryckning → oförändrad kedja (nyckel, sedan lägsta cardmarket_id)", () => {
    const a = { rank: MATCH_RANK.number, cmid: 500, print: 2, from: true };
    const b = { rank: MATCH_RANK.tcgid, cmid: 900, print: 2, from: true };
    expect(feedRowWins(a, b)).toBe(true);
    expect(feedRowWins(b, a)).toBe(false);
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

// Mätt på prod 2026-07-27: den råa gränsen hade tömt karusellen HELT på 17 produkter,
// samtliga vintage-commons där VÅR referens är fel tryckning (Gust of Wind · Base
// 93/102: CM-golv 494 kr = 1st Edition Shadowless, tjugo Tradera-annonser på det
// ordinarie kortet 5–9 kr). Att döma bort tjugo av tjugo är inget outlier-filter.
describe("matchListingToProduct — tillbehör är inte varan", () => {
  const megaDarkrai = {
    normalizedTitle: "mega darkrai ex pitch black 116 84",
    card: { name: "Mega Darkrai ex", number: "116" },
  };

  it("ramen matchar inte kortet den rymmer", () => {
    expect(
      matchListingToProduct("Mega Darkrai ex 116/084 Extended Artwork-ram för Pokémonkort", megaDarkrai)
    ).toBeNull();
  });

  it("den äkta annonsen matchar fortfarande", () => {
    expect(matchListingToProduct("Mega Darkrai ex 116/084 - Pitch Black - Pokemonkort", megaDarkrai)).not.toBeNull();
  });
});

describe("visibleListings — dölj utstickare, aldrig hela marknaden", () => {
  it("ramen döljs när de äkta annonserna finns kvar", () => {
    const rows = [{ price: 17_900 }, { price: 405_000 }, { price: 449_500 }, { price: 500_000 }];
    expect(visibleListings(rows, 320_740).map((r) => r.price)).toEqual([405_000, 449_500, 500_000]);
  });

  it("faller ALLA annonser är det referensen som är misstänkt — visa dem", () => {
    const rows = [{ price: 500 }, { price: 700 }, { price: 900 }];
    expect(visibleListings(rows, 49_400)).toHaveLength(3);
  });

  it("utan facit visas allt", () => {
    const rows = [{ price: 500 }, { price: 700 }];
    expect(visibleListings(rows, null)).toHaveLength(2);
  });

  it("tom lista förblir tom", () => {
    expect(visibleListings([], 1000)).toEqual([]);
  });
});
