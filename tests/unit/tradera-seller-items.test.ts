import { describe, expect, it } from "vitest";
import {
  mergeSellerListings,
  parseSellerItemsXml,
  traderaSellerProfileUrl,
  TRADERA_POKEMON_CATEGORY_IDS,
  type SellerListing,
} from "@/lib/tradera-seller-items";

// Klockan i testet: allt som slutar efter den räknas som aktivt.
const NOW = Date.parse("2026-09-03T12:00:00Z");

const item = (inner: string) => `<Item>${inner}</Item>`;

/** ArrayOfItem-formen ur WSDL:en (PublicService.GetSellerItems). */
const XML = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
<soap:Body><GetSellerItemsResponse xmlns="http://api.tradera.com"><GetSellerItemsResult>
${item(`
  <Status><Ended>false</Ended><GotBidders>false</GotBidders><GotWinner>false</GotWinner></Status>
  <ItemType>PureBuyItNow</ItemType>
  <Id>700001</Id>
  <ShortDescription>Charizard ex 199/165 &amp; sleeve</ShortDescription>
  <EndDate>2026-09-20T18:00:00</EndDate>
  <CategoryId>1001337</CategoryId>
  <OpeningBid>0</OpeningBid>
  <BuyItNowPrice>1250</BuyItNowPrice>
  <TotalBids>0</TotalBids>
  <MaxBid>0</MaxBid>
  <ItemLink>http://www.tradera.com/item/1001337/700001/charizard-ex</ItemLink>
  <ThumbnailLink>https://img.tradera.net/thumbs/700001_abc.jpg</ThumbnailLink>
`)}
${item(`
  <Status><Ended>false</Ended><GotBidders>true</GotBidders><GotWinner>false</GotWinner></Status>
  <ItemType>Auction</ItemType>
  <Id>700002</Id>
  <ShortDescription>Booster box Surging Sparks</ShortDescription>
  <EndDate>2026-09-05T20:30:00</EndDate>
  <CategoryId>1001340</CategoryId>
  <OpeningBid>500</OpeningBid>
  <NextBid>1020</NextBid>
  <TotalBids>4</TotalBids>
  <MaxBid>1000</MaxBid>
  <ItemLink>https://img.tradera.net/images/700002.jpg</ItemLink>
  <ImageLinks><string>https://img.tradera.net/images/700002_big.jpg</string></ImageLinks>
`)}
${item(`
  <Status><Ended>true</Ended><GotBidders>true</GotBidders><GotWinner>true</GotWinner></Status>
  <ItemType>Auction</ItemType>
  <Id>700003</Id>
  <ShortDescription>Avslutad auktion</ShortDescription>
  <EndDate>2026-09-01T10:00:00</EndDate>
  <MaxBid>300</MaxBid>
  <TotalBids>2</TotalBids>
`)}
${item(`
  <Status><Ended>false</Ended><GotBidders>false</GotBidders><GotWinner>false</GotWinner></Status>
  <ItemType>PureBuyItNow</ItemType>
  <Id>700004</Id>
  <ShortDescription>Utan pris</ShortDescription>
  <EndDate>2026-09-10T10:00:00</EndDate>
  <BuyItNowPrice>0</BuyItNowPrice>
  <TotalBids>0</TotalBids>
`)}
${item(`
  <Status><Ended>false</Ended><GotBidders>false</GotBidders><GotWinner>false</GotWinner></Status>
  <ItemType>Auction</ItemType>
  <Id>700005</Id>
  <ShortDescription>Auktion utan bud</ShortDescription>
  <EndDate>2026-09-08T10:00:00</EndDate>
  <CategoryId>180408</CategoryId>
  <OpeningBid>49</OpeningBid>
  <NextBid>49</NextBid>
  <TotalBids>0</TotalBids>
  <MaxBid>0</MaxBid>
`)}
</GetSellerItemsResult></GetSellerItemsResponse></soap:Body></soap:Envelope>`;

describe("parseSellerItemsXml", () => {
  const listings = parseSellerItemsXml(XML, { now: NOW });
  const byId = Object.fromEntries(listings.map((l) => [l.itemId, l]));

  it("hoppar över avslutade annonser men behåller resten", () => {
    expect(listings.map((l) => l.itemId)).toEqual(["700001", "700002", "700004", "700005"]);
  });

  it("Köp nu: BuyItNowPrice i öre, länk https-ifierad, /thumbs/ → /medium-fit/", () => {
    expect(byId["700001"]).toEqual<SellerListing>({
      itemId: "700001",
      title: "Charizard ex 199/165 & sleeve",
      priceOre: 125_000,
      url: "https://www.tradera.com/item/1001337/700001/charizard-ex",
      imageUrl: "https://img.tradera.net/medium-fit/700001_abc.jpg",
      endsAt: new Date("2026-09-20T18:00:00").toISOString(),
      itemType: "buyNow",
    });
  });

  it("auktion med bud: ledande budet (MaxBid), inte nästa bud eller utropet", () => {
    expect(byId["700002"].itemType).toBe("auction");
    expect(byId["700002"].priceOre).toBe(100_000);
  });

  it("auktion utan bud: utropet", () => {
    expect(byId["700005"].priceOre).toBe(4_900);
  });

  it("bild-URL i länkfältet ⇒ konstruerad item-URL; bilden tas ur ImageLinks", () => {
    expect(byId["700002"].url).toBe("https://www.tradera.com/item/0/700002/");
    expect(byId["700002"].imageUrl).toBe("https://img.tradera.net/images/700002_big.jpg");
  });

  it("0 kr är inget pris — null, aldrig 0", () => {
    expect(byId["700004"].priceOre).toBeNull();
    expect(byId["700004"].imageUrl).toBeNull();
  });

  it("ett EndDate som passerat räknas som avslutat även utan Status", () => {
    const xml = item(
      `<ItemType>PureBuyItNow</ItemType><Id>1</Id><ShortDescription>Gammal</ShortDescription><EndDate>2026-09-02T00:00:00Z</EndDate><BuyItNowPrice>10</BuyItNowPrice>`
    );
    expect(parseSellerItemsXml(xml, { now: NOW })).toEqual([]);
  });

  it("tål SearchService-formen (<Items> + IsEnded/HasBids) också", () => {
    const xml =
      `<Items><Id>9</Id><ShortDescription>A</ShortDescription><ItemType>PureBuyItNow</ItemType><BuyItNowPrice>5</BuyItNowPrice><IsEnded>false</IsEnded></Items>` +
      `<Items><Id>10</Id><ShortDescription>B</ShortDescription><ItemType>PureBuyItNow</ItemType><BuyItNowPrice>5</BuyItNowPrice><IsEnded>true</IsEnded></Items>`;
    expect(parseSellerItemsXml(xml, { now: NOW }).map((l) => l.itemId)).toEqual(["9"]);
  });

  it("categoryIds: bara Pokémon-trädet behålls — svaret för categoryId=0 är hela lagret", () => {
    // 700001 har CategoryId 1001337, 700002 1001340; 700004 saknar CategoryId och
    // 700005 är LEGO (180408). Utan filter finns alla fyra (se ovan).
    const filtered = parseSellerItemsXml(XML, { now: NOW, categoryIds: TRADERA_POKEMON_CATEGORY_IDS });
    expect(filtered.map((l) => l.itemId)).toEqual(["700001", "700002"]);
  });

  it("EndDate med tidszon (som Tradera skickar) tolkas rätt", () => {
    const xml = item(
      `<ItemType>PureBuyItNow</ItemType><Id>2</Id><ShortDescription>Snart</ShortDescription><EndDate>2026-09-03T14:30:00.000+02:00</EndDate><BuyItNowPrice>10</BuyItNowPrice>`
    );
    expect(parseSellerItemsXml(xml, { now: NOW })[0]?.endsAt).toBe("2026-09-03T12:30:00.000Z");
  });

  it("tomt svar ⇒ tom lista", () => {
    expect(parseSellerItemsXml("<GetSellerItemsResult />", { now: NOW })).toEqual([]);
  });
});

describe("mergeSellerListings", () => {
  const mk = (itemId: string, endsAt: string | null): SellerListing => ({
    itemId,
    title: itemId,
    priceOre: null,
    url: "",
    imageUrl: null,
    endsAt,
    itemType: "other",
  });

  it("dedupar på itemId över kategorier, sorterar snarast först, null sist, kapar", () => {
    const merged = mergeSellerListings(
      [
        [mk("a", "2026-09-10T00:00:00.000Z"), mk("b", null)],
        [mk("a", "2026-09-10T00:00:00.000Z"), mk("c", "2026-09-04T00:00:00.000Z")],
        [mk("d", "2026-09-06T00:00:00.000Z")],
      ],
      3
    );
    expect(merged.map((l) => l.itemId)).toEqual(["c", "d", "a"]);
  });
});

describe("traderaSellerProfileUrl", () => {
  it("bar id räcker — aliaset i Traderas URL är valfritt", () => {
    expect(traderaSellerProfileUrl("4248944")).toBe("https://www.tradera.com/profile/items/4248944/");
  });
});
