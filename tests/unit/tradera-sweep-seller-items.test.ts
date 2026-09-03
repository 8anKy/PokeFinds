/**
 * Fas 2 i Tradera-svepet (Top-säljare via PublicService.GetSellerItems) gav
 * "+0 nya" varje natt — belagt i sweep-loggen 2026-09-03 (100 anrop, 25 säljare,
 * +0) — av TVÅ oberoende skäl som det här testet vaktar var för sig:
 *
 *   1. Kuvertet skickade ett Pokémon-kategori-id. Tradera svarar TOMT på det
 *      (mätt live: en säljare vars annons låg i 1001337 gav 0 rader för
 *      categoryId=1001337 men hela lagret för 0). Kuvertet MÅSTE bära 0 och
 *      filtret sitta i koden.
 *   2. Parsern splittade på SearchService-formen `<Items>…</Items>`, medan
 *      PublicService svarar med ArrayOfItem = `<Item>…</Item>`. Noll block ⇒
 *      noll rader, oavsett kategori.
 *   3. `filterItemType=PureBuyItNow` tappar butikernas fastpris: de är
 *      `ShopItem` (toppsäljaren: 4 735 ShopItem mot 10 PureBuyItNow). Kuvertet
 *      MÅSTE bära All; parsern behåller Köp nu-pris utan bud.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ prisma: {} }));

import {
  buildGetSellerItemsBody,
  isPokemonListingCategory,
  parseItemsFromXml,
} from "@/jobs/tradera-sweep";

const item = (inner: string) => `<Item>${inner}</Item>`;

/** ArrayOfItem-formen (PublicService.GetSellerItems, categoryId=0 ⇒ hela lagret). */
const SELLER_XML = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
<soap:Body><GetSellerItemsResponse xmlns="http://api.tradera.com"><GetSellerItemsResult>
${item(`
  <Status><Ended>false</Ended><GotBidders>false</GotBidders><GotWinner>false</GotWinner></Status>
  <ItemType>PureBuyItNow</ItemType>
  <Id>800001</Id>
  <ShortDescription>Charizard ex 199/165 Obsidian Flames</ShortDescription>
  <EndDate>2026-09-20T18:00:00</EndDate>
  <CategoryId>1001337</CategoryId>
  <BuyItNowPrice>1250</BuyItNowPrice>
  <ItemLink>http://www.tradera.com/item/1001337/800001/charizard-ex</ItemLink>
  <ThumbnailLink>https://img.tradera.net/thumbs/800001_abc.jpg</ThumbnailLink>
`)}
${item(`
  <Status><Ended>false</Ended><GotBidders>false</GotBidders><GotWinner>false</GotWinner></Status>
  <ItemType>PureBuyItNow</ItemType>
  <Id>800002</Id>
  <ShortDescription>Black Lotus Alpha</ShortDescription>
  <EndDate>2026-09-20T18:00:00</EndDate>
  <CategoryId>1001500</CategoryId>
  <BuyItNowPrice>99000</BuyItNowPrice>
  <ItemLink>http://www.tradera.com/item/1001500/800002/black-lotus</ItemLink>
`)}
${item(`
  <Status><Ended>true</Ended><GotBidders>false</GotBidders><GotWinner>true</GotWinner></Status>
  <ItemType>PureBuyItNow</ItemType>
  <Id>800003</Id>
  <ShortDescription>Booster box Surging Sparks</ShortDescription>
  <EndDate>2026-09-01T10:00:00</EndDate>
  <CategoryId>1001340</CategoryId>
  <BuyItNowPrice>1500</BuyItNowPrice>
`)}
${item(`
  <Status><Ended>false</Ended><GotBidders>false</GotBidders><GotWinner>false</GotWinner></Status>
  <ItemType>ShopItem</ItemType>
  <Id>800004</Id>
  <ShortDescription>Booster box Prismatic Evolutions</ShortDescription>
  <EndDate>2026-10-01T10:00:00</EndDate>
  <CategoryId>1001340</CategoryId>
  <BuyItNowPrice>3200</BuyItNowPrice>
  <TotalBids>0</TotalBids>
`)}
${item(`
  <Status><Ended>false</Ended><GotBidders>true</GotBidders><GotWinner>false</GotWinner></Status>
  <ItemType>Auction</ItemType>
  <Id>800005</Id>
  <ShortDescription>Umbreon VMAX alt art auktion</ShortDescription>
  <EndDate>2026-09-10T10:00:00</EndDate>
  <CategoryId>1001337</CategoryId>
  <OpeningBid>100</OpeningBid>
  <BuyItNowPrice>2000</BuyItNowPrice>
  <TotalBids>3</TotalBids>
  <MaxBid>450</MaxBid>
`)}
${item(`
  <Status><Ended>false</Ended><GotBidders>false</GotBidders><GotWinner>false</GotWinner></Status>
  <ItemType>Auction</ItemType>
  <Id>800006</Id>
  <ShortDescription>Elite Trainer Box Journey Together</ShortDescription>
  <EndDate>2026-09-10T10:00:00</EndDate>
  <CategoryId>1001341</CategoryId>
  <OpeningBid>300</OpeningBid>
  <BuyItNowPrice>900</BuyItNowPrice>
  <TotalBids>0</TotalBids>
`)}
</GetSellerItemsResult></GetSellerItemsResponse></soap:Body></soap:Envelope>`;

/** SearchService-formen som Fas 1 parsar — får inte gå sönder av `<Item>`-stödet. */
const SEARCH_XML = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body>
<SearchResponse xmlns="http://api.tradera.com"><SearchResult><TotalNumberOfPages>3</TotalNumberOfPages>
<Items>
  <Id>900001</Id>
  <ShortDescription>Pikachu ex 057/131</ShortDescription>
  <BuyItNowPrice>45</BuyItNowPrice>
  <ItemType>PureBuyItNow</ItemType>
  <IsEnded>false</IsEnded>
  <CategoryId>1001337</CategoryId>
  <ItemUrl>https://www.tradera.com/item/1001337/900001/pikachu-ex</ItemUrl>
  <Seller><Id>4711</Id></Seller>
</Items>
</SearchResult></SearchResponse></soap:Body></soap:Envelope>`;

describe("Fas 2: GetSellerItems-kuvertet", () => {
  it("skickar categoryId=0 (ett kategori-id ger tomt svar), Active + All (butikernas fastpris är ShopItem)", () => {
    const body = buildGetSellerItemsBody("app", "key", 4711);
    expect(body).toContain("<trad:userId>4711</trad:userId>");
    expect(body).toContain("<trad:categoryId>0</trad:categoryId>");
    expect(body).toContain("<trad:filterActive>Active</trad:filterActive>");
    expect(body).toContain("<trad:filterItemType>All</trad:filterItemType>");
    expect(body).not.toMatch(/<trad:categoryId>10013\d\d</);
    expect(body).not.toContain("PureBuyItNow");
  });
});

describe("parseItemsFromXml", () => {
  it("läser ArrayOfItem-formen (<Item>): ShopItem + budlös auktion med Köp nu behålls, Ended och auktion med bud faller", () => {
    const { items } = parseItemsFromXml(SELLER_XML);
    expect(items.map((i) => i.itemId)).toEqual(["800001", "800002", "800004", "800006"]);
    expect(items.find((i) => i.itemId === "800004")?.priceOre).toBe(320_000);
    expect(items.find((i) => i.itemId === "800006")?.priceOre).toBe(90_000);
    const zard = items[0];
    expect(zard.priceOre).toBe(125_000);
    expect(zard.categoryId).toBe(1001337);
    expect(zard.url).toBe("https://www.tradera.com/item/1001337/800001/charizard-ex");
    expect(zard.imageUrl).toBe("https://img.tradera.net/medium-fit/800001_abc.jpg");
    // Ingen <Seller> i ArrayOfItem — Fas 2 sätter den ur anropet.
    expect(zard.sellerId).toBeUndefined();
  });

  it("kategorifiltret i koden släpper bara Pokémon-trädet igenom (hela lagret kommer tillbaka)", () => {
    const { items } = parseItemsFromXml(SELLER_XML);
    const kept = items.filter((i) => isPokemonListingCategory(i.categoryId));
    expect(kept.map((i) => i.itemId)).toEqual(["800001", "800004", "800006"]);
    expect(isPokemonListingCategory(undefined)).toBe(false);
    expect(isPokemonListingCategory(1001341)).toBe(true);
  });

  it("SearchService-formen (<Items>) parsas som förut, inkl. sidantal och säljare", () => {
    const { items, totalPages } = parseItemsFromXml(SEARCH_XML);
    expect(totalPages).toBe(3);
    expect(items).toHaveLength(1);
    expect(items[0].itemId).toBe("900001");
    expect(items[0].priceOre).toBe(4_500);
    expect(items[0].sellerId).toBe(4711);
  });
});
