import { describe, it, expect } from "vitest";
import { parseEndedFromXml, soldByBidsOre, getItemVerdict } from "@/jobs/tradera-sold-sweep";
import {
  bucketObservationsBySource,
  medianOre,
  TRADERA_SOLD_SOURCE_NAME,
} from "@/services/products";

/** Bygger ett <Items>-block med Traderas egna fältnamn (kopierade ur ett riktigt svar). */
function item(fields: Record<string, string>): string {
  const inner = Object.entries(fields)
    .map(([k, v]) => `<${k}>${v}</${k}>`)
    .join("");
  return `<Items>${inner}</Items>`;
}

const SOLD = {
  Id: "743187136",
  ShortDescription: "Pokemon Destined Rivals Booster Box",
  MaxBid: "3950",
  BuyItNowPrice: "4200",
  EndDate: "2026-08-05T19:41:49.463+02:00",
  HasBids: "true",
  IsEnded: "true",
  ItemType: "Auction",
  CategoryId: "1001340",
  BidCount: "14",
  ItemUrl: "http://www.tradera.com/item/1001340/743187136/destined-rivals",
};

describe("parseEndedFromXml", () => {
  it("läser bud, sluttid och länk ur ett avslutat block", () => {
    const [it0] = parseEndedFromXml(item(SOLD)).items;
    expect(it0.itemId).toBe("743187136");
    expect(it0.maxBidOre).toBe(395_000);
    expect(it0.buyItNowOre).toBe(420_000);
    expect(it0.bidCount).toBe(14);
    expect(it0.hasBids).toBe(true);
    expect(it0.endDate.toISOString()).toBe("2026-08-05T17:41:49.463Z");
    // http → https, aldrig en bild-URL (samma fälla som det aktiva svepet gick i).
    expect(it0.url).toBe("https://www.tradera.com/item/1001340/743187136/destined-rivals");
  });

  it("behåller Köp nu/butiksannonser i listan — deras dom faller i GetItem-steget", () => {
    const bin = { ...SOLD, HasBids: "false", ItemType: "PureBuyItNow" };
    expect(parseEndedFromXml(item(bin)).items).toHaveLength(1);
  });

  it("kastar pågående annonser och räknar råa rader separat", () => {
    const out = parseEndedFromXml(item({ ...SOLD, IsEnded: "false" }));
    expect(out.items).toHaveLength(0);
    // ⛔ Pagineringen bryter på rawRows, aldrig på den filtrerade längden — en sida
    // full av bortfiltrerade rader är inte samma sak som en tom sida.
    expect(out.rawRows).toBe(1);
  });

  it("släpper inte igenom blockerade språk", () => {
    const de = { ...SOLD, ShortDescription: "Pokemon Karmesin & Purpur Deutsch Display" };
    expect(parseEndedFromXml(item(de)).items).toHaveLength(0);
  });
});

// ⛔ KÄRNAN: i SÖK-svaret har en avslutad PureBuyItNow HasBids=false och
// BuyItNowPrice == MaxBid oavsett om någon köpte den eller om den bara löpte ut
// (mätt 2026-08-06: 2 109 av 2 768). Budbevis finns bara hos auktionstyperna.
describe("soldByBidsOre", () => {
  const base = { itemType: "Auction", hasBids: true, maxBidOre: 395_000 };

  it("budbevisar bara auktionstyper med bud och positivt vinnande bud", () => {
    expect(soldByBidsOre(base)).toBe(395_000);
    expect(soldByBidsOre({ ...base, itemType: "AuctionWithBuyItNow" })).toBe(395_000);
    expect(soldByBidsOre({ ...base, itemType: "PureBuyItNow" })).toBeNull();
    expect(soldByBidsOre({ ...base, itemType: "ShopItem" })).toBeNull();
    expect(soldByBidsOre({ ...base, hasBids: false })).toBeNull();
    expect(soldByBidsOre({ ...base, maxBidOre: null })).toBeNull();
  });
});

// GetItem skiljer såld från utgången Köp nu: GotWinner=true är Traderas eget besked
// att annonsen fick en köpare. Fälten verifierade mot riktiga svar 2026-08-12.
describe("getItemVerdict", () => {
  const xml = (fields: Record<string, string>) =>
    Object.entries(fields).map(([k, v]) => `<${k}>${v}</${k}>`).join("");

  it("utgången annons (GotWinner=false) är ingen affär", () => {
    // Verkligt mönster: Ended=true, GotWinner=false, RemainingQuantity kvar.
    const v = getItemVerdict(xml({ Ended: "true", GotWinner: "false", TotalBids: "0", MaxBid: "22", BuyItNowPrice: "22" }));
    expect(v.sold).toBe(false);
  });

  it("accepterat bud på en Köp nu ger BUDETS pris, inte utropet", () => {
    // Verkligt fall: BIN 250 kr, säljaren accepterade 198 kr → betalt 198.
    const v = getItemVerdict(xml({ Ended: "true", GotWinner: "true", TotalBids: "1", MaxBid: "198", BuyItNowPrice: "250" }));
    expect(v).toEqual({ sold: true, priceOre: 19_800 });
  });

  it("köp utan budgivning ger Köp nu-priset", () => {
    const v = getItemVerdict(xml({ Ended: "true", GotWinner: "true", TotalBids: "0", MaxBid: "0", BuyItNowPrice: "4200" }));
    expect(v).toEqual({ sold: true, priceOre: 420_000 });
  });

  it("en annons som inte är avslutad döms aldrig", () => {
    const v = getItemVerdict(xml({ Ended: "false", GotWinner: "true", TotalBids: "1", MaxBid: "100" }));
    expect(v.sold).toBe(false);
  });
});

describe("sålt som egen serie i prisgrafen", () => {
  const day = (d: string) => new Date(`${d}T12:00:00.000Z`);
  const obs = (name: string, d: string, price: number) => ({
    price,
    observedAt: day(d),
    source: { name },
  });

  it("håller sålt och annonspris i SKILDA serier", () => {
    const out = bucketObservationsBySource([
      obs("Tradera", "2026-08-01", 100_000),
      obs(TRADERA_SOLD_SOURCE_NAME, "2026-08-01", 80_000),
    ]);
    expect(out.tradera).toEqual([{ date: "2026-08-01", price: 100_000 }]);
    expect(out.traderaSold).toEqual([{ date: "2026-08-01", price: 80_000 }]);
    // ⛔ Sålt får ALDRIG smitta Cardmarket-serien heller.
    expect(out.cardmarket).toEqual([]);
  });

  // Annonser samma dag beskriver SAMMA sak (vad varan kostar nu) → lägsta är svaret.
  // Försäljningar samma dag är OLIKA affärer, alla lika sanna → medianen.
  it("bucketar sålt som dagens median, inte som dagens lägsta", () => {
    const out = bucketObservationsBySource([
      obs(TRADERA_SOLD_SOURCE_NAME, "2026-08-02", 300_000),
      obs(TRADERA_SOLD_SOURCE_NAME, "2026-08-02", 100_000),
      obs(TRADERA_SOLD_SOURCE_NAME, "2026-08-02", 400_000),
    ]);
    expect(out.traderaSold).toEqual([{ date: "2026-08-02", price: 300_000 }]);
  });

  // ⛔ En försäljning är en HÄNDELSE, inte ett tillstånd. Drogs den ut till nästa
  // punkt hade grafen påstått att varan såldes för samma belopp varje dag emellan.
  it("fyller aldrig ut glapp i sålt-serien", () => {
    const out = bucketObservationsBySource([
      obs(TRADERA_SOLD_SOURCE_NAME, "2026-08-01", 100_000),
      obs(TRADERA_SOLD_SOURCE_NAME, "2026-08-09", 120_000),
    ]);
    expect(out.traderaSold).toHaveLength(2);
  });
});

describe("medianOre", () => {
  it("udda antal → mittenvärdet", () => {
    expect(medianOre([300, 100, 200])).toBe(200);
  });
  it("jämnt antal → medel av de två mittersta, avrundat", () => {
    expect(medianOre([100, 200, 300, 401])).toBe(250);
  });
  it("ett enda värde är sitt eget median", () => {
    expect(medianOre([4711])).toBe(4711);
  });
});
