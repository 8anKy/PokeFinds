import { describe, expect, it } from "vitest";
import {
  nyehandelStockFromText,
  parseNyehandelListing,
} from "@/scrapers/adapters/nyehandel-adapter";

/**
 * Vakter för Nyehandel-adaptern (Sweet Nerds). Fixturerna är RIKTIG markup, klippt ur
 * sweetnerds.se/sv/categories/pokemon-tcg 2026-09-06 — inte en förenklad skiss.
 *
 * De tre reglerna som faktiskt gick sönder under bygget:
 *   1. `<ins>` är gällande pris, `<del>` det överstrukna. Läses fel visas REA-priset
 *      som ordinarie och prisfallslarmet larmar om en sänkning som redan är gjord.
 *   2. `stock_status_N`-klassen är lagerPOLICY, inte lagerläge — `stock_status_1` bär
 *      BÅDE "Finns i lager" och "Förbeställningsvara". Domen tas på texten.
 *   3. 0 kr är en PLATSHÅLLARE på osläppta varor och får inte slänga annonsen.
 *      Mätt 2026-09-06: 15 av 206 annonser, varav 9 st 30th Celebration.
 */

/** Ett produktkort med de fält adaptern läser. */
function card(opts: {
  slug: string;
  name: string;
  priceHtml: string;
  status: string;
  statusClass?: string;
  qty?: string;
  productId?: string;
}): string {
  const {
    slug,
    name,
    priceHtml,
    status,
    statusClass = "stock_status_1",
    qty,
    productId = "100",
  } = opts;
  return `
    <div class="product-card" >
      <a class="product-card__image " href="https://sweetnerds.se/sv/products/${slug}">
        <img alt="${name}" src="https://nycdn.nyehandel.se/store_x/images/abc.webp?width=400&amp;height=400" />
      </a>
      <div class="details-wrapper"><div class="details">
        <span class="brand">Pokémon TCG</span>
        <a href="https://sweetnerds.se/sv/products/${slug}"><span class="name">${name}</span></a>
        <div class="offer"><div class="price ">${priceHtml}</div></div>
      </div>
      <div class="product-card-inventory-status stock-info ${statusClass}">
        <span class="icon"><i class="fas fa-cubes"></i></span>
        ${status}
      </div>
      ${qty === undefined ? "" : `<div class="product-card-available-stock"><span class="icon"><i class="fas fa-cubes"></i></span>${qty}</div>`}
      <div class="product-card__ribbons">
        <favorite-button product-id="${productId}" active="0"></favorite-button>
      </div>
      </div>
    </div>`;
}

describe("nyehandelStockFromText", () => {
  it("läser butikens uppmätta vokabulär", () => {
    expect(nyehandelStockFromText("Finns i lager")).toBe("in");
    expect(nyehandelStockFromText("Slut på lager")).toBe("out");
    expect(nyehandelStockFromText("Förbeställningsvara")).toBe("preorder");
  });

  it("är en ALLOWLIST — okänd text blir aldrig 'i lager'", () => {
    // Ett falskt "i lager" skickar ett larm till en slutsåld sida. Hellre missa.
    expect(nyehandelStockFromText("Kommer snart")).toBe("unknown");
    expect(nyehandelStockFromText(undefined)).toBe("unknown");
    expect(nyehandelStockFromText("")).toBe("unknown");
  });

  it("dömer förbeställning FÖRE lagerordet", () => {
    // Skyddar mot framtida fraser som blandar in ett leveransdatum.
    expect(nyehandelStockFromText("Förbeställning – i lager 12 sep")).toBe("preorder");
  });
});

describe("parseNyehandelListing", () => {
  it("läser titel, pris, lager och stabilt id ur ett kort", () => {
    const [item] = parseNyehandelListing(
      card({
        slug: "pokemon-gem-pack-vol-6-booster-box-s-ch",
        name: "Pokémon Gem Pack Vol. 6 Booster Box (S-CH)",
        priceHtml: `<ins aria-label="Nuvarande pris" id="product-price">399 kr</ins>`,
        status: "Finns i lager",
        qty: "33 Styck",
        productId: "1586",
      })
    );
    expect(item.title).toBe("Pokémon Gem Pack Vol. 6 Booster Box (S-CH)");
    expect(item.url).toBe(
      "https://sweetnerds.se/sv/products/pokemon-gem-pack-vol-6-booster-box-s-ch"
    );
    expect(item.priceOre).toBe(39_900);
    expect(item.stock).toBe("in");
    expect(item.productId).toBe("1586");
  });

  it("⛔ tar <ins> (gällande pris), aldrig <del> (överstruket)", () => {
    // Det ÖVERSTRUKNA priset står FÖRST i HTML:en — en girig "första kr-träffen"-regex
    // rapporterar 599 kr när butiken tar 499 kr.
    const [item] = parseNyehandelListing(
      card({
        slug: "astral-radiance-etb",
        name: "Pokémon Sword &amp; Shield 10: Astral Radiance Elite Trainer Box",
        priceHtml: `<del aria-label="Tidigare pris" class="comparison">599 kr</del><ins aria-label="Nuvarande pris" id="product-price">499 kr</ins>`,
        status: "Slut på lager",
        statusClass: "stock_status_2",
        qty: "0 Styck",
      })
    );
    expect(item.priceOre).toBe(49_900);
    expect(item.stock).toBe("out");
    // Entiteter i titeln avkodas — "Sword &amp; Shield" är inte produktnamnet.
    expect(item.title).toContain("Sword & Shield");
  });

  it("avkodar &nbsp; som tusentalsavgränsare i priset", () => {
    // Rå text ger parseFloat("&nbsp;1299") = NaN och tappar hela fyrsiffriga segmentet.
    const [item] = parseNyehandelListing(
      card({
        slug: "booster-box-dyr",
        name: "Pokémon Storm Emeralda Booster Box (JP)",
        priceHtml: `<ins id="product-price">1&nbsp;299&nbsp;kr</ins>`,
        status: "Finns i lager",
        qty: "4 Styck",
      })
    );
    expect(item.priceOre).toBe(129_900);
  });

  it("⛔ 0 kr slänger INTE annonsen — den överlever med pris null", () => {
    // Samma fälla som Shopify 2026-09-04: butiken prissätter osläppta varor till 0 kr.
    // En `continue` här hade tappat HELA annonsen: ingen feedpost, ingen StoreListing,
    // ingen auto-import, aldrig ett larm — på precis de varor folk bevakar.
    const items = parseNyehandelListing(
      card({
        slug: "pokemon-30th-celebration-elite-trainer-box-eng",
        name: "Pokémon 30th Celebration Elite Trainer Box (ENG)",
        priceHtml: `<ins id="product-price">0 kr</ins>`,
        status: "Förbeställningsvara",
      })
    );
    expect(items).toHaveLength(1);
    expect(items[0].priceOre).toBeNull();
    expect(items[0].stock).toBe("preorder");
    expect(items[0].url).toContain("30th-celebration-elite-trainer-box-eng");
  });

  it("⛔ stock_status-KLASSEN avgör inte — samma klass bär två lägen", () => {
    // Mätt: stock_status_1 = "Finns i lager" OCH "Förbeställningsvara".
    const html =
      card({
        slug: "a",
        name: "A",
        priceHtml: `<ins id="product-price">10 kr</ins>`,
        status: "Finns i lager",
        statusClass: "stock_status_1",
        productId: "1",
      }) +
      card({
        slug: "b",
        name: "B",
        priceHtml: `<ins id="product-price">10 kr</ins>`,
        status: "Förbeställningsvara",
        statusClass: "stock_status_1",
        productId: "2",
      });
    const items = parseNyehandelListing(html);
    expect(items.map((i) => i.stock)).toEqual(["in", "preorder"]);
  });

  it("saldo 0 nedgraderar ett motsägande 'Finns i lager'", () => {
    const [item] = parseNyehandelListing(
      card({
        slug: "motsagelse",
        name: "Motsägelse",
        priceHtml: `<ins id="product-price">99 kr</ins>`,
        status: "Finns i lager",
        qty: "0 Styck",
      })
    );
    expect(item.stock).toBe("out");
  });

  it("saldo uppgraderar ALDRIG — en förbeställning med saldo förblir förbeställning", () => {
    const [item] = parseNyehandelListing(
      card({
        slug: "forbest",
        name: "Förbeställning",
        priceHtml: `<ins id="product-price">99 kr</ins>`,
        status: "Förbeställningsvara",
        qty: "12 Styck",
      })
    );
    expect(item.stock).toBe("preorder");
  });

  it("avvisar kort i annan valuta", () => {
    expect(
      parseNyehandelListing(
        card({
          slug: "eur",
          name: "Euro-vara",
          priceHtml: `<ins id="product-price">39 €</ins>`,
          status: "Finns i lager",
        })
      )
    ).toHaveLength(0);
  });

  it("ger tom lista för markup utan produktkort", () => {
    expect(parseNyehandelListing("<html><body>Inga produkter</body></html>")).toEqual([]);
  });
});
