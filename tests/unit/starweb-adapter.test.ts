import { describe, expect, it } from "vitest";
import {
  parseStarwebListing,
  starwebStockFromText,
} from "@/scrapers/adapters/starweb-adapter";

/**
 * Fixturer modellerade på Coolcards riktiga /category/pokmon-markup (probe
 * 2026-08-13: 48 kort/sida, lagertext på VARJE kort, plus ett {{mustache}}-mallblock
 * som INTE får bli en produkt).
 */

const inStockItem = `
<li class="gallery-item gallery-item-stock-status-2 ">
  <a href="/product/pokemon-mega-zygarde-ex-premium-collection" class="gallery-info-link product-info"
     title="Pokemon Mega Zygarde ex Premium Collection - 8 boosterpaket samt stort &amp; vanligt promo-kort"
     data-sku="POK10359-101" data-id="59336">
    <figure><img class="lazy" src="https://cdn.starwebserver.se/img/no-image.png" data-src="https://cdn.starwebserver.se/shops/coolcard/files/cache/pok10359-101_01_tiny.jpg?_=1"></figure>
    <h3>Pokemon Mega Zygarde ex Premium Collection</h3>
    <p class="short-description">8 boosterpaket samt stort &amp; vanligt promo-kort</p>
    <p class="product-sku" title="Artikelnr">POK10359-101</p>
    <div class="product-price"><span class="price"><span class="amount">749</span><span class="currency"> kr</span></span></div>
  </a>
  <div class="product-offer">
    <dl class="product-details"><dt class="stock-status-label">Lagerstatus</dt><dd class="stock-status">16 st i lager</dd></dl>
    <button type="button" class="button add-to-cart" data-name="Pokemon Mega Zygarde ex Premium Collection" data-sku="POK10359-101" data-price="749" data-currency="SEK"><span>Köp</span></button>
  </div>
</li>`;

// Slutsåld: ingen köpknapp (inget data-price) → priset tas ur span.amount.
const soldOutItem = `
<li class="gallery-item gallery-item-stock-status-4 ">
  <a href="/product/pokemon-sv6-5-shrouded-fable-kingambit-illustration-collection" class="gallery-info-link product-info"
     title="Pokemon SV6.5 - Shrouded Fable Illustration Collection: Kingambit - 4 booster packs + 3 promos"
     data-sku="POK85858" data-id="53058">
    <h3>Pokemon SV6.5 - Shrouded Fable Illustration Collection: Kingambit</h3>
    <p class="product-sku" title="Artikelnr">POK85858</p>
    <div class="product-price"><span class="price"><span class="amount">529</span><span class="currency"> kr</span></span></div>
  </a>
  <div class="product-offer">
    <dl class="product-details"><dt class="stock-status-label">Lagerstatus</dt><dd class="stock-status">Slutsåld</dd></dl>
  </div>
</li>`;

// JS-mallblocket i sidfoten — får ALDRIG parsas som produkt.
const templateBlock = `
<li class="gallery-item">
  <a href="/product/{{slug}}" class="gallery-info-link product-info" title="{{productName}}">
    <h3>{{productName}}</h3>
    <dd class="stock-status">{{stockStatusText}}</dd>
  </a>
</li>`;

describe("starwebStockFromText", () => {
  it("lagertext → dom", () => {
    expect(starwebStockFromText("I lager")).toBe("in");
    expect(starwebStockFromText("16 st i lager")).toBe("in");
    expect(starwebStockFromText("Slutsåld")).toBe("out");
    expect(starwebStockFromText(undefined)).toBe("unknown");
    expect(starwebStockFromText("Kommande")).toBe("unknown");
  });
});

describe("parseStarwebListing", () => {
  const base = "https://www.coolcard.se";

  it("plockar titel, pris, SKU och lager; URL absolutiseras mot kanoniska värden", () => {
    const items = parseStarwebListing(inStockItem + soldOutItem, base);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      title: "Pokemon Mega Zygarde ex Premium Collection",
      priceOre: 74900,
      stock: "in",
      sku: "POK10359-101",
      dataId: "59336",
    });
    expect(items[0].url).toBe("https://www.coolcard.se/product/pokemon-mega-zygarde-ex-premium-collection");
  });

  it("slutsåld rad utan köpknapp får pris ur span.amount", () => {
    const [item] = parseStarwebListing(soldOutItem, base);
    expect(item.priceOre).toBe(52900);
    expect(item.stock).toBe("out");
  });

  it("mallblocket ({{mustache}}) parsas aldrig som produkt", () => {
    expect(parseStarwebListing(templateBlock, base)).toHaveLength(0);
  });

  it("annan valuta på köpknappen fäller hela kortet — hellre inget än fel valuta", () => {
    const eur = inStockItem.replace('data-currency="SEK"', 'data-currency="EUR"');
    expect(parseStarwebListing(eur, base)).toHaveLength(0);
  });
});
