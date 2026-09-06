import { describe, expect, it } from "vitest";
import {
  magentoToolbarCount,
  parseMagentoListing,
  stripMagentoTitleNoise,
} from "@/scrapers/adapters/magento-adapter";
import {
  parseCardHavenListing,
  parseCardHavenPrice,
} from "@/scrapers/adapters/cardhaven-adapter";

/**
 * Vakter för Wave 7:s två övriga adaptrar. Fixturerna är RIKTIG markup, klippt ur
 * toyspace.se/samlarkortspel/pokemonkort och cardhaven.se/shop/pokemon 2026-09-06.
 */

// ---------------------------------------------------------------- Magento (Toyspace)

function magentoTile(opts: {
  id: string;
  slug: string;
  name: string;
  price: string;
  inStock: boolean;
  sku?: string;
}): string {
  const { id, slug, name, price, inStock, sku = "03266-17" } = opts;
  return `<li class="item product product-item"><div class="product-item-info${inStock ? "" : " out-of-stock"}" id="product-item-info_${id}" data-container="product-grid">
    <a href="https://toyspace.se/${slug}" class="product photo product-item-photo">
      <img class="product-image-photo lazy" data-src="https://cdn.example.net/media/catalog/product/${slug}.jpg"/>
    </a>
    <div class="product details product-item-details">
      <strong class="product name product-item-name"><a class="product-item-link" href="https://toyspace.se/${slug}">${name}</a></strong>
      <span><div class="price-box price-final_price" data-product-id="${id}">
        <span id="product-price-${id}" data-price-amount="${price}" data-price-type="finalPrice" class="price-wrapper"><span class="price">${price}:-</span></span>
      </div></span>
      ${
        inStock
          ? `<form data-role="tocart-form" data-product-sku="${sku}" action="https://toyspace.se/checkout/cart/add/"><button type="submit" class="action tocart primary"><span>Köp nu</span></button></form>`
          : `<div class="stock unavailable"><span>Tillfälligt slut</span></div><a class="action watch">Bevaka</a>`
      }
    </div></div></li>`;
}

describe("stripMagentoTitleNoise", () => {
  it("tar bort köpgränsen ur produktnamnet", () => {
    // "Max 5 per kund." är butikslogistik. Lämnas den kvar förgiftar den matchningen
    // mot katalogen och syns i Discord-inlägget.
    expect(
      stripMagentoTitleNoise("Max 5 per kund. Pokémon TCG Mega Evolution Chaos Rising Boosterpaket")
    ).toBe("Pokémon TCG Mega Evolution Chaos Rising Boosterpaket");
    expect(stripMagentoTitleNoise("Max 1 per order: Pokémon ETB")).toBe("Pokémon ETB");
  });

  it("rör inte en titel utan köpgräns", () => {
    expect(stripMagentoTitleNoise("Pokémon TCG Poké Ball Tin")).toBe("Pokémon TCG Poké Ball Tin");
  });

  it("⛔ kapar inte en produkt som RÅKAR börja med 'Max'", () => {
    // "Maxie's Hidden Ball Trick" o.likn. får inte trimmas — mönstret kräver siffra + "per".
    expect(stripMagentoTitleNoise("Max Elixir Booster Pack")).toBe("Max Elixir Booster Pack");
  });
});

describe("parseMagentoListing", () => {
  it("läser titel, pris, lager och id ur ett kort i lager", () => {
    const [item] = parseMagentoListing(
      magentoTile({
        id: "53669",
        slug: "pokemon-tcg-kaos-uppgang-boosterpaket-pok10407-101",
        name: "Max 5 per kund. Pokémon TCG Mega Evolution Chaos Rising Boosterpaket",
        price: "85",
        inStock: true,
      })
    );
    expect(item.title).toBe("Pokémon TCG Mega Evolution Chaos Rising Boosterpaket");
    expect(item.priceOre).toBe(8_500);
    expect(item.stock).toBe("in");
    expect(item.productId).toBe("53669");
    expect(item.url).toBe("https://toyspace.se/pokemon-tcg-kaos-uppgang-boosterpaket-pok10407-101");
  });

  it("läser ett slutsålt kort — som saknar köpformulär helt", () => {
    const [item] = parseMagentoListing(
      magentoTile({
        id: "49712",
        slug: "destined-rivals-elite-trainer-box-pok10652",
        name: "Pokemon TCG: Scarlet &amp; Violet – Destined Rivals Elite Trainer Box",
        price: "1275",
        inStock: false,
      })
    );
    expect(item.stock).toBe("out");
    expect(item.priceOre).toBe(127_500);
    expect(item.productId).toBe("49712");
    expect(item.title).toContain("Scarlet & Violet");
  });

  it("⛔ kräver att BÅDA lagersignalerna pekar åt samma håll", () => {
    // Köpformulär OCH slutsåld-markör samtidigt = motsägelse ⇒ unknown, aldrig ett
    // gissat "i lager". Ett falskt IN_STOCK larmar bevakare till en död sida.
    const contradictory = magentoTile({
      id: "1",
      slug: "x",
      name: "X",
      price: "10",
      inStock: true,
    }).replace('class="product-item-info"', 'class="product-item-info out-of-stock"');
    expect(parseMagentoListing(contradictory)[0].stock).toBe("unknown");
  });

  it("tar finalPrice, inte den ordinarie raden på en reavara", () => {
    const tile = magentoTile({ id: "7", slug: "rea", name: "Reavara", price: "199", inStock: true }).replace(
      '<span id="product-price-7"',
      '<span data-price-amount="399" data-price-type="oldPrice" class="price-wrapper"></span><span id="product-price-7"'
    );
    expect(parseMagentoListing(tile)[0].priceOre).toBe(19_900);
  });

  it("läser butikens egen produkträknare", () => {
    expect(magentoToolbarCount('<span class="toolbar-number">14</span>')).toBe(14);
    expect(magentoToolbarCount("<p>ingen räknare</p>")).toBeNull();
  });

  it("ger tom lista för markup utan produktkort", () => {
    expect(parseMagentoListing("<html><body>Tomt</body></html>")).toEqual([]);
  });
});

// -------------------------------------------------------------------- Card Haven

function cardHavenTile(opts: {
  slug: string;
  name: string;
  price: string;
  badge?: string;
  release?: string;
}): string {
  const { slug, name, price, badge, release } = opts;
  return `<a class="group flex flex-col" href="/shop/pokemon/${slug}"><div class="holo-card card-playful h-full rounded-xl bg-surface-raised">
    <div class="relative aspect-5/7 overflow-hidden bg-white">
      <img alt="${name}" loading="lazy" src="https://holohaven.fra1.cdn.digitaloceanspaces.com/${slug}.jpg"/>
      ${badge ? `<span class="inline-flex items-center px-2 rounded-full text-[10px] uppercase bg-red-600 text-white absolute top-3 left-3 py-1 tracking-wider">${badge}</span>` : ""}
    </div>
    <div class="p-4"><h3 class="text-sm font-semibold text-primary line-clamp-2 min-h-[2.5rem]">${name}</h3>
      ${release ? `<p class="mt-1 text-xs font-medium text-gold">${release}</p>` : ""}
      <div class="flex flex-col lg:flex-row"><div class="flex md:items-center"><span class="text-lg font-bold text-primary">${price}</span></div>
      <button data-slot="button" aria-label="Lägg i kundvagn"><svg class="lucide lucide-plus"></svg></button></div>
    </div></div></a>`;
}

describe("parseCardHavenPrice", () => {
  it("⛔ kommat är DECIMALTECKEN, mellanrummet tusentalsavgränsare", () => {
    // Läses kommat som tusentalsavgränsare blir 1 249,00 kr till 124 900 kr — en
    // faktor 100 fel, som gör varan osynlig i varje prisjämförelse.
    expect(parseCardHavenPrice("1&nbsp;249,00&nbsp;kr")).toBe(124_900);
    expect(parseCardHavenPrice("949,00 kr")).toBe(94_900);
    expect(parseCardHavenPrice("99,50 kr")).toBe(9_950);
  });

  it("avvisar 0 och skräp", () => {
    expect(parseCardHavenPrice("0,00 kr")).toBeNull();
    expect(parseCardHavenPrice("Slut i lager")).toBeNull();
  });
});

describe("parseCardHavenListing", () => {
  it("läser titel, pris och lager ur ett kort i lager", () => {
    const { items, outOfStockBadges } = parseCardHavenListing(
      cardHavenTile({
        slug: "pokemon-mega-evolution-pitch-black-elite-trainer-box",
        name: "Pokémon Mega Evolution: Pitch Black Elite Trainer Box",
        price: "999,00&nbsp;kr",
      })
    );
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe("Pokémon Mega Evolution: Pitch Black Elite Trainer Box");
    expect(items[0].priceOre).toBe(99_900);
    expect(items[0].stock).toBe("in");
    expect(outOfStockBadges).toBe(0);
  });

  it("räknar 'Slut i lager'-badgen — sanitetsvakten hänger på den", () => {
    const { items, outOfStockBadges } = parseCardHavenListing(
      cardHavenTile({
        slug: "pitch-black-booster-box",
        name: "Pokémon Mega Evolution: Pitch Black Booster Box",
        price: "2&nbsp;649,00&nbsp;kr",
        badge: "Slut i lager",
      })
    );
    expect(items[0].stock).toBe("out");
    expect(items[0].priceOre).toBe(264_900);
    expect(outOfStockBadges).toBe(1);
  });

  it("känner igen förbeställning på släppdatumet", () => {
    const { items } = parseCardHavenListing(
      cardHavenTile({
        slug: "pokemon-30th-celebration-binder-collection",
        name: "Pokémon 30th Celebration: Binder Collection (Förbeställning)",
        price: "1&nbsp;249,00&nbsp;kr",
        release: "Släpps 16 sep. 2026",
      })
    );
    expect(items[0].stock).toBe("preorder");
  });

  it("⛔ slutsåld vinner över förbeställning", () => {
    // En förbeställning som tagit slut går inte att köpa; PREORDER hade sett ut som
    // en uppgradering från OUT_OF_STOCK och kunnat larma.
    const { items } = parseCardHavenListing(
      cardHavenTile({
        slug: "slut-forbest",
        name: "Slutsåld förbeställning",
        price: "100,00 kr",
        badge: "Slut i lager",
        release: "Släpps 16 sep. 2026",
      })
    );
    expect(items[0].stock).toBe("out");
  });

  it("'Max N per order' är en köpgräns, inte ett lagerbesked", () => {
    const { items, outOfStockBadges } = parseCardHavenListing(
      cardHavenTile({
        slug: "max-en",
        name: "Begränsad vara",
        price: "500,00 kr",
        badge: "Max 1 per order",
      })
    );
    expect(items[0].stock).toBe("in");
    expect(outOfStockBadges).toBe(0);
  });

  it("håller isär flera kort på samma sida", () => {
    const html =
      cardHavenTile({ slug: "a", name: "Vara A", price: "100,00 kr" }) +
      cardHavenTile({ slug: "b", name: "Vara B", price: "200,00 kr", badge: "Slut i lager" });
    const { items, outOfStockBadges } = parseCardHavenListing(html);
    expect(items.map((i) => i.title)).toEqual(["Vara A", "Vara B"]);
    expect(items.map((i) => i.priceOre)).toEqual([10_000, 20_000]);
    expect(items.map((i) => i.stock)).toEqual(["in", "out"]);
    expect(outOfStockBadges).toBe(1);
  });

  it("ger tom lista för markup utan produktkort", () => {
    expect(parseCardHavenListing("<html><body>Tomt</body></html>").items).toEqual([]);
  });
});
