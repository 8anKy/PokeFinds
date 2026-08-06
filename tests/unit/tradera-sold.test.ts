import { describe, it, expect } from "vitest";
import { parseSoldFromXml } from "@/jobs/tradera-sold-sweep";
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

describe("parseSoldFromXml", () => {
  it("läser vinnande budet i öre och affärens egen sluttid", () => {
    const [it0] = parseSoldFromXml(item(SOLD)).items;
    expect(it0.itemId).toBe("743187136");
    expect(it0.priceOre).toBe(395_000);
    expect(it0.bidCount).toBe(14);
    expect(it0.endDate.toISOString()).toBe("2026-08-05T17:41:49.463Z");
    // http → https, aldrig en bild-URL (samma fälla som det aktiva svepet gick i).
    expect(it0.url).toBe("https://www.tradera.com/item/1001340/743187136/destined-rivals");
  });

  // ⛔ KÄRNAN I HELA FUNKTIONEN. En avslutad PureBuyItNow har HasBids=false och
  // BuyItNowPrice == MaxBid oavsett om någon köpte den eller om den bara löpte ut.
  // Mätt 2026-08-06: 2 109 av 2 768 avslutade utan bud bar exakt den likheten.
  it("avvisar allt som inte BEVISLIGEN såldes", () => {
    const cases = [
      { ...SOLD, HasBids: "false", ItemType: "PureBuyItNow" }, // såld ELLER utgången
      { ...SOLD, HasBids: "false" }, // auktion utan bud = ingen affär
      { ...SOLD, ItemType: "ShopItem" }, // butiksannons, inte budbar
      { ...SOLD, IsEnded: "false" }, // pågår fortfarande
      { ...SOLD, MaxBid: "0" }, // 0 kr är inget pris
    ];
    for (const c of cases) {
      expect(parseSoldFromXml(item(c)).items).toHaveLength(0);
    }
  });

  it("accepterar AuctionWithBuyItNow — den är budbar", () => {
    expect(
      parseSoldFromXml(item({ ...SOLD, ItemType: "AuctionWithBuyItNow" })).items
    ).toHaveLength(1);
  });

  it("släpper inte igenom blockerade språk", () => {
    const de = { ...SOLD, ShortDescription: "Pokemon Karmesin & Purpur Deutsch Display" };
    expect(parseSoldFromXml(item(de)).items).toHaveLength(0);
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
