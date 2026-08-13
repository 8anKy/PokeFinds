import { describe, expect, it } from "vitest";
import {
  parsePrestaShopListing,
  parseSekListingPrice,
  prestaStockFromArticle,
} from "@/scrapers/adapters/prestashop-adapter";

/**
 * Fixturer modellerade på riktig PrestaShop-markup (probe 2026-08-13):
 * standardtemats badge-variant (sedd på Playoteket — butiken är robots-blockerad och
 * hämtas ALDRIG, men temat är PrestaShops default så parsern måste kunna det),
 * Leksaksaffären (form-som-signal + servertrunkerad titel) och NordicTCG
 * (out_of_stock-flagga + titel i ankarets title-attribut).
 * Parsern är ren → testbar utan nät; live-siffrorna verifierades separat samma dag.
 */

const playoteketAvailable = `
<article class="product-miniature js-product-miniature" data-id-product="26856">
  <a href="https://playoteket.com/foerhandsboka/26856-pokemon-mega-greninja-ex-premium-collection-196214141957.html" class="thumbnail product-thumbnail">
    <img data-src="https://playoteket.com/24990-home_default/pokemon-mega-greninja.jpg" alt="Pokémon: Mega Greninja Ex Premium Collection">
  </a>
  <h2 class="h3 product-title"><a href="https://playoteket.com/foerhandsboka/26856-pokemon-mega-greninja-ex-premium-collection-196214141957.html">Pokémon: Mega Greninja Ex Premium Collection</a></h2>
  <span class="sr-only">Pris</span> <span class="price"> 749,00 kr </span>
  <span class="badge badge-success product-available mt-2">I lager</span>
  <span class="badge badge-warning d-none product-last-items mt-2">Sista produkten i lager</span>
</article>`;

const playoteketSoldOut = `
<article class="product-miniature js-product-miniature" data-id-product="22441">
  <h2 class="h3 product-title"><a href="https://playoteket.com/kortspel/22441-pokemon-azure-legends-kyogre-ex-tin-50003874.html">Pokemon: Azure Legends Kyogre EX Tin</a></h2>
  <span class="price"> 349,00 kr </span>
  <div class="product-availability d-block"><span class="badge badge-danger product-unavailable mt-2">Slut i weblager</span></div>
</article>`;

const leksaksInStock = `
<article class="product-miniature js-product-miniature" data-id-product="62153" itemscope itemtype="http://schema.org/Product">
  <meta itemprop="sku" content="POK10426-101">
  <a href="https://leksaksaffaren.com/pokemon-boosters/62153-pokemon-pitch-black-booster-hel-box.html" class="thumbnail">
    <img src="https://leksaksaffaren.b-cdn.net/200255-home_default/pitch-black-box.jpg" alt="Pokemon Pitch Black Booster Hel Box 36 paket (max 2 per hushåll)">
  </a>
  <h2 class="h5 product-name" itemprop="name"><a href="https://leksaksaffaren.com/pokemon-boosters/62153-pokemon-pitch-black-booster-hel-box.html"> Pokemon Pitch Black Booster Hel Box... </a></h2>
  <span class="price">2 999,00 kr</span>
  <div class="product-list-actions">
    <form action="//leksaksaffaren.com/varukorg" method="post" id="add-to-cart-or-refresh_62153">
      <button class=" btn btn-primary btn-sm add-to-cart">Köp</button>
    </form>
  </div>
</article>`;

// Slutsåld hos Leksaksaffären: varken pris eller form — raden ska FALLA UR feeden
// (pris är obligatoriskt), inte bli en 0-kronorsobservation.
const leksaksSoldOut = `
<article class="product-miniature js-product-miniature" data-id-product="62150" itemscope itemtype="http://schema.org/Product">
  <a href="https://leksaksaffaren.com/pokemon/62150-pokemon-pitch-black-checklane-gengar.html" class="thumbnail">
    <img src="https://leksaksaffaren.b-cdn.net/200000-home_default/gengar.jpg" alt="Pokemon Pitch Black Premium Checklane Gengar (max 2 per hushåll)">
  </a>
  <h2 class="h5 product-name"><a href="https://leksaksaffaren.com/pokemon/62150-pokemon-pitch-black-checklane-gengar.html"> Pokemon Pitch Black Premium Checklane... </a></h2>
  <span class="badge">Tillfälligt slut i webblager</span>
  <div class="product-list-actions"> </div>
</article>`;

const nordicSoldOut = `
<article class="thumbnail-container product-miniature js-product-miniature item_in" data-id-product="20">
  <a href="https://nordictcg.se/20-pokemon-mega-dream-ex-booster-box-japansk.html" class="thumbnail product-thumbnail">
    <img class="first-image lazyload" data-src="https://nordictcg.se/381-home_default/mega-dream.jpg" alt="Mega Dream ex Booster Box (Japansk) Köp hos NordicTCG!">
  </a>
  <ul class="product-flag"><li class="out_of_stock"><span>Slutsåld</span></li></ul>
  <h3><a href="https://nordictcg.se/20-pokemon-mega-dream-ex-booster-box-japansk.html" class="product_name one_line" title="Mega Dream ex Booster Box (m2a)(Japansk)">Mega Dream ex Booster Box (m2a)(Japansk)</a></h3>
  <span class="price " aria-label="Pris"> 1 079,00 kr </span>
  <span class="ajax_add_to_cart_button disabled" title="Slutsåld">Lägg till i varukorgen</span>
</article>`;

describe("parseSekListingPrice", () => {
  it("läser svenska listpriser till öre", () => {
    expect(parseSekListingPrice("749,00 kr")).toBe(74900);
    expect(parseSekListingPrice("2 999,00 kr")).toBe(299900);
    expect(parseSekListingPrice(" 1 079,00 ")).toBe(107900);
    expect(parseSekListingPrice("89,00")).toBe(8900);
  });
  it("0 kr är inget pris, skräp är inget pris", () => {
    expect(parseSekListingPrice("0,00 kr")).toBeNull();
    expect(parseSekListingPrice("")).toBeNull();
    expect(parseSekListingPrice("abc")).toBeNull();
  });
});

describe("prestaStockFromArticle", () => {
  it("kräver EXPLICIT markör åt båda hållen — annars unknown", () => {
    expect(prestaStockFromArticle('<div class="price">749 kr</div>')).toBe("unknown");
  });
  it("badge-vägen (Playoteket)", () => {
    expect(prestaStockFromArticle(playoteketAvailable)).toBe("in");
    expect(prestaStockFromArticle(playoteketSoldOut)).toBe("out");
  });
  it("form-vägen (Leksaksaffären) och flagg-vägen (NordicTCG)", () => {
    expect(prestaStockFromArticle(leksaksInStock)).toBe("in");
    expect(prestaStockFromArticle(leksaksSoldOut)).toBe("out");
    expect(prestaStockFromArticle(nordicSoldOut)).toBe("out");
  });
});

describe("parsePrestaShopListing", () => {
  it("plockar id, URL, titel, pris och lager ur Playoteket-markup", () => {
    const items = parsePrestaShopListing(playoteketAvailable + playoteketSoldOut);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      idProduct: "26856",
      title: "Pokémon: Mega Greninja Ex Premium Collection",
      priceOre: 74900,
      stock: "in",
    });
    expect(items[0].url).toBe(
      "https://playoteket.com/foerhandsboka/26856-pokemon-mega-greninja-ex-premium-collection-196214141957.html"
    );
    expect(items[1]).toMatchObject({ idProduct: "22441", priceOre: 34900, stock: "out" });
  });

  it("Leksaksaffären: servertrunkerad ankartext ersätts med bildens alt", () => {
    const [item] = parsePrestaShopListing(leksaksInStock);
    expect(item.title).toBe("Pokemon Pitch Black Booster Hel Box 36 paket (max 2 per hushåll)");
    expect(item.priceOre).toBe(299900);
    expect(item.stock).toBe("in");
  });

  it("Leksaksaffären: slutsåld rad utan pris faller ur feeden", () => {
    expect(parsePrestaShopListing(leksaksSoldOut)).toHaveLength(0);
  });

  it("NordicTCG: titeln tas ur ankarets title-attribut, flaggan ger out", () => {
    const [item] = parsePrestaShopListing(nordicSoldOut);
    expect(item.title).toBe("Mega Dream ex Booster Box (m2a)(Japansk)");
    expect(item.priceOre).toBe(107900);
    expect(item.stock).toBe("out");
  });

  it("artiklar utan produktlänk eller data-id-product hoppas tyst (bloggkort)", () => {
    const blog = `<article class="post"><a href="https://nordictcg.se/sv/blog/nyheter.html">Nyheter</a></article>`;
    expect(parsePrestaShopListing(blog)).toHaveLength(0);
  });
});
