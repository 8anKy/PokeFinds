import { describe, it, expect } from "vitest";
import {
  sfbokStock,
  sfbokStoreStock,
  parseSfBokProducts,
  collectSfBokProducts,
  sfbokPageUrl,
} from "../../src/scrapers/adapters/sfbok-adapter";
import { parseSfBokStores } from "../../src/scrapers/adapters/sfbok-stores";
import { wobgStockFromButton, parseWobgListing } from "../../src/scrapers/adapters/worldofboardgames-adapter";

// ── SF-Bok ─────────────────────────────────────────────────────────────────────
// webDisplay-kombinationer ordagrant ur universum-listningen 2026-09-17 (107 produkter).
describe("sfbokStock — butikens egen webDisplay dömer", () => {
  it("buttonState 0 = Lägg i varukorg online, även restnoterad", () => {
    expect(sfbokStock({ buttonState: 0, stockQuantity: 3 }).stock).toBe("in");
    expect(sfbokStock({ buttonState: 0, stockQuantity: 0 }).stock).toBe("in"); // "kan fortfarande beställas"
  });

  it("buttonState 3/4 = butiksvara: lager > 0 ⇒ i lager (reservera i butik), annars slut", () => {
    expect(sfbokStock({ buttonState: 4, stockQuantity: 18 })).toEqual({ stock: "in", storeOnly: true });
    expect(sfbokStock({ buttonState: 4, stockQuantity: 0 })).toEqual({ stock: "out", storeOnly: true });
    expect(sfbokStock({ buttonState: 3, stockQuantity: 1 }).stock).toBe("in");
  });

  it("buttonState 2 = Bevaka ⇒ slut, utom isPreOrder ⇒ förhandsbokning", () => {
    // 30th Celebration ETB på släppdagen: "Ej utgiven än", Bevaka, isPreOrder=false.
    expect(sfbokStock({ buttonState: 2, isPreOrder: false, stockQuantity: 0 }).stock).toBe("out");
    expect(sfbokStock({ buttonState: 2, isPreOrder: true, stockQuantity: 0 }).stock).toBe("preorder");
  });

  it("okänd buttonState ⇒ unknown, aldrig en gissning", () => {
    expect(sfbokStock({ buttonState: 7, stockQuantity: 5 }).stock).toBe("unknown");
    expect(sfbokStock({ buttonState: null, stockQuantity: 5 }).stock).toBe("unknown");
  });
});

// warehouseInventories ordagrant ur listningen 2026-10-02 (släppdagen för 30th Celebration).
describe("sfbokStoreStock — centrallagret är inte butikslagret", () => {
  const wh = (primary: number, s010: number, s020: number, s030: number, s040: number) => [
    { warehouseCode: "S040", quantity: s040, isPrimaryWarehouse: false },
    { warehouseCode: "S030", quantity: s030, isPrimaryWarehouse: false },
    { warehouseCode: "S010", quantity: s010, isPrimaryWarehouse: false },
    { warehouseCode: "1", quantity: primary, isPrimaryWarehouse: true },
    { warehouseCode: "S020", quantity: s020, isPrimaryWarehouse: false },
  ];

  it("Mini Tin: 280 i centrallagret, 0 i butikerna ⇒ 0 ex och slut i butik", () => {
    const inStores = sfbokStoreStock({ stockQuantity: 280, warehouseInventories: wh(280, 0, 0, 0, 0) });
    expect(inStores).toEqual({ units: 0, stores: 0, locations: [] });
    expect(sfbokStock({ buttonState: 4, stockQuantity: inStores.units }).stock).toBe("out");
  });

  it("Enhanced 2-pack: 19 + 7 i två butiker ⇒ 26 ex i 2 butiker", () => {
    expect(sfbokStoreStock({ stockQuantity: 26, warehouseInventories: wh(0, 0, 19, 7, 0) })).toMatchObject({
      units: 26,
      stores: 2,
    });
  });

  it("centrallagret räknas aldrig med, även när butikerna har saldo", () => {
    expect(sfbokStoreStock({ stockQuantity: 206, warehouseInventories: wh(112, 28, 27, 26, 13) })).toMatchObject({
      units: 94,
      stores: 4,
    });
  });

  it("utan uppdelning ⇒ totalen med okänt butiksantal", () => {
    expect(sfbokStoreStock({ stockQuantity: 5 })).toEqual({ units: 5, stores: null, locations: [] });
    expect(sfbokStoreStock({ stockQuantity: null, warehouseInventories: [] })).toEqual({
      units: null,
      stores: null,
      locations: [],
    });
  });

  it("med butikslistan får varje butik med saldo sin ort, störst först", () => {
    const names = parseSfBokStores(SF_STORES_RSC);
    expect(sfbokStoreStock({ stockQuantity: 26, warehouseInventories: wh(0, 0, 19, 7, 0) }, names).locations).toEqual([
      { id: "S020", label: "Malmö", units: 19, capped: false },
      { id: "S030", label: "Göteborg", units: 7, capped: false },
    ]);
  });

  it("en lagerkod utan namn räknas i summan men får ingen rad — aldrig en gissad ort", () => {
    const names = parseSfBokStores(SF_STORES_RSC);
    names.delete("S030");
    const out = sfbokStoreStock({ warehouseInventories: wh(0, 0, 19, 7, 0) }, names);
    expect(out).toMatchObject({ units: 26, stores: 2 });
    expect(out.locations.map((l) => l.label)).toEqual(["Malmö"]);
  });
});

// Butikssidans RSC-flight, avskalad (2026-10-02): ett "store"-objekt per butik.
const SF_STORE = (code: string, name: string, city: string) =>
  `{"store":{"accessibility":[{"_key":"sv-SE","value":[{"text":"Butiken {har} hiss."}]}],` +
  `"address":{"addressCountry":"SE","addressLocality":"${city}","streetAddress":"Gatan 1"},` +
  `"name":"Science Fiction-Bokhandeln ${name}","storeId":"x","warehouseCode":"${code}"},"storesBasePath":"/sv/butiker"}`;
const SF_STORES_RSC =
  `24:["$","$L21","stockholm",${SF_STORE("S010", "Stockholm", "Stockholm")}]
` +
  `25:["$","$L21","malmo",${SF_STORE("S020", "Malmö", "Malmö")}]
` +
  `26:["$","$L21","goteborg",${SF_STORE("S030", "Göteborg", "Göteborg")}]
` +
  `27:["$","$L21","linkoping",${SF_STORE("S040", "Linköping", "Linköping")}]`;

describe("parseSfBokStores — lagerkod → ort ur butikens egen butikssida", () => {
  it("RSC-flight", () => {
    const out = parseSfBokStores(SF_STORES_RSC);
    expect([...out.values()].map((s) => [s.warehouseCode, s.city])).toEqual([
      ["S010", "Stockholm"],
      ["S020", "Malmö"],
      ["S030", "Göteborg"],
      ["S040", "Linköping"],
    ]);
  });

  it("HTML med escapad flight ger samma butiker", () => {
    const html = `<script>self.__next_f.push([1,"${SF_STORES_RSC.replace(/"/g, '\\"')}"])</script>`;
    expect([...parseSfBokStores(html).keys()]).toEqual(["S010", "S020", "S030", "S040"]);
  });

  it("utan lagerkod eller namn ⇒ ingen post", () => {
    expect(parseSfBokStores(`{"store":{"name":"X","address":{}}}`).size).toBe(0);
    expect(parseSfBokStores("").size).toBe(0);
  });
});

const SF_OBJ = (id: string, name: string, extra = "") =>
  `{"identifier":"${id}","displayName":"${name}","slug":"x-${id}","canonicalCategoryPath":"/sv/spel/samlarkortspel-tcg-ccg",` +
  `"gameFamilyName":"Pokémon TCG","attributes":[{"identifier":"ean","displayName":"EAN","value":"0196214144828"}],` +
  `"variants":[{"skuCode":"${id}","slug":"x-${id}","isPublished":true,"stockStatus":1,"stockQuantity":0,` +
  `"price":{"currency":"SEK","bestPriceInclVat":799}}],` +
  `"webDisplay":{"isVisible":true,"buttonState":2,"displayText":"Ej \\"utgiven\\" än","isPreOrder":false}${extra}}`;

describe("parseSfBokProducts — RSC-flight och HTML ger samma objekt", () => {
  it("läser objekt ur en RSC-rad, tål escapade citattecken i strängar", () => {
    const rsc = `1:["$","div",null,{}]\n2:{"products":[${SF_OBJ("749687", "Pokemon TCG: 30th Celebration Elite Trainer Box")},${SF_OBJ("749690", "Pokemon TCG: 30th Celebration EX Box")}]}\n`;
    const out = parseSfBokProducts(rsc);
    expect(out.map((p) => p.identifier)).toEqual(["749687", "749690"]);
    expect(out[0].variants?.[0].price?.bestPriceInclVat).toBe(799);
    expect(out[0].webDisplay?.buttonState).toBe(2);
  });

  it("läser samma objekt ur HTML där JSON ligger \\\"-escapad i self.__next_f.push", () => {
    const inner = SF_OBJ("749687", "Pokemon TCG: 30th Celebration Elite Trainer Box").replace(/"/g, '\\"');
    const html = `<script>self.__next_f.push([1,"2:{\\"products\\":[${inner}]}"])</script>`;
    const out = parseSfBokProducts(html);
    expect(out).toHaveLength(1);
    expect(out[0].displayName).toBe("Pokemon TCG: 30th Celebration Elite Trainer Box");
  });

  it("ett trasigt objekt fäller inte de andra", () => {
    const rsc = `{"identifier":"1","displayName":"trasig","variants":[` + SF_OBJ("2", "Pokemon TCG: Pitch Black Booster");
    expect(parseSfBokProducts(rsc).map((p) => p.identifier)).toEqual(["2"]);
  });
});

// 2026-10-02: universum-listningen tappade nya varor utan Universe-attribut (30th Mini Tin
// med 280 ex i butik syntes aldrig). Nu två listningar, alla sidor, unionen på identifier.
describe("collectSfBokProducts — två listningar, alla sidor, aldrig en halv lista", () => {
  const page = (ids: string[], total: number) =>
    `2:{"totalHits":${total},"products":[${ids.map((id) => SF_OBJ(id, `Pokemon TCG: vara ${id}`)).join(",")}]}`;
  const A = "https://www.sfbok.se/sv/spel?GameFamily=Pok%C3%A9mon+TCG";
  const B = "https://www.sfbok.se/sv/spel/samlarkortspel-tcg-ccg/pokemon-trading-card-game";
  const ids = (n: number, from = 1) => Array.from({ length: n }, (_, i) => String(from + i));

  it("unionen fångar en vara som bara finns i kategorin (saknar GameFamily-taggen)", async () => {
    const pages: Record<string, string> = { [A]: page(["1", "2"], 2), [B]: page(["2", "3"], 2) };
    const out = await collectSfBokProducts([A, B], async (u) => pages[u]);
    expect(out.products.map((p) => p.identifier).sort()).toEqual(["1", "2", "3"]);
  });

  it("paginerar tills totalHits är nått", async () => {
    const pages: Record<string, string> = {
      [A]: page(ids(60), 125),
      [sfbokPageUrl(A, 2)]: page(ids(60, 61), 125),
      [sfbokPageUrl(A, 3)]: page(ids(5, 121), 125),
    };
    const asked: string[] = [];
    const out = await collectSfBokProducts([A], async (u) => (asked.push(u), pages[u]));
    expect(out.products).toHaveLength(125);
    expect(asked).toHaveLength(3);
  });

  it("slutar när en sida inte ger något nytt (servern ignorerar ?page)", async () => {
    const asked: string[] = [];
    const out = await collectSfBokProducts([A], async (u) => (asked.push(u), page(ids(60), 999)));
    expect(out.products).toHaveLength(60);
    expect(asked).toHaveLength(2);
  });

  it("en sida som inte går att hämta fäller HELA hämtningen", async () => {
    await expect(
      collectSfBokProducts([A, B], async (u) => {
        if (u === B) throw new Error("HTTP 503");
        return page(["1"], 1);
      })
    ).rejects.toThrow("HTTP 503");
  });

  it("en listning utan produktobjekt på sida 1 är ett fel, inte en tom butik", async () => {
    await expect(collectSfBokProducts([A], async () => "<html>underhåll</html>")).rejects.toThrow(/0 produktobjekt/);
  });

  it("sidnumret läggs till utan att tappa facetten", () => {
    expect(sfbokPageUrl(A, 1)).toBe(A);
    expect(sfbokPageUrl(A, 2)).toBe("https://www.sfbok.se/sv/spel?GameFamily=Pok%C3%A9mon+TCG&page=2");
  });
});

// ── World of Board Games ───────────────────────────────────────────────────────
// Knapparna ordagrant ur /sok/pokemon 2026-09-17 (907 kort).
const BTN_BUY = `<a href="#" class="button green add-to-cart" data-itemid="30170" data-addnum="1" title="Leveranstid: 1-3 vardagar">Köp</a>`;
const BTN_BUY_SLOW = `<a href="#" class="button yellow add-to-cart" data-itemid="30171" data-addnum="1" title="Leveranstid: 7-10 vardagar">Köp</a>`;
const BTN_BOOK = `<a href="https://www.worldofboardgames.com/preorder.php?webshopChildItemID=62903" class="modal-trigger button blue" rel="nofollow" title="Kommande produkt">Boka</a>`;
const BTN_WATCH = `<a href="https://www.worldofboardgames.com/gametip.php?webshopChildItemID=68405" class="modal-trigger button red" rel="nofollow" title="Tillfälligt slut">Bevaka</a>`;
const BTN_GONE = `<a href="https://www.worldofboardgames.com/product_status.php?productStatusTypeID=3" class="modal-trigger button grey" rel="nofollow" title="Utgått">Utgått</a>`;
const BTN_SOON = `<a href="https://www.worldofboardgames.com/product_status.php?productStatusTypeID=5" class="modal-trigger button blue" rel="nofollow" title="Kommande">Kommande</a>`;

describe("wobgStockFromButton", () => {
  it("Köp (grön eller gul) = i lager", () => {
    expect(wobgStockFromButton(BTN_BUY)).toBe("in");
    expect(wobgStockFromButton(BTN_BUY_SLOW)).toBe("in");
  });
  it("Boka (preorder.php) = förhandsbokning", () => {
    expect(wobgStockFromButton(BTN_BOOK)).toBe("preorder");
  });
  it("Bevaka / Utgått / Kommande (ej beställbar) = slut", () => {
    expect(wobgStockFromButton(BTN_WATCH)).toBe("out");
    expect(wobgStockFromButton(BTN_GONE)).toBe("out");
    expect(wobgStockFromButton(BTN_SOON)).toBe("out");
  });
  it("ingen knapp = unknown", () => {
    expect(wobgStockFromButton(null)).toBe("unknown");
    expect(wobgStockFromButton(`<a href="#" class="button pink">Hej</a>`)).toBe("unknown");
  });
});

function card(title: string, slug: string, price: string, btn: string): string {
  return `<div class="product-item" style="--span-columns: 12;"><div class="product">
    <div style="position: relative; max-width: 200px; margin: auto;">
      <a href="https://www.worldofboardgames.com/${slug}" title="${title}">
        <img src="https://www.worldofboardgames.com/product_images/66721-1-S.webp?v=1" width="200" height="150" alt="${title}"></a></div>
    <div style="margin: 5px;"><a href="https://www.worldofboardgames.com/${slug}" title="${title}">${title.slice(0, 20)}...</a></div>
    <div class="xlarge"><strong>${price} kr </strong></div><div style="margin-left: auto;">${btn}</div></div></div>`;
}

describe("parseWobgListing", () => {
  it("läser titel, URL, pris, bild och knapp per kort", () => {
    const html =
      card("Pok&#x27;mon TCG: Mega Evolution Booster Pack (10 Kort) (Max 6. Per Kund)", "pokemon-tcg-mega-evolution-booster-pack", "65", BTN_GONE) +
      card("Pokemon TCG: 30th Celebration Elite Trainer Box", "pokemon-tcg-30th-etb", "1 099", BTN_BUY) +
      card("Ultra Pro: Pokemon Playmat", "ultra-pro-playmat", "279", BTN_BOOK);
    const items = parseWobgListing(html);
    expect(items).toHaveLength(3);
    expect(items[0]).toMatchObject({ stock: "out", priceOre: 6500, url: "https://www.worldofboardgames.com/pokemon-tcg-mega-evolution-booster-pack" });
    expect(items[0].title).toBe("Pok'mon TCG: Mega Evolution Booster Pack (10 Kort) (Max 6. Per Kund)");
    expect(items[1]).toMatchObject({ stock: "in", priceOre: 109900, itemId: "30170" });
    expect(items[1].imageUrl).toContain("/product_images/");
    expect(items[2]).toMatchObject({ stock: "preorder", itemId: "62903" });
  });

  it("30th-ETB:n som fanns 2026-09-17 (Max 1. Per Kund) läses som i lager", () => {
    const html = card("Pokémon TCG: 30th Celebration - Elite Trainer Box (Max 1. Per Kund)", "pokemon-tcg-30th-celebration-elite-trainer-box-max-1-per-kund", "899", BTN_BUY);
    const [item] = parseWobgListing(html);
    expect(item).toMatchObject({ stock: "in", priceOre: 89900 });
    expect(item.title).toBe("Pokémon TCG: 30th Celebration - Elite Trainer Box (Max 1. Per Kund)");
  });

  it("tom kategori ('inga träffar') ger noll kort utan att kasta", () => {
    expect(parseWobgListing(`<div class="grid-item">Ditt urval/din sökning gav tyvärr inga träffar.</div>`)).toEqual([]);
  });
});
