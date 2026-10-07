import { describe, expect, it } from "vitest";
import { assignSetSlugs, baseSetSlug, setPath, slugifySetName } from "@/lib/set-slug";

const d = (y: number) => new Date(Date.UTC(y, 0, 1));

describe("läsbara set-adresser", () => {
  it("slugifierar namn — &, diakriter och parenteser försvinner", () => {
    expect(slugifySetName("Scarlet & Violet")).toBe("scarlet-violet");
    expect(slugifySetName("Pokémon Card 151 (SV2a)")).toBe("pokemon-card-151-sv2a");
    expect(slugifySetName("30th Celebration: Classic Collection")).toBe("30th-celebration-classic-collection");
  });

  it("japanska set får -jp, som produkternas slugs", () => {
    expect(baseSetSlug("Mega Brave (M1L)", "JP")).toBe("mega-brave-m1l-jp");
    expect(baseSetSlug("Mega Brave", "EN")).toBe("mega-brave");
  });

  it("kollision: äldsta setet får det korta namnet, nästa får serien, sedan året", () => {
    const m = assignSetSlugs(
      [
        { id: "b", name: "Base Set", series: "Base", language: "EN", releaseDate: d(2016) },
        { id: "a", name: "Base Set", series: "Base", language: "EN", releaseDate: d(1999) },
        { id: "c", name: "Promos", series: "XY", language: "EN", releaseDate: d(2014) },
      ],
      new Set(["promos"])
    );
    expect(m.get("a")).toBe("base-set");
    expect(m.get("b")).toBe("base-set-2016");
    expect(m.get("c")).toBe("promos-xy");
  });

  it("setPath faller tillbaka på id när slugen saknas", () => {
    expect(setPath({ id: "cmabc", slug: "151" })).toBe("/sets/151");
    expect(setPath({ id: "cmabc", slug: null })).toBe("/sets/cmabc");
  });
});
