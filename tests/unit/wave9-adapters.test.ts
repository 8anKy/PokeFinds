import { describe, it, expect } from "vitest";
import { sfbokStock, parseSfBokProducts } from "../../src/scrapers/adapters/sfbok-adapter";
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
