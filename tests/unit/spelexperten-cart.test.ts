import { describe, it, expect } from "vitest";
import { extractProducts } from "../../src/scrapers/adapters/spelexperten-adapter";

// Formen ur kategorisidan 2026-11-10: data-artnr sitter på köpknappen efter PT_Beskr;
// ett kort utan köpknapp saknar det.
const card = (href: string, title: string, artnr: string | null) => `
<div class="PT_Bild"><img data-src="/bilder/artiklar/x.jpg"></div>
<div class="PT_Beskr"><a href="${href}" title="${title}">${title}</a></div>
<span class="PT_PrisNormal">249 kr</span>
${artnr ? `<button class="buy-button" data-artnr="${artnr}">Köp</button>` : ""}`;

describe("Spelexperten artnr (korglänkens nyckel)", () => {
  it("varje produkt får SITT artikelnummer, aldrig grannens", () => {
    const html = card("/sallskapsspel/pokemon/a.html", "Pokémon TCG: A", "ULT16735")
      + card("/sallskapsspel/pokemon/b.html", "Pokémon TCG: B", null)
      + card("/sallskapsspel/pokemon/c.html", "Pokémon TCG: C", "HABG7161681");
    const got = extractProducts(html, "x").map((p) => [p.title, p.artnr ?? null]);
    expect(got).toEqual([
      ["Pokémon TCG: A", "ULT16735"],
      ["Pokémon TCG: B", null],
      ["Pokémon TCG: C", "HABG7161681"],
    ]);
  });
});
