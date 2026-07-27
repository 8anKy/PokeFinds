/**
 * productHrefInBlock: produktlänken i ett Quickbutik-block.
 *
 * Mönstret godtog förr BARA /pokemon/{kategori}/{slug}. Swepoke länkar sitt nya
 * sortiment som /alla-produkter/{slug} → 9 av 18 produkter på ETB-kategorisidan föll
 * tyst bort, hamnade utanför feeden och nollades till "Okänd" i pristabellen.
 */
import { describe, expect, it } from "vitest";
import { productHrefInBlock } from "@/scrapers/adapters/quickbutik-adapter";

describe("productHrefInBlock", () => {
  it("tar /alla-produkter/{slug} (Swepokes nya sortiment)", () => {
    const block = '8134" data-s-title="Pitch Black ETB" <a href="/alla-produkter/pokemon-pitch-black-elite-trainer-box">';
    expect(productHrefInBlock(block)).toBe("/alla-produkter/pokemon-pitch-black-elite-trainer-box");
  });

  it("tar /pokemon/{kategori}/{slug} (äldre sortiment) precis som förut", () => {
    const block = '<a href="/pokemon/tins/pokemon-tin-pokeball-2025">';
    expect(productHrefInBlock(block)).toBe("/pokemon/tins/pokemon-tin-pokeball-2025");
  });

  it("tar Shinycards fyra segment djupa väg (ingen djupgräns)", () => {
    const deep = "/pokemon/mega-evolution/chaos-rising/pokemon-chaos-rising-elite-trainer-box";
    expect(productHrefInBlock(`<a href="${deep}">`)).toBe(deep);
  });

  it("hoppar över systemsidor och tar produktlänken", () => {
    const block = '<a href="/cart/index">Varukorg</a><a href="/alla-produkter/pokemon-etb">';
    expect(productHrefInBlock(block)).toBe("/alla-produkter/pokemon-etb");
  });

  it("väljer den länk som står FLERA gånger (bild + titel), inte ankare", () => {
    const block =
      '<a href="/pokemon/tins/pokemon-etb"><img></a><a href="#retail-bag-1"></a><a href="/pokemon/tins/pokemon-etb">Titel</a>';
    expect(productHrefInBlock(block)).toBe("/pokemon/tins/pokemon-etb");
  });

  it("kategorilänk med ett segment räknas aldrig som produkt", () => {
    expect(productHrefInBlock('<a href="/pokemon">')).toBeNull();
  });

  it("inget produktliknande href → null (blocket hoppas över)", () => {
    expect(productHrefInBlock('<a href="/kontakt">')).toBeNull();
  });
});
