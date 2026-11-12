import { beforeEach, describe, expect, it } from "vitest";
import { commitFullFetch, commitHotFetch, planHotFetch, resetHotPages, setHotUrls } from "@/scrapers/hot-pages";

const it_ = (url: string, s = "out") => ({ url, s });
const full = () =>
  new Map([
    ["p1", [it_("a"), it_("b")]],
    ["p2", [it_("c"), it_("d")]],
    ["p3", [it_("e")]],
  ]);

describe("heta sidor (MaxGaming 2026-11-12)", () => {
  beforeEach(() => resetHotPages());

  it("utan läge eller minne är hämtningen full", () => {
    expect(planHotFetch("X", 0).pages).toBeNull();
    expect(planHotFetch("X", 4).pages).toBeNull();
  });

  it("efter en full hämtning läses sida 1 + sidorna med heta URL:er, och var N:e är full", () => {
    commitFullFetch("X", full());
    setHotUrls("X", ["e"]);
    expect(planHotFetch("X", 4).pages).toEqual(["p1", "p3"]);
    for (let i = 0; i < 3; i++) commitHotFetch("X", new Map([["p1", [it_("a"), it_("b")]]]));
    expect(planHotFetch("X", 4).pages).toBeNull();
  });

  it("feeden är alltid komplett och det färska beskedet vinner", () => {
    commitFullFetch("X", full());
    const out = commitHotFetch("X", new Map([["p1", [it_("a", "in"), it_("c", "in")]]]));
    expect(out.map((x) => x.url).sort()).toEqual(["a", "b", "c", "d", "e"]);
    expect(out.find((x) => x.url === "a")?.s).toBe("in");
    // "c" flyttade till sida 1: det färska beskedet, inte sida 2:s gamla.
    expect(out.find((x) => x.url === "c")?.s).toBe("in");
    // "b" föll av sida 1 utan att synas någon annanstans: bärs kvar med sitt gamla besked.
    expect(out.find((x) => x.url === "b")?.s).toBe("out");
  });
});
