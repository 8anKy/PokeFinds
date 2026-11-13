import { describe, expect, it } from "vitest";
import { parseTcgPicksCollection, tcgPicksListingTitle } from "@/scrapers/adapters/tcgpicks-adapter";

/** Formen ur butikens riktiga kollektionssida 2026-11-13 (förkortad). */
const product = (id: string, title: string, handle: string, avail: string, amount: string, tags: string) =>
  `$R[17]={id:"gid://shopify/Product/${id}",title:"${title}",handle:"${handle}",productType:"Pokemon TCG - Sealed",` +
  `vendor:"x",tags:$R[18]=[${tags}],metafields:$R[19]=[null,null,null],availableForSale:${avail},` +
  `featuredImage:$R[24]={url:"https://cdn.shopify.com/s/files/1/a/${handle}.jpg?v=1",altText:null},` +
  `priceRange:$R[28]={minVariantPrice:$R[29]={amount:"${amount}",currencyCode:"SEK"}},` +
  `variants:$R[31]={nodes:$R[32]=[$R[33]={id:"gid://shopify/ProductVariant/9${id}",title:"Skicka hem",availableForSale:!0,` +
  `price:$R[34]={amount:"${amount}",currencyCode:"SEK"}}]}}`;

const html =
  `<script>products:$R[16]=[` +
  [
    product("1", "151 Booster Bundle", "151-booster-bundle", "!0", "2199.0", `"lang:en","Sealed"`),
    product("2", "Inferno X Booster Pack", "inferno-x-booster-pack", "!1", "69.0", `"lang:ja"`),
    product("3", 'Gem Pack Vol. 7 \\"Box\\"', "gem-pack-vol-7", "!0", "0.0", `"lang:zh"`),
  ].join(",") +
  `]</script><p>Visar <!-- -->2<!-- --> av <!-- -->3</p>`;

describe("parseTcgPicksCollection", () => {
  const { items, expected } = parseTcgPicksCollection(html);
  it("läser varje produkt och sidans egen totalsumma", () => {
    expect(expected).toBe(3);
    expect(items.map((i) => i.id)).toEqual(["1", "2", "3"]);
    expect(items[0]).toMatchObject({ title: "151 Booster Bundle", handle: "151-booster-bundle", priceOre: 219900, lang: "en" });
    expect(items[0].imageUrl).toContain("151-booster-bundle.jpg");
  });
  it("produktens flagga dömer, inte variantens", () => {
    expect(items[0].available).toBe(true);
    expect(items[1].available).toBe(false);
  });
  it("0 kr är inget pris, och citattecken i titeln överlever", () => {
    expect(items[2].priceOre).toBeNull();
    expect(items[2].title).toBe('Gem Pack Vol. 7 "Box"');
  });
  it("en sida utan produktdata ger tom lista", () => {
    expect(parseTcgPicksCollection("<html></html>")).toEqual({ items: [], expected: null });
  });
});

describe("tcgPicksListingTitle", () => {
  it("skriver ut japanska, fäller kinesiska, rör inte engelska", () => {
    expect(tcgPicksListingTitle({ title: "Inferno X Booster Pack", lang: "ja" })).toBe("Inferno X Booster Pack (JP)");
    expect(tcgPicksListingTitle({ title: "White Flare JP", lang: "ja" })).toBe("White Flare JP");
    expect(tcgPicksListingTitle({ title: "Gem Pack Vol. 7", lang: "zh" })).toBeNull();
    expect(tcgPicksListingTitle({ title: "151 Booster Pack", lang: "en" })).toBe("151 Booster Pack");
    expect(tcgPicksListingTitle({ title: "Mega Symphonia", lang: null })).toBe("Mega Symphonia");
  });
});
