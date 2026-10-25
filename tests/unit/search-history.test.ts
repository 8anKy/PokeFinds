import { describe, expect, it } from "vitest";
import { addRecentSearch, addViewedProduct, MAX_RECENT_SEARCHES, MAX_RECENTLY_VIEWED } from "@/lib/search-history";

describe("sökhistoriken", () => {
  it("lägger senaste först, utan dubbletter (skiftlägesokänsligt)", () => {
    expect(addRecentSearch(["pikachu", "mew"], "Mew")).toEqual(["Mew", "pikachu"]);
  });
  it("normaliserar blanktecken och hoppar över för korta sökningar", () => {
    expect(addRecentSearch([], "  charizard   ex ")).toEqual(["charizard ex"]);
    expect(addRecentSearch(["mew"], "a")).toEqual(["mew"]);
  });
  it("kapar listan", () => {
    const list = Array.from({ length: MAX_RECENT_SEARCHES }, (_, i) => `sök ${i}`);
    const next = addRecentSearch(list, "ny");
    expect(next).toHaveLength(MAX_RECENT_SEARCHES);
    expect(next[0]).toBe("ny");
  });
  it("senast visade: en rad per produkt, senaste först, kapad", () => {
    const p = (slug: string) => ({ slug, title: slug, imageUrl: null, price: null });
    const list = Array.from({ length: MAX_RECENTLY_VIEWED }, (_, i) => p(`p${i}`));
    const next = addViewedProduct(list, p("p5"));
    expect(next[0].slug).toBe("p5");
    expect(next.filter((x) => x.slug === "p5")).toHaveLength(1);
    expect(addViewedProduct(list, p("ny"))).toHaveLength(MAX_RECENTLY_VIEWED);
  });
});
